import { afterEach, describe, expect, it, vi } from 'vitest'
import { CONFIG_VERSION, DEFAULT_CONFIG, loadConfig, saveConfig, STORAGE_KEY } from './config'
import { validateConfig } from './protocols'
import { runRequest } from './runner'
import { extractPreviews } from './preview'
import type { RunResult } from './types'

const config = { ...DEFAULT_CONFIG, apiKey: 'test-secret', model: 'mock-model' }
const encoder = new TextEncoder()
const MiB = 1_048_576
const event = (content: string) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`
const done = 'data: [DONE]\n\n'
const usage = 'data: {"choices":[],"usage":{"prompt_tokens":31,"completion_tokens":71}}\n\n'
function response(body: string, streaming = true, chunkSize = 65_536) {
  const bytes = encoder.encode(body)
  let offset = 0
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset >= bytes.length) {
          controller.close()
          return
        }
        controller.enqueue(bytes.subarray(offset, offset + chunkSize))
        offset += chunkSize
      },
    }),
    { headers: { 'Content-Type': streaming ? 'text/event-stream' : 'application/json' } },
  )
}
function controlledResponse() {
  let streamController: ReadableStreamDefaultController<Uint8Array>
  let cancelled = false
  let signal: AbortSignal | null | undefined
  const fetchImpl: typeof fetch = async (_url, init) => {
    signal = init?.signal
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          streamController = controller
          signal?.addEventListener(
            'abort',
            () => controller.error(new DOMException('Aborted', 'AbortError')),
            { once: true },
          )
        },
        cancel() {
          cancelled = true
        },
      }),
      { headers: { 'Content-Type': 'text/event-stream' } },
    )
  }
  return {
    fetchImpl,
    push: (chunk: string) => streamController.enqueue(encoder.encode(chunk)),
    close: () => streamController.close(),
    isCancelled: () => cancelled,
    isAborted: () => signal?.aborted,
  }
}
afterEach(() => vi.useRealTimers())

describe('可配置响应大小', () => {
  it('默认不限大小，超过旧 800 万字符阈值后仍完整接收与提取作品', async () => {
    // 用 SSE 元信息模拟真实流：原始响应很大，最终 HTML 正文本身可以很短。
    const metadata = ': ' + 'padding '.repeat(125) + '\n\n'
    const html = '<html><body><svg><text y="20">长回复成功</text></svg></body></html>'
    const body = event('```html\n') + metadata.repeat(8000) + event(html + '\n```') + usage + done
    expect(body.length).toBeGreaterThan(8_000_000)
    const result = await runRequest(config, () => {}, { fetchImpl: async () => response(body) })
    expect(result).toMatchObject({ status: 'success', inputTokens: 31, outputTokens: 71 })
    expect(result.raw).toBe(body)
    expect(extractPreviews(result.text)[0].source).toBe(html)
  })
  it.each([true, false])('响应恰好等于 1 MiB 时成功（流式=%s）', async (streaming) => {
    const base = streaming
      ? event('边界成功') + usage + done
      : JSON.stringify({ choices: [{ message: { content: '边界成功' }, finish_reason: 'stop' }] })
    const size = encoder.encode(base).length
    const body = streaming
      ? ':' + ' '.repeat(MiB - size - 3) + '\n\n' + base
      : base + ' '.repeat(MiB - size)
    expect(encoder.encode(body).length).toBe(MiB)
    const result = await runRequest({ ...config, maxResponseMiB: 1 }, () => {}, {
      fetchImpl: async () => response(body, streaming),
    })
    expect(result).toMatchObject({ status: 'success', text: '边界成功' })
  })
  it.each([true, false])(
    '多一个字节即触发上限并保留上限内原始内容（流式=%s）',
    async (streaming) => {
      const base = streaming
        ? event('部分正文')
        : JSON.stringify({ choices: [{ message: { content: '部分正文' }, finish_reason: 'stop' }] })
      const body = base + ' '.repeat(MiB - encoder.encode(base).length + 1)
      const result = await runRequest({ ...config, maxResponseMiB: 1 }, () => {}, {
        fetchImpl: async () => response(body, streaming),
      })
      expect(result.status).toBe('error')
      expect(result.error).toContain('1 MiB')
      expect(encoder.encode(result.raw).length).toBe(MiB)
      if (streaming) expect(result.text).toBe('部分正文')
    },
  )
  it('中文 UTF-8 计数正确，并保留超限分块前半段中的完整事件', async () => {
    const body = event('已解析的中文') + ': ' + '鹈'.repeat(400_000) + '\n\n' + done
    expect(body.length).toBeLessThan(MiB)
    expect(encoder.encode(body).length).toBeGreaterThan(MiB)
    const result = await runRequest({ ...config, maxResponseMiB: 1 }, () => {}, {
      fetchImpl: async () => response(body, true, 2 * MiB),
    })
    expect(result.status).toBe('error')
    expect(result.text).toBe('已解析的中文')
    expect(result.raw).not.toContain('�')
    expect(encoder.encode(result.raw).length).toBeLessThanOrEqual(MiB)
  })
  it('大型非流式 JSON 默认不截断', async () => {
    const text = '完整内容' + 'x'.repeat(8_000_001)
    const body = JSON.stringify({
      choices: [{ message: { content: text }, finish_reason: 'stop' }],
    })
    const result = await runRequest(config, () => {}, {
      fetchImpl: async () => response(body, false),
    })
    expect(result.status).toBe('success')
    expect(result.text.length).toBe(text.length)
    expect(result.raw).toBe(body)
  })
  it.each([
    { timeoutSeconds: -1 },
    { timeoutSeconds: 1.5 },
    { timeoutSeconds: NaN },
    { timeoutSeconds: Number.MAX_SAFE_INTEGER },
    { maxResponseMiB: -1 },
    { maxResponseMiB: Infinity },
    { maxResponseMiB: 0.5 },
    { maxResponseMiB: Number.MAX_SAFE_INTEGER },
  ])('拒绝不合法限制 %j', (patch) => {
    expect(() => validateConfig({ ...config, ...patch })).toThrow()
  })
})

describe('总超时和合并刷新', () => {
  const fakeClock = () =>
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
  it('遵循配置的总超时，并保留尚未发布的最后一段正文', async () => {
    fakeClock()
    const source = controlledResponse()
    const updates: RunResult[] = []
    const pending = runRequest({ ...config, timeoutSeconds: 1 }, (update) => updates.push(update), {
      fetchImpl: source.fetchImpl,
    })
    await vi.advanceTimersByTimeAsync(950)
    source.push(event('最后一段'))
    await vi.advanceTimersByTimeAsync(50)
    const result = await pending
    expect(result).toMatchObject({ status: 'timeout', text: '最后一段' })
    expect(result.error).toContain('1 秒')
    expect(updates.at(-1)).toEqual(result)
    expect(source.isAborted()).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('0 不限时，超过默认 30 分钟仍能接收并手动取消', async () => {
    fakeClock()
    const source = controlledResponse(),
      controller = new AbortController()
    const pending = runRequest({ ...config, timeoutSeconds: 0 }, () => {}, {
      fetchImpl: source.fetchImpl,
      signal: controller.signal,
    })
    await vi.advanceTimersByTimeAsync(1_800_001)
    expect(source.isAborted()).toBe(false)
    source.push(event('仍在生成'))
    await vi.advanceTimersByTimeAsync(1)
    controller.abort()
    const result = await pending
    expect(result).toMatchObject({ status: 'cancelled', text: '仍在生成' })
    expect(vi.getTimerCount()).toBe(0)
  })
  it('默认 1800 秒生效，超出旧 180 秒不会被中断', async () => {
    fakeClock()
    const source = controlledResponse()
    const pending = runRequest(config, () => {}, { fetchImpl: source.fetchImpl })
    await vi.advanceTimersByTimeAsync(180_001)
    expect(source.isAborted()).toBe(false)
    await vi.advanceTimersByTimeAsync(1_619_999)
    expect((await pending).status).toBe('timeout')
    expect(vi.getTimerCount()).toBe(0)
  })
  it('大于 setTimeout 范围的超时不会溢出为立即取消', async () => {
    fakeClock()
    const source = controlledResponse()
    const pending = runRequest({ ...config, timeoutSeconds: 3_000_000 }, () => {}, {
      fetchImpl: source.fetchImpl,
    })
    await vi.advanceTimersByTimeAsync(2_147_483_648)
    expect(source.isAborted()).toBe(false)
    source.push(event('完成') + done)
    await vi.advanceTimersByTimeAsync(1)
    expect((await pending).status).toBe('success')
    expect(vi.getTimerCount()).toBe(0)
  })
  it('流式更新最多每 100ms 一次，结束立即刷新正文和最终用量并清理所有计时器', async () => {
    fakeClock()
    const source = controlledResponse()
    const updates: { time: number; result: RunResult }[] = []
    const pending = runRequest(
      config,
      (result) => updates.push({ time: performance.now(), result }),
      { fetchImpl: source.fetchImpl },
    )
    await vi.advanceTimersByTimeAsync(0)
    for (let i = 0; i < 12; i++) {
      source.push(event(String(i)))
      await vi.advanceTimersByTimeAsync(20)
    }
    source.push(event('末尾') + usage + done)
    await vi.advanceTimersByTimeAsync(0)
    const result = await pending
    expect(result).toMatchObject({
      status: 'success',
      text: '01234567891011末尾',
      inputTokens: 31,
      outputTokens: 71,
    })
    const running = updates.filter((update) => update.result.status === 'running')
    for (let i = 1; i < running.length; i++)
      expect(running[i].time - running[i - 1].time).toBeGreaterThanOrEqual(100)
    expect(updates.at(-1)?.time).toBe(240)
    expect(updates.at(-1)?.result).toEqual(result)
    expect(source.isCancelled()).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
    const count = updates.length
    await vi.advanceTimersByTimeAsync(10_000)
    expect(updates).toHaveLength(count)
  })
  it('不到刷新周期就发生流内错误时，也保留正文且立刻显示失败', async () => {
    fakeClock()
    const updates: RunResult[] = []
    const result = await runRequest(config, (update) => updates.push(update), {
      fetchImpl: async () => response(event('部分') + 'data: {"error":{"message":"过载"}}\n\n'),
    })
    expect(result).toMatchObject({ status: 'error', text: '部分', error: '过载' })
    expect(updates.at(-1)).toEqual(result)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('配置一次性迁移', () => {
  function storageFor(value: unknown) {
    let saved = JSON.stringify(value)
    return {
      getItem: () => saved,
      setItem: (_key: string, data: string) => {
        saved = data
      },
      removeItem: () => {
        saved = ''
      },
    }
  }
  it('升级旧默认值并保留所有其他用户配置和记住的密钥', () => {
    const old = {
      ...config,
      maxTokens: 8192,
      timeoutSeconds: undefined,
      maxResponseMiB: undefined,
      baseUrl: 'https://custom.test/prefix',
      prompt: '自定义问题',
      rememberKey: true,
    }
    const storage = storageFor(old)
    const migrated = loadConfig(storage)
    expect(migrated).toMatchObject({
      maxTokens: 32768,
      timeoutSeconds: 1800,
      maxResponseMiB: 0,
      baseUrl: old.baseUrl,
      apiKey: old.apiKey,
      model: old.model,
      prompt: old.prompt,
      rememberKey: true,
    })
    saveConfig(migrated, storage)
    expect(JSON.parse(storage.getItem()).version).toBe(CONFIG_VERSION)
    expect(loadConfig(storage)).toEqual(migrated)
  })
  it('旧自定义值保留，新版重新设置 8192 也不被升级', () => {
    expect(loadConfig(storageFor({ maxTokens: 65536 })).maxTokens).toBe(65536)
    const storage = storageFor({})
    saveConfig({ ...config, maxTokens: 8192, timeoutSeconds: 0, maxResponseMiB: 64 }, storage)
    expect(loadConfig(storage)).toMatchObject({
      maxTokens: 8192,
      timeoutSeconds: 0,
      maxResponseMiB: 64,
      apiKey: '',
    })
    expect(STORAGE_KEY).toBe('pelican-lab.config.v1')
  })
  it('损坏的新增字段恢复安全默认值而非禁用全部限制', () => {
    expect(loadConfig(storageFor({ timeoutSeconds: -1, maxResponseMiB: '64' }))).toMatchObject({
      timeoutSeconds: 1800,
      maxResponseMiB: 0,
    })
  })
})
