import { adapters, validateConfig } from './protocols'
import type { ParsedEvent, ReasoningBlock, RequestConfig, RunResult } from './types'

export const emptyResult = (): RunResult => ({
  status: 'idle',
  text: '',
  raw: '',
  reasoning: [],
  elapsed: 0,
})
export function redact(text: string, key: string) {
  return key ? text.split(key).join('[已隐藏密钥]') : text
}

// SSE 以空行划分事件，而不是以网络分块划分；保留尾部片段并支持多行 data。
export class SSEDecoder {
  private pending = ''
  feed(text: string, final = false): string[] {
    this.pending += text
    const blocks = this.pending.split(/\r?\n\r?\n/)
    this.pending = blocks.pop() || ''
    if (final && this.pending.trim()) {
      blocks.push(this.pending)
      this.pending = ''
    }
    return blocks
      .map((block) =>
        block
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).replace(/^ /, ''))
          .join('\n'),
      )
      .filter(Boolean)
  }
}

export async function runRequest(
  config: RequestConfig,
  onUpdate: (result: RunResult) => void,
  options: { signal?: AbortSignal; timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<RunResult> {
  const started = performance.now(),
    controller = new AbortController()
  let timedOut = false,
    result: RunResult = { ...emptyResult(), status: 'running' },
    raw = '',
    text = '',
    receivedBytes = 0,
    finished = false
  let rawParts: string[] = []
  const reasoningBlocks = new Map<string, ReasoningBlock>()
  let streamingResponse = false
  let timeoutTimer: ReturnType<typeof setTimeout> | undefined
  let refreshTimer: ReturnType<typeof setTimeout> | undefined
  let lastPublished = started
  const timeoutMs = options.timeoutMs ?? config.timeoutSeconds * 1000
  const maxBytes = config.maxResponseMiB * 1_048_576
  const abort = () => controller.abort()
  options.signal?.addEventListener('abort', abort, { once: true })
  if (options.signal?.aborted) abort()
  // 超长计时分段调度，避免浏览器 setTimeout 的 32 位上限溢出成即时超时。
  const scheduleTimeout = () => {
    const remaining = timeoutMs - (performance.now() - started)
    if (remaining <= 0) {
      timedOut = true
      controller.abort()
      return
    }
    timeoutTimer = setTimeout(scheduleTimeout, Math.min(remaining, 2_147_483_647))
  }
  const collectRaw = () => {
    if (rawParts.length) {
      raw += rawParts.join('')
      rawParts = []
    }
    return raw
  }
  const publish = () => {
    lastPublished = performance.now()
    result = {
      ...result,
      elapsed: lastPublished - started,
      // 原始缓冲区不被脱敏结果覆盖，保证跨分块的密钥也能正确识别。
      text: redact(text, config.apiKey.trim()),
      raw: redact(collectRaw(), config.apiKey.trim()),
      reasoning: [...reasoningBlocks.values()].map((block) => ({
        ...block,
        text: redact(block.text, config.apiKey.trim()),
      })),
      error: result.error ? redact(result.error, config.apiKey.trim()) : undefined,
    }
    onUpdate({ ...result })
  }
  const queuePublish = () => {
    // 始终继续解析网络流，只合并界面通知；结束时另行强制刷新，不丢最后一个分块。
    if (refreshTimer !== undefined) return
    refreshTimer = setTimeout(
      () => {
        refreshTimer = undefined
        publish()
      },
      Math.max(0, 100 - (performance.now() - lastPublished)),
    )
  }
  const apply = (event: ParsedEvent) => {
    const now = performance.now() - started
    for (const delta of event.reasoning || []) {
      let block = reasoningBlocks.get(delta.id)
      if (!block && !delta.text) continue
      if (!block) {
        block = {
          id: delta.id,
          kind: delta.kind || 'thinking',
          text: '',
          status: 'running',
          ...(streamingResponse ? { startMs: now } : {}),
        }
        reasoningBlocks.set(delta.id, block)
      }
      if (delta.kind) block.kind = delta.kind
      if (delta.text !== undefined) {
        block.text = delta.mode === 'snapshot' ? delta.text : block.text + delta.text
        if (delta.text && delta.mode !== 'snapshot') {
          block.status = 'running'
          block.endMs = undefined
        }
      }
      if (delta.done) {
        block.status = 'complete'
        if (streamingResponse) block.endMs ??= now
      }
    }
    if (event.text) {
      result.firstTextMs ??= performance.now() - started
      text += event.text
      // 无显式块结束事件的协议，以收到正文作为可观察的思考结束边界。
      for (const block of reasoningBlocks.values())
        if (block.status === 'running') {
          block.status = 'complete'
          if (streamingResponse) block.endMs = now
        }
    }
    if (event.inputTokens !== undefined) result.inputTokens = event.inputTokens
    if (event.outputTokens !== undefined) result.outputTokens = event.outputTokens
    if (event.reason) result.reason = event.reason
    if (event.done) finished = true
    if (event.error) throw new Error(event.error)
  }
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    validateConfig(config)
    if (timeoutMs > 0) scheduleTimeout()
    controller.signal.throwIfAborted()
    const adapter = adapters[config.protocol],
      { url, init } = adapter.build(config)
    publish()
    const response = await (options.fetchImpl || fetch)(url, { ...init, signal: controller.signal })
    result.httpStatus = response.status
    const isSSE = response.ok && response.headers.get('content-type')?.includes('text/event-stream')
    streamingResponse = !!isSSE
    const decoder = new TextDecoder(),
      sse = new SSEDecoder()
    const consume = (chunk: string, final = false) => {
      if (chunk) rawParts.push(chunk)
      if (isSSE) {
        for (const data of sse.feed(chunk, final)) {
          let parsed: unknown = data
          if (data !== '[DONE]') {
            try {
              parsed = JSON.parse(data)
            } catch {
              throw new Error('无法解析服务端流式事件，已保留收到的内容。')
            }
          }
          apply(adapter.parse(parsed, true))
        }
      }
      queuePublish()
    }
    // 所有响应均按读取到的 UTF-8 字节计数，包括 SSE 包装和非流式 JSON。
    if (response.body) {
      reader = response.body.getReader()
      while (true) {
        controller.signal.throwIfAborted()
        const chunk = await reader.read()
        if (chunk.done) {
          consume(decoder.decode(), true)
          break
        }
        const remaining =
          maxBytes > 0 ? Math.max(0, maxBytes - receivedBytes) : chunk.value.byteLength
        const exceedsLimit = maxBytes > 0 && chunk.value.byteLength > remaining
        receivedBytes += chunk.value.byteLength
        // 超限分块仍解析允许范围内的完整事件，避免因分块大小不同丢掉已接收正文。
        consume(
          decoder.decode(exceedsLimit ? chunk.value.subarray(0, remaining) : chunk.value, {
            stream: true,
          }),
        )
        if (exceedsLimit) {
          throw new Error(
            `响应超过设置的 ${config.maxResponseMiB} MiB 上限，已停止接收。已保留上限内的原始响应与已解析正文，可在高级设置中调大上限或设为 0（不限）。`,
          )
        }
        // Gemini 的结束原因可能早于末尾用量，必须读到流关闭。
        if (isSSE && finished && config.protocol !== 'gemini') break
      }
    }
    if (!response.ok) {
      let message = collectRaw()
      try {
        const parsed = JSON.parse(message)
        message = parsed.error?.message || parsed.message || message
      } catch {
        /* 非 JSON 错误原样保留。 */
      }
      throw new Error(
        `HTTP ${response.status} ${response.statusText}：${message.slice(0, 2000) || '服务端未提供错误详情'}`,
      )
    }
    if (!isSSE) {
      let parsed: unknown
      try {
        parsed = JSON.parse(collectRaw())
      } catch {
        throw new Error('接口返回了非 JSON 内容，请检查协议和最终请求地址。')
      }
      apply(adapter.parse(parsed, false))
    }
    if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError')
    if (!finished) throw new Error('响应提前结束，未收到完整的结束标记。已保留部分回复。')
    if (!text.trim() && ![...reasoningBlocks.values()].some((block) => block.text.trim()))
      throw new Error('接口已响应，但未返回可展示的正文。请查看原始响应。')
    result.status = 'success'
  } catch (error) {
    result.status = controller.signal.aborted ? (timedOut ? 'timeout' : 'cancelled') : 'error'
    result.error = timedOut
      ? `请求达到设置的 ${timeoutMs / 1000} 秒总超时，已停止等待并保留部分回复。可在高级设置中调大超时或设为 0（不限时）。`
      : controller.signal.aborted
        ? '已停止生成，收到的内容已保留。'
        : error instanceof TypeError
          ? '网络请求失败，请检查 Base URL、网络连接、服务端跨域设置及 HTTPS 配置。'
          : error instanceof Error
            ? error.message
            : String(error)
  } finally {
    clearTimeout(timeoutTimer)
    clearTimeout(refreshTimer)
    options.signal?.removeEventListener('abort', abort)
    for (const block of reasoningBlocks.values())
      if (block.status === 'running') {
        block.status = result.status === 'success' ? 'complete' : 'interrupted'
        if (streamingResponse) block.endMs = performance.now() - started
      }
    publish()
    try {
      await reader?.cancel()
    } catch {
      /* 网络异常或取消后，流可能已经关闭。 */
    }
    reader?.releaseLock()
  }
  return result
}
