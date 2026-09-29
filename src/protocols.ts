import type { ParsedEvent, ProtocolAdapter, RequestConfig } from './types'
import { thinkingParams, validateThinking } from './thinking'
import { parseReasoning } from './reasoning'

// 响应由不同厂商动态定义；仅在适配器边界读取可选字段。
type Payload = Record<string, any>
function object(value: unknown): Payload {
  return value && typeof value === 'object' ? (value as Payload) : {}
}
function usage(input: unknown, output: unknown): ParsedEvent {
  return {
    ...(typeof input === 'number' ? { inputTokens: input } : {}),
    ...(typeof output === 'number' ? { outputTokens: output } : {}),
  }
}
function apiError(value: Payload): string | undefined {
  if (value.error)
    return typeof value.error === 'string'
      ? value.error
      : value.error.message || JSON.stringify(value.error)
  return undefined
}
function termination(reason: string | undefined): string | undefined {
  if (['length', 'max_tokens', 'MAX_TOKENS'].includes(reason || ''))
    return '达到最大输出 token 限制，回复不完整。可提高上限后重新测试。'
  if (
    [
      'content_filter',
      'SAFETY',
      'RECITATION',
      'BLOCKLIST',
      'PROHIBITED_CONTENT',
      'SPII',
      'refusal',
    ].includes(reason || '')
  )
    return `服务端终止了回复：${reason}`
  return undefined
}
function textBlocks(blocks: unknown): string {
  return Array.isArray(blocks)
    ? blocks
        .filter((b) => b.type === 'text' || b.type === 'output_text')
        .map((b) => b.text || '')
        .join('')
    : ''
}
export function endpoint(config: RequestConfig): string {
  const base = config.baseUrl.trim().replace(/\/+$/, '')
  // Base URL 是完整接口前缀，不能用绝对路径 URL 合并，否则会吞掉中转前缀。
  const suffix =
    config.protocol === 'chat'
      ? '/chat/completions'
      : config.protocol === 'responses'
        ? '/responses'
        : config.protocol === 'anthropic'
          ? '/messages'
          : `/models/${encodeURIComponent(config.model.trim().replace(/^models\//, '')) || '{model}'}:${config.stream ? 'streamGenerateContent?alt=sse' : 'generateContent'}`
  return base + suffix
}
export function validateConfig(config: RequestConfig) {
  validateThinking(config)
  let url: URL
  try {
    url = new URL(config.baseUrl.trim())
  } catch {
    throw new Error('请输入有效的 Base URL。')
  }
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error('Base URL 仅支持 HTTP(S) 接口前缀，不能包含查询参数、片段或账号密码。')
  if (!config.apiKey.trim()) throw new Error('请填写 API Key。')
  if (!config.model.trim()) throw new Error('请填写模型名称。')
  if (!config.prompt.trim()) throw new Error('提示词不能为空。')
  if (!Number.isSafeInteger(config.maxTokens) || config.maxTokens < 1)
    throw new Error('最大输出 token 必须是正整数。')
  for (const [value, multiplier, name] of [
    [config.timeoutSeconds, 1000, '请求总超时（秒）'],
    [config.maxResponseMiB, 1_048_576, '响应大小上限（MiB）'],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0 || !Number.isSafeInteger(value * multiplier))
      throw new Error(`${name}必须是可安全计算的非负整数，0 表示不限制。`)
  }
  if (
    config.temperature !== '' &&
    (!Number.isFinite(Number(config.temperature)) ||
      Number(config.temperature) < 0 ||
      Number(config.temperature) > (config.protocol === 'anthropic' ? 1 : 2))
  )
    throw new Error(`Temperature 必须在 0 到 ${config.protocol === 'anthropic' ? 1 : 2} 之间。`)
}
function build(config: RequestConfig) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const temperature = config.temperature === '' ? {} : { temperature: Number(config.temperature) }
  const model = config.model.trim()
  let body: Payload
  switch (config.protocol) {
    case 'chat':
      headers.Authorization = `Bearer ${config.apiKey.trim()}`
      body = {
        model,
        messages: [{ role: 'user', content: config.prompt }],
        stream: config.stream,
        ...(config.thinking.chat.style === 'deepseek'
          ? { max_tokens: config.maxTokens }
          : { max_completion_tokens: config.maxTokens }),
        ...temperature,
        ...(config.stream ? { stream_options: { include_usage: true } } : {}),
      }
      break
    case 'responses':
      headers.Authorization = `Bearer ${config.apiKey.trim()}`
      body = {
        model,
        input: config.prompt,
        stream: config.stream,
        max_output_tokens: config.maxTokens,
        store: false,
        ...temperature,
      }
      break
    case 'anthropic':
      headers['x-api-key'] = config.apiKey.trim()
      headers['anthropic-version'] = '2023-06-01'
      headers['anthropic-dangerous-direct-browser-access'] = 'true'
      body = {
        model,
        messages: [{ role: 'user', content: config.prompt }],
        stream: config.stream,
        max_tokens: config.maxTokens,
        ...temperature,
      }
      break
    case 'gemini':
      headers['x-goog-api-key'] = config.apiKey.trim()
      body = {
        contents: [{ role: 'user', parts: [{ text: config.prompt }] }],
        generationConfig: { maxOutputTokens: config.maxTokens, ...temperature },
      }
  }
  const thinking = thinkingParams(config)
  if (config.protocol === 'gemini') Object.assign(body.generationConfig, thinking)
  else Object.assign(body, thinking)
  return {
    url: endpoint(config),
    init: {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      credentials: 'omit' as const,
      redirect: 'error' as const,
    },
  }
}

