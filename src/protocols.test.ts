import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, DEFAULT_PROMPT, loadConfig, saveConfig, STORAGE_KEY } from './config'
import { adapters, endpoint, validateConfig } from './protocols'
import { runRequest, SSEDecoder } from './runner'
import { extractPreviews } from './preview'
import type { Protocol, RequestConfig } from './types'

const config: RequestConfig = {
  ...DEFAULT_CONFIG,
  apiKey: 'test-secret-123',
  model: 'example-model',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const fixtures: Record<Protocol, { stream: unknown[]; json: unknown }> = {
  chat: {
    stream: [
      { choices: [{ delta: { content: '你好，鹈鹕' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
      { choices: [], usage: { prompt_tokens: 12, completion_tokens: 8 } },
      '[DONE]',
    ],
    json: {
      choices: [{ message: { content: '你好，鹈鹕' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 12, completion_tokens: 8 },
    },
  },
  responses: {
    stream: [
      { type: 'response.output_text.delta', delta: '你好，鹈鹕' },
      {
        type: 'response.completed',
        response: { status: 'completed', usage: { input_tokens: 12, output_tokens: 8 } },
      },
    ],
    json: {
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: '你好，鹈鹕' }] }],
      usage: { input_tokens: 12, output_tokens: 8 },
    },
  },
  anthropic: {
    stream: [
      { type: 'message_start', message: { usage: { input_tokens: 12, output_tokens: 0 } } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: '你好，鹈鹕' } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 8 } },
      { type: 'message_stop' },
    ],
    json: {
      type: 'message',
      content: [{ type: 'text', text: '你好，鹈鹕' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 12, output_tokens: 8 },
    },
  },
  gemini: {
    stream: [
      {
        candidates: [
          { content: { parts: [{ text: '内部思考', thought: true }, { text: '你好，鹈鹕' }] } },
        ],
      },
      {
        candidates: [{ finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 8 },
      },
    ],
    json: {
      candidates: [{ content: { parts: [{ text: '你好，鹈鹕' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 8 },
    },
  },
}
function streamResponse(events: unknown[], byteSize = 7) {
  const encoded = new TextEncoder().encode(
    events
      .map((event) => `data: ${typeof event === 'string' ? event : JSON.stringify(event)}\r\n\r\n`)
      .join(''),
  )
  return new Response(
    new ReadableStream({
      start(controller) {
        for (let offset = 0; offset < encoded.length; offset += byteSize)
          controller.enqueue(encoded.slice(offset, offset + byteSize))
        controller.close()
      },
    }),
    { headers: { 'Content-Type': 'text/event-stream' } },
  )
}

describe('四种协议', () => {
  for (const protocol of Object.keys(fixtures) as Protocol[]) {
    it(`${protocol} 构造独立请求并保留中转前缀`, () => {
      const request = adapters[protocol].build({
        ...config,
        protocol,
        baseUrl: 'https://example.test/proxy/v1///',
      })
      expect(request.url).toMatch(/^https:\/\/example.test\/proxy\/v1\//)
      expect(request.init.credentials).toBe('omit')
      const body = JSON.parse(request.init.body as string)
      expect(body.temperature).toBeUndefined()
      expect(body.timeoutSeconds).toBeUndefined()
      expect(body.maxResponseMiB).toBeUndefined()
      expect(JSON.stringify(body)).toContain(DEFAULT_PROMPT)
      expect(JSON.stringify(body)).not.toContain(config.apiKey)
      expect(Object.values(request.init.headers!)).toContain(
        protocol === 'chat' || protocol === 'responses' ? `Bearer ${config.apiKey}` : config.apiKey,
      )
      if (protocol === 'gemini') {
        expect(body.generationConfig.maxOutputTokens).toBe(32768)
        expect(request.url).toContain('alt=sse')
      }
      if (protocol === 'responses') expect(body.store).toBe(false)
      if (protocol === 'chat') expect(body.max_completion_tokens).toBe(32768)
      if (protocol === 'responses') expect(body.max_output_tokens).toBe(32768)
      if (protocol === 'anthropic') expect(body.max_tokens).toBe(32768)
      if (protocol === 'anthropic')
        expect(request.init.headers).toMatchObject({
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        })
    })
    it(`${protocol} 逐字节 SSE 能正确恢复中文、用量和结束状态`, async () => {
      const result = await runRequest({ ...config, protocol }, () => {}, {
        fetchImpl: async () => streamResponse(fixtures[protocol].stream, 1),
      })
      expect(result).toMatchObject({
        status: 'success',
        text: '你好，鹈鹕',
        inputTokens: 12,
        outputTokens: 8,
        httpStatus: 200,
      })
      expect(result.firstTextMs).toBeGreaterThanOrEqual(0)
    })
    it(`${protocol} 解析非流式结果`, async () => {
      const result = await runRequest({ ...config, protocol, stream: false }, () => {}, {
        fetchImpl: async () => json(fixtures[protocol].json),
      })
      expect(result).toMatchObject({
        status: 'success',
        text: '你好，鹈鹕',
        inputTokens: 12,
        outputTokens: 8,
      })
    })
    it(`${protocol} 缺失结束事件不会误报成功`, async () => {
      const partial =
        protocol === 'chat'
          ? fixtures[protocol].stream.slice(0, -1)
          : fixtures[protocol].stream.slice(0, -1)
      const result = await runRequest({ ...config, protocol }, () => {}, {
        fetchImpl: async () => streamResponse(partial),
      })
      expect(result.status).toBe('error')
      expect(result.text).toBe('你好，鹈鹕')
      expect(result.error).toContain('提前结束')
    })
  }
  it('Gemini 非流式路径、模型转义和温度映射', () => {
    const request = adapters.gemini.build({
      ...config,
      protocol: 'gemini',
      stream: false,
      temperature: '0.4',
      model: 'models/test/a',
    })
    expect(request.url).toContain('/models/test%2Fa:generateContent')
    expect(JSON.parse(request.init.body as string).generationConfig.temperature).toBe(0.4)
  })
  it('地址不会重复或丢弃自定义前缀', () => {
    expect(endpoint({ ...config, baseUrl: 'https://host.test/custom/' })).toBe(
      'https://host.test/custom/chat/completions',
    )
  })
})

describe('请求错误和控制', () => {
  it('非流式缺少结束原因时不能误报成功', async () => {
    const result = await runRequest(config, () => {}, {
      fetchImpl: async () =>
        json({ choices: [{ message: { content: '尚未完成' }, finish_reason: null }] }),
    })
    expect(result.status).toBe('error')
    expect(result.text).toBe('尚未完成')
  })
  it.each([401, 429, 500])('HTTP %s 保留状态并隐藏回显密钥', async (status) => {
    const result = await runRequest(config, () => {}, {
      fetchImpl: async () => json({ error: { message: `bad key ${config.apiKey}` } }, status),
    })
    expect(result.status).toBe('error')
    expect(result.httpStatus).toBe(status)
    expect(result.error).toContain(`HTTP ${status}`)
    expect(JSON.stringify(result)).not.toContain(config.apiKey)
  })
  it('非 JSON HTTP 错误可读', async () => {
    const result = await runRequest(config, () => {}, {
      fetchImpl: async () => new Response('upstream unavailable', { status: 502 }),
    })
    expect(result.error).toContain('upstream unavailable')
  })
  it('非 JSON 成功响应不能当作模型结果', async () => {
    const result = await runRequest(config, () => {}, {
      fetchImpl: async () => new Response('<html>proxy home</html>'),
    })
    expect(result.status).toBe('error')
    expect(result.error).toContain('非 JSON')
  })
  it('流内错误保留已收到的正文', async () => {
    const result = await runRequest(config, () => {}, {
      fetchImpl: async () =>
        streamResponse([
          { choices: [{ delta: { content: '部分正文' } }] },
          { error: { message: '服务过载' } },
        ]),
    })
    expect(result).toMatchObject({ status: 'error', text: '部分正文', error: '服务过载' })
  })
  it('输出截断不会误报成功', async () => {
    const result = await runRequest(config, () => {}, {
      fetchImpl: async () =>
        streamResponse([
          { choices: [{ delta: { content: '部分' }, finish_reason: 'length' }] },
          '[DONE]',
        ]),
    })
    expect(result.status).toBe('error')
    expect(result.text).toBe('部分')
    expect(result.error).toContain('不完整')
  })
  const pendingFetch: typeof fetch = async (_url, init) =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode('data: {"choices":[{"delta":{"content":"已收到"}}]}\n\n'),
          )
          init?.signal?.addEventListener('abort', () =>
            controller.error(new DOMException('Aborted', 'AbortError')),
          )
        },
      }),
      { headers: { 'Content-Type': 'text/event-stream' } },
    )
  it('取消请求保留部分内容', async () => {
    const controller = new AbortController()
    const result = await runRequest(
      config,
      (update) => {
        if (update.text) controller.abort()
      },
      { signal: controller.signal, fetchImpl: pendingFetch },
    )
    expect(result).toMatchObject({ status: 'cancelled', text: '已收到' })
  })
  it('超时与用户取消区分', async () => {
    const result = await runRequest(config, () => {}, { timeoutMs: 15, fetchImpl: pendingFetch })
    expect(result).toMatchObject({ status: 'timeout', text: '已收到' })
  })
  it('网络错误不武断判断为跨域错误', async () => {
    const result = await runRequest(config, () => {}, {
      fetchImpl: async () => {
        throw new TypeError('Failed to fetch')
      },
    })
    expect(result.status).toBe('error')
    expect(result.error).toContain('网络连接')
  })
  it('SSE 多行数据、注释和空心跳', () => {
    const decoder = new SSEDecoder()
    expect(decoder.feed(': ping\n\ndata: {"x":\ndata: 1}\n\ndata: [DO')).toEqual(['{"x":\n1}'])
    expect(decoder.feed('NE]\n\n')).toEqual(['[DONE]'])
  })
  it.each([
    { baseUrl: 'javascript:alert(1)' },
    { baseUrl: 'https://api.test/v1?key=bad' },
    { maxTokens: 0 },
    { temperature: '-1' },
    { prompt: ' ' },
    { model: '' },
    { apiKey: '' },
  ])('拒绝无效配置 %j', (patch) => {
    expect(() => validateConfig({ ...config, ...patch })).toThrow()
  })
})

describe('本地保存与预览提取', () => {
  function memoryStorage() {
    const values = new Map<string, string>()
    return {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value)
      },
      removeItem: (key: string) => {
        values.delete(key)
      },
    }
  }
  it('默认提示词原样保留', () => {
    expect(DEFAULT_PROMPT).toBe(
      '创建一个HTML，内容是SVG绘制一个鹈鹕骑自行车的2D动画，你不需要任何测试。',
    )
  })
  it('默认不保存密钥，但保存配置', () => {
    const storage = memoryStorage()
    saveConfig(config, storage)
    expect(loadConfig(storage)).toMatchObject({
      model: config.model,
      apiKey: '',
      prompt: DEFAULT_PROMPT,
    })
  })
  it('主动记住密钥可恢复，取消后立即删除', () => {
    const storage = memoryStorage()
    saveConfig({ ...config, rememberKey: true }, storage)
    expect(loadConfig(storage).apiKey).toBe(config.apiKey)
    saveConfig({ ...config, rememberKey: false }, storage)
    expect(storage.getItem(STORAGE_KEY)).not.toContain(config.apiKey)
  })
  it('损坏或不可用存储不会阻断页面', () => {
    expect(loadConfig({ getItem: () => '{wrong' })).toEqual(DEFAULT_CONFIG)
    expect(
      loadConfig({
        getItem: () => {
          throw new Error()
        },
      }),
    ).toEqual(DEFAULT_CONFIG)
  })
  it('提取多个 HTML / SVG 代码块并去重', () => {
    const text = '作品一\n```html\n<div>你好</div>\n```\n作品二\n```svg\n<svg></svg>\n```'
    expect(extractPreviews(text)).toHaveLength(2)
    expect(extractPreviews(text + '\n```svg\n<svg></svg>\n```')).toHaveLength(2)
  })
  it('识别裸文档，普通文本无预览', () => {
    expect(
      extractPreviews('这是文档：<!doctype html><html><body>hello</body></html>'),
    ).toHaveLength(1)
    expect(extractPreviews('<svg viewBox="0 0 2 2"></svg>')).toHaveLength(1)
    expect(extractPreviews('只是一段普通回复')).toEqual([])
  })
})
