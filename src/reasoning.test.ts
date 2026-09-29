import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, loadConfig, saveConfig } from './config'
import { DEFAULT_THINKING, loadThinking } from './thinking'
import { adapters, validateConfig } from './protocols'
import { runRequest } from './runner'
import type { Protocol, RequestConfig } from './types'

const configuration = (): RequestConfig => ({
  ...DEFAULT_CONFIG,
  apiKey: 'secret-for-test',
  model: 'test-model',
  thinking: structuredClone(DEFAULT_THINKING),
})
const body = (config: RequestConfig) =>
  JSON.parse(adapters[config.protocol].build(config).init.body as string)
const sse = (events: unknown[]) =>
  new Response(
    events
      .map((value) => `data: ${typeof value === 'string' ? value : JSON.stringify(value)}\n\n`)
      .join(''),
    { headers: { 'Content-Type': 'text/event-stream' } },
  )
const run = (protocol: Protocol, events: unknown[], streaming = true) =>
  runRequest({ ...configuration(), protocol, stream: streaming }, () => {}, {
    fetchImpl: async () =>
      streaming
        ? sse(events)
        : new Response(JSON.stringify(events[0]), {
            headers: { 'Content-Type': 'application/json' },
          }),
  })

describe('思考参数', () => {
  it.each(['chat', 'responses', 'anthropic', 'gemini'] as const)(
    '%s 默认完全不追加思考字段',
    (protocol) => {
      const request = body({ ...configuration(), protocol })
      for (const key of ['thinking', 'reasoning', 'reasoning_effort', 'output_config'])
        expect(request).not.toHaveProperty(key)
      expect(request.generationConfig || {}).not.toHaveProperty('thinkingConfig')
    },
  )
  it('Chat OpenAI 显式强度使用 reasoning_effort', () => {
    const c = configuration()
    c.thinking.chat.effort = 'xhigh'
    expect(body(c)).toMatchObject({ reasoning_effort: 'xhigh', max_completion_tokens: 32768 })
  })
  it('DeepSeek 开启和关闭映射正确且不泄漏 OpenAI 设置', () => {
    const c = configuration()
    c.thinking.chat = { style: 'deepseek', effort: 'xhigh', mode: 'enabled', deepseekEffort: 'max' }
    expect(body(c)).toMatchObject({
      thinking: { type: 'enabled' },
      reasoning_effort: 'max',
      max_tokens: 32768,
    })
    expect(body(c)).not.toHaveProperty('max_completion_tokens')
    c.thinking.chat.mode = 'disabled'
    expect(body(c)).toMatchObject({ thinking: { type: 'disabled' } })
    expect(body(c)).not.toHaveProperty('reasoning_effort')
  })
  it('Responses 可以单独请求摘要或思考强度', () => {
    const c = configuration()
    c.protocol = 'responses'
    c.thinking.responses.summary = 'auto'
    expect(body(c).reasoning).toEqual({ summary: 'auto' })
    c.thinking.responses.effort = 'high'
    expect(body(c).reasoning).toEqual({ summary: 'auto', effort: 'high' })
  })
  it('Anthropic 自适应、手动预算和关闭均只发送当前模式参数', () => {
    const c = configuration()
    c.protocol = 'anthropic'
    c.thinking.anthropic = { mode: 'adaptive', budget: 4096, effort: 'high', display: 'summarized' }
    expect(body(c)).toMatchObject({
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { effort: 'high' },
    })
    expect(body(c).thinking).not.toHaveProperty('budget_tokens')
    c.thinking.anthropic.mode = 'enabled'
    expect(body(c).thinking).toEqual({
      type: 'enabled',
      budget_tokens: 4096,
      display: 'summarized',
    })
    expect(body(c)).not.toHaveProperty('output_config')
    c.thinking.anthropic.mode = 'disabled'
    expect(body(c).thinking).toEqual({ type: 'disabled' })
  })
  it.each([1023, 32768, 1.5, NaN])('Anthropic 拒绝无效预算 %s', (budget) => {
    const c = configuration()
    c.protocol = 'anthropic'
    c.thinking.anthropic.mode = 'enabled'
    c.thinking.anthropic.budget = budget
    expect(() => validateConfig(c)).toThrow('思考预算')
  })
  it('Gemini 等级与预算互斥，-1 和 0 原样传递', () => {
    const c = configuration()
    c.protocol = 'gemini'
    c.thinking.gemini = {
      strategy: 'level',
      level: 'high',
      budget: 4096,
      includeThoughts: 'enabled',
    }
    expect(body(c).generationConfig.thinkingConfig).toEqual({
      thinkingLevel: 'high',
      includeThoughts: true,
    })
    c.thinking.gemini.strategy = 'budget'
    for (const budget of [-1, 0, 4096]) {
      c.thinking.gemini.budget = budget
      expect(() => validateConfig(c)).not.toThrow()
      expect(body(c).generationConfig.thinkingConfig).toEqual({
        thinkingBudget: budget,
        includeThoughts: true,
      })
    }
    c.thinking.gemini.includeThoughts = 'disabled'
    expect(body(c).generationConfig.thinkingConfig.includeThoughts).toBe(false)
    c.thinking.gemini.budget = -2
    expect(() => validateConfig(c)).toThrow('Gemini 思考预算')
  })
  it('旧 v2 配置补齐思考配置，不再次升级 8192；按协议保存并恢复', () => {
    let stored = JSON.stringify({
      ...configuration(),
      version: 2,
      maxTokens: 8192,
      thinking: undefined,
    })
    const storage = {
      getItem: () => stored,
      removeItem: () => {},
      setItem: (_key: string, value: string) => {
        stored = value
      },
    }
    const c = loadConfig(storage)
    expect(c.maxTokens).toBe(8192)
    expect(c.thinking).toEqual(DEFAULT_THINKING)
    c.thinking.chat.mode = 'enabled'
    c.thinking.responses.summary = 'detailed'
    saveConfig(c, storage)
    expect(loadConfig(storage).thinking).toEqual(c.thinking)
  })
  it('损坏的思考字段恢复默认并保留其余合法字段', () => {
    expect(
      loadThinking({ chat: { style: 'unknown', effort: 'high' }, anthropic: { budget: -2 } }),
    ).toMatchObject({ chat: { style: 'openai', effort: 'high' }, anthropic: { budget: 4096 } })
  })
})