export const adapters: Record<RequestConfig['protocol'], ProtocolAdapter> = {
  chat: {
    build,
    parse(payload, streaming) {
      if (payload === '[DONE]') return { done: true }
      const p = object(payload),
        choice = p.choices?.[0],
        part = streaming ? choice?.delta : choice?.message
      const reason = choice?.finish_reason
      return {
        reasoning: parseReasoning('chat', p, streaming),
        text: typeof part?.content === 'string' ? part.content : textBlocks(part?.content),
        ...usage(p.usage?.prompt_tokens, p.usage?.completion_tokens),
        reason,
        done: !streaming && typeof reason === 'string' && reason.length > 0,
        error:
          apiError(p) ||
          termination(reason) ||
          (part?.refusal ? `模型拒绝了请求：${part.refusal}` : undefined),
      }
    },
  },
  responses: {
    build,
    parse(payload, streaming) {
      const p = object(payload),
        response = p.response || p
      const terminal = p.type === 'response.completed' || (!streaming && p.status === 'completed')
      const reason = response.incomplete_details?.reason || response.status
      const error =
        apiError(p) ||
        apiError(response) ||
        (p.type === 'error' ? p.message || '服务端返回流式错误。' : undefined) ||
        (['response.failed', 'response.incomplete'].includes(p.type) ||
        ['failed', 'incomplete', 'cancelled'].includes(response.status)
          ? `响应未完成：${reason || p.type}`
          : undefined)
      const blocks = (response.output || []).flatMap((item: Payload) => item.content || [])
      const refusal = blocks.find((item: Payload) => item.type === 'refusal')
      return {
        reasoning: parseReasoning('responses', p, streaming),
        text: streaming
          ? p.type === 'response.output_text.delta'
            ? p.delta
            : ''
          : textBlocks(blocks),
        ...usage(response.usage?.input_tokens, response.usage?.output_tokens),
        done: terminal,
        reason,
        error: error || (refusal ? `模型拒绝了请求：${refusal.refusal}` : undefined),
      }
    },
  },
  anthropic: {
    build,
    parse(payload, streaming) {
      const p = object(payload),
        source = p.message || p
      const reason = p.delta?.stop_reason || p.stop_reason
      return {
        reasoning: parseReasoning('anthropic', p, streaming),
        text: streaming
          ? p.type === 'content_block_delta' && p.delta?.type === 'text_delta'
            ? p.delta.text
            : p.type === 'content_block_start' && p.content_block?.type === 'text'
              ? p.content_block.text
              : ''
          : textBlocks(p.content),
        ...usage(source.usage?.input_tokens, source.usage?.output_tokens),
        reason,
        done: streaming ? p.type === 'message_stop' : p.type === 'message' && !!p.stop_reason,
        error: apiError(p) || termination(reason),
      }
    },
  },
  gemini: {
    build,
    parse(payload, streaming) {
      const p = object(payload),
        candidate = p.candidates?.[0],
        reason = candidate?.finishReason
      return {
        reasoning: parseReasoning('gemini', p, streaming),
        text: (candidate?.content?.parts || [])
          .filter((part: Payload) => !part.thought && typeof part.text === 'string')
          .map((part: Payload) => part.text)
          .join(''),
        ...usage(p.usageMetadata?.promptTokenCount, p.usageMetadata?.candidatesTokenCount),
        done: !!reason,
        reason,
        error:
          apiError(p) ||
          termination(reason) ||
          (p.promptFeedback?.blockReason
            ? `提示词被服务端拦截：${p.promptFeedback.blockReason}`
            : reason && reason !== 'STOP'
              ? `生成已终止：${reason}`
              : undefined),
      }
    },
  },
}
