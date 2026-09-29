import type { Protocol, ReasoningDelta } from './types'

// 厂商事件只在此边界读取；不把签名、加密数据或正文标签解释为思考文本。
type Payload = Record<string, any>
export function parseReasoning(
  protocol: Protocol,
  p: Payload,
  streaming: boolean,
): ReasoningDelta[] {
  const mode = streaming ? 'append' : 'snapshot'
  if (protocol === 'chat') {
    const part = streaming ? p.choices?.[0]?.delta : p.choices?.[0]?.message
    const text =
      typeof part?.reasoning_content === 'string'
        ? part.reasoning_content
        : typeof part?.reasoning === 'string'
          ? part.reasoning
          : ''
    return text ? [{ id: 'chat-thinking', kind: 'thinking', text, mode, done: !streaming }] : []
  }
  if (protocol === 'gemini') {
    const text = (p.candidates?.[0]?.content?.parts || [])
      .filter((part: Payload) => part.thought === true && typeof part.text === 'string')
      .map((part: Payload) => part.text)
      .join('')
    return text ? [{ id: 'gemini-summary', kind: 'summary', text, mode, done: !streaming }] : []
  }
  if (protocol === 'anthropic') {
    if (!streaming)
      return (p.content || []).flatMap((part: Payload, index: number) =>
        part.type === 'thinking' && typeof part.thinking === 'string' && part.thinking
          ? [
              {
                id: `anthropic-${index}`,
                kind: 'summary',
                text: part.thinking,
                mode: 'snapshot',
                done: true,
              },
            ]
          : [],
      )
    const id = `anthropic-${p.index}`
    if (p.type === 'content_block_stop') return [{ id, done: true }]
    if (
      p.type === 'content_block_start' &&
      p.content_block?.type === 'thinking' &&
      p.content_block.thinking
    )
      return [{ id, kind: 'summary', text: p.content_block.thinking }]
    if (
      p.type === 'content_block_delta' &&
      p.delta?.type === 'thinking_delta' &&
      typeof p.delta.thinking === 'string'
    )
      return [{ id, kind: 'summary', text: p.delta.thinking }]
    return []
  }
  // Responses 增量和最终全文使用相同块 ID；snapshot 覆盖该块，不重复追加。
  const interrupted =
    ['response.incomplete', 'response.failed'].includes(p.type) ||
    ['incomplete', 'failed'].includes(p.status)
  const parts = (item: Payload, index: number): ReasoningDelta[] => {
    if (item.type !== 'reasoning') return []
    const id = item.id ?? index
    return [
      ...(item.summary || []).flatMap((part: Payload, i: number) =>
        part.type === 'summary_text' && typeof part.text === 'string'
          ? [
              {
                id: `${id}:summary:${i}`,
                kind: 'summary' as const,
                text: part.text,
                mode: 'snapshot' as const,
                done: !interrupted,
              },
            ]
          : [],
      ),
      ...(item.content || []).flatMap((part: Payload, i: number) =>
        part.type === 'reasoning_text' && typeof part.text === 'string'
          ? [
              {
                id: `${id}:thinking:${i}`,
                kind: 'thinking' as const,
                text: part.text,
                mode: 'snapshot' as const,
                done: !interrupted,
              },
            ]
          : [],
      ),
    ]
  }
  if (
    !streaming ||
    p.type === 'response.completed' ||
    p.type === 'response.incomplete' ||
    p.type === 'response.failed'
  )
    return (p.response?.output || p.output || []).flatMap(parts)
  if (p.type === 'response.output_item.done') return parts(p.item || {}, p.output_index)
  const summary = p.type?.startsWith('response.reasoning_summary_text.')
  const thinking = p.type?.startsWith('response.reasoning_text.')
  if (summary || thinking) {
    const done = p.type.endsWith('.done')
    const text = done ? p.text : p.delta
    return [
      {
        id: `${p.item_id ?? p.output_index}:${summary ? 'summary' : 'thinking'}:${(summary ? p.summary_index : p.content_index) ?? 0}`,
        kind: summary ? 'summary' : 'thinking',
        ...(typeof text === 'string' ? { text } : {}),
        mode: done ? 'snapshot' : 'append',
        done,
      },
    ]
  }
  return []
}