describe('思考与正文分离', () => {
  it('Chat 接收 reasoning_content 与 reasoning，正文标签不被猜测为思考', async () => {
    const result = await run('chat', [
      { choices: [{ delta: { reasoning_content: '先分析' } }] },
      { choices: [{ delta: { reasoning: '再检查' } }] },
      { choices: [{ delta: { content: '<think>这是正文代码</think>' } }] },
      '[DONE]',
    ])
    expect(result.text).toBe('<think>这是正文代码</think>')
    expect(result.reasoning).toHaveLength(1)
    expect(result.reasoning[0]).toMatchObject({
      text: '先分析再检查',
      kind: 'thinking',
      status: 'complete',
    })
    expect(result.firstTextMs).toBeDefined()
    expect(result.reasoning[0].endMs).toBeDefined()
  })
  it('非流式 Chat 只有思考也可成功，不推算思考耗时', async () => {
    const result = await run(
      'chat',
      [
        {
          choices: [
            { message: { reasoning_content: '仅思考', content: '' }, finish_reason: 'stop' },
          ],
        },
      ],
      false,
    )
    expect(result.status).toBe('success')
    expect(result.text).toBe('')
    expect(result.firstTextMs).toBeUndefined()
    expect(result.reasoning[0]).toMatchObject({ text: '仅思考', status: 'complete' })
    expect(result.reasoning[0].startMs).toBeUndefined()
    expect(result.reasoning[0].endMs).toBeUndefined()
  })
  it('Responses delta、done、output_item.done 和 completed 全文不会重复追加', async () => {
    const item = {
      type: 'reasoning',
      id: 'rs_1',
      summary: [{ type: 'summary_text', text: '分析完成' }],
    }
    const result = await run('responses', [
      {
        type: 'response.reasoning_summary_text.delta',
        item_id: 'rs_1',
        summary_index: 0,
        delta: '分析',
      },
      {
        type: 'response.reasoning_summary_text.delta',
        item_id: 'rs_1',
        summary_index: 0,
        delta: '完成',
      },
      {
        type: 'response.reasoning_summary_text.done',
        item_id: 'rs_1',
        summary_index: 0,
        text: '分析完成',
      },
      { type: 'response.output_item.done', item, output_index: 0 },
      { type: 'response.output_text.delta', delta: '最终答案' },
      { type: 'response.completed', response: { status: 'completed', output: [item] } },
    ])
    expect(result.reasoning).toHaveLength(1)
    expect(result.reasoning[0]).toMatchObject({
      text: '分析完成',
      kind: 'summary',
      status: 'complete',
    })
    expect(result.text).toBe('最终答案')
  })
  it('Responses 支持多个摘要块及可读 reasoning_text，不显示 encrypted_content', async () => {
    const result = await run(
      'responses',
      [
        {
          status: 'completed',
          output: [
            {
              type: 'reasoning',
              id: 'r',
              encrypted_content: '不应展示',
              summary: [
                { type: 'summary_text', text: '第一段' },
                { type: 'summary_text', text: '第二段' },
              ],
            },
            {
              type: 'reasoning',
              id: 'r2',
              content: [{ type: 'reasoning_text', text: '兼容思考文本' }],
            },
            { type: 'message', content: [{ type: 'output_text', text: '回答' }] },
          ],
        },
      ],
      false,
    )
    expect(result.reasoning.map((block) => block.text)).toEqual([
      '第一段',
      '第二段',
      '兼容思考文本',
    ])
    expect(JSON.stringify(result.reasoning)).not.toContain('不应展示')
  })
  it('Anthropic 摘要块起始、增量、结束和签名被分别处理', async () => {
    const result = await run('anthropic', [
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'thinking', thinking: '开始' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking_delta', thinking: '推理' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'signature_delta', signature: '加密签名' },
      },
      { type: 'content_block_stop', index: 0 },
      { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '答案' } },
      { type: 'content_block_stop', index: 1 },
      { type: 'message_stop' },
    ])
    expect(result.text).toBe('答案')
    expect(result.reasoning).toHaveLength(1)
    expect(result.reasoning[0]).toMatchObject({
      text: '开始推理',
      kind: 'summary',
      status: 'complete',
    })
  })
  it('非流式 Anthropic 忽略 redacted_thinking 和 signature', async () => {
    const result = await run(
      'anthropic',
      [
        {
          type: 'message',
          stop_reason: 'end_turn',
          content: [
            { type: 'redacted_thinking', data: 'hidden' },
            { type: 'thinking', thinking: '摘要', signature: 'sig' },
            { type: 'text', text: '回答' },
          ],
        },
      ],
      false,
    )
    expect(result.reasoning).toHaveLength(1)
    expect(result.reasoning[0].text).toBe('摘要')
    expect(result.reasoning[0].startMs).toBeUndefined()
  })
  it.each([true, false])('Gemini thought 文本独立于答案（流式=%s）', async (streaming) => {
    const result = await run(
      'gemini',
      [
        {
          candidates: [
            {
              content: {
                parts: [
                  { thought: true, text: '计划' },
                  { thoughtSignature: 'sig' },
                  { text: '执行' },
                ],
              },
              finishReason: 'STOP',
            },
          ],
        },
      ],
      streaming,
    )
    expect(result.text).toBe('执行')
    expect(result.reasoning[0]).toMatchObject({ kind: 'summary', text: '计划', status: 'complete' })
  })
  it('思考中断保留已收到内容，不误报成功', async () => {
    const result = await run('chat', [{ choices: [{ delta: { reasoning_content: '尚在思考' } }] }])
    expect(result.status).toBe('error')
    expect(result.reasoning[0]).toMatchObject({ text: '尚在思考', status: 'interrupted' })
  })
  it.each(['response.incomplete', 'response.failed'])('%s 的部分摘要仍标记中断', async (type) => {
    const result = await run('responses', [
      {
        type: 'response.reasoning_summary_text.delta',
        item_id: 'rs',
        summary_index: 0,
        delta: '部分摘要',
      },
      {
        type,
        response: {
          status: type.slice(9),
          output: [
            { type: 'reasoning', id: 'rs', summary: [{ type: 'summary_text', text: '部分摘要' }] },
          ],
        },
      },
    ])
    expect(result.status).toBe('error')
    expect(result.reasoning).toHaveLength(1)
    expect(result.reasoning[0]).toMatchObject({ text: '部分摘要', status: 'interrupted' })
  })
  it('交错思考与正文不丢片段，保留最后用量', async () => {
    const result = await run('chat', [
      { choices: [{ delta: { reasoning_content: '第一段' } }] },
      { choices: [{ delta: { content: '回答一' } }] },
      { choices: [{ delta: { reasoning_content: '第二段' } }] },
      { choices: [{ delta: { content: '回答二' } }] },
      { choices: [], usage: { prompt_tokens: 23, completion_tokens: 57 } },
      '[DONE]',
    ])
    expect(result.reasoning[0]).toMatchObject({ text: '第一段第二段', status: 'complete' })
    expect(result).toMatchObject({ text: '回答一回答二', inputTokens: 23, outputTokens: 57 })
  })
  it('思考内容与正文使用相同脱敏规则', async () => {
    const result = await run('chat', [
      { choices: [{ delta: { reasoning_content: configuration().apiKey } }] },
      '[DONE]',
    ])
    expect(result.reasoning[0].text).toBe('[已隐藏密钥]')
  })
  it('取消思考时仍保留部分思考文本', async () => {
    const controller = new AbortController()
    const result = await runRequest(
      configuration(),
      (update) => {
        if (update.reasoning.length) controller.abort()
      },
      {
        signal: controller.signal,
        fetchImpl: async (_url, init) =>
          new Response(
            new ReadableStream({
              start(stream) {
                stream.enqueue(
                  new TextEncoder().encode(
                    'data: {"choices":[{"delta":{"reasoning_content":"进行中"}}]}\n\n',
                  ),
                )
                init?.signal?.addEventListener('abort', () =>
                  stream.error(new DOMException('abort', 'AbortError')),
                )
              },
            }),
            { headers: { 'Content-Type': 'text/event-stream' } },
          ),
      },
    )
    expect(result.status).toBe('cancelled')
    expect(result.reasoning[0]).toMatchObject({ text: '进行中', status: 'interrupted' })
  })
})
