import type { Protocol, RequestConfig } from './types'
import { DEFAULT_THINKING, loadThinking } from './thinking'
export const DEFAULT_PROMPT =
  '创建一个HTML，内容是SVG绘制一个鹈鹕骑自行车的2D动画，你不需要任何测试。'
export const PROTOCOLS: Record<Protocol, { label: string; baseUrl: string; hint: string }> = {
  chat: {
    label: 'OpenAI · Chat Completions',
    baseUrl: 'https://api.openai.com/v1',
    hint: '兼容 OpenAI 格式的服务也可使用',
  },
  responses: {
    label: 'OpenAI · Responses',
    baseUrl: 'https://api.openai.com/v1',
    hint: '使用 Responses API 格式',
  },
  anthropic: {
    label: 'Anthropic · Messages',
    baseUrl: 'https://api.anthropic.com/v1',
    hint: '使用 Anthropic Messages 格式',
  },
  gemini: {
    label: 'Google · Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    hint: '使用 Gemini 原生 API 格式',
  },
}
export const STORAGE_KEY = 'pelican-lab.config.v1'
export const CONFIG_VERSION = 3
export const DEFAULT_CONFIG: RequestConfig = {
  protocol: 'chat',
  baseUrl: PROTOCOLS.chat.baseUrl,
  apiKey: '',
  model: '',
  prompt: DEFAULT_PROMPT,
  stream: true,
  maxTokens: 32768,
  timeoutSeconds: 1800,
  maxResponseMiB: 0,
  temperature: '',
  rememberKey: false,
  thinking: DEFAULT_THINKING,
}
// 只恢复已知且类型正确的字段，避免旧版本或损坏的本地配置影响启动。
export function loadConfig(storage?: Pick<Storage, 'getItem'>): RequestConfig {
  try {
    const saved = JSON.parse((storage ?? localStorage).getItem(STORAGE_KEY) || '{}')
    const result = { ...DEFAULT_CONFIG, thinking: loadThinking(saved?.thinking) }
    if (!saved || typeof saved !== 'object') return result
    for (const key of ['baseUrl', 'model', 'prompt', 'temperature'] as const)
      if (typeof saved[key] === 'string') result[key] = saved[key]
    if (Object.hasOwn(PROTOCOLS, saved.protocol)) result.protocol = saved.protocol
    if (typeof saved.stream === 'boolean') result.stream = saved.stream
    if (Number.isSafeInteger(saved.maxTokens) && saved.maxTokens > 0) {
      // 仅将旧版默认值升级一次；新版主动填写的 8192 和其他自定义值均保留。
      result.maxTokens =
        (saved.version == null || saved.version < 2) && saved.maxTokens === 8192
          ? DEFAULT_CONFIG.maxTokens
          : saved.maxTokens
    }
    for (const key of ['timeoutSeconds', 'maxResponseMiB'] as const) {
      const multiplier = key === 'timeoutSeconds' ? 1000 : 1_048_576
      if (
        Number.isSafeInteger(saved[key]) &&
        saved[key] >= 0 &&
        Number.isSafeInteger(saved[key] * multiplier)
      )
        result[key] = saved[key]
    }
    result.rememberKey = saved.rememberKey === true
    if (result.rememberKey && typeof saved.apiKey === 'string') result.apiKey = saved.apiKey
    return result
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}
export function saveConfig(
  config: RequestConfig,
  storage: Pick<Storage, 'setItem' | 'removeItem'> = localStorage,
) {
  // 先移除旧值，确保取消记住密钥时，即使新配置写入失败也不会残留密钥。
  storage.removeItem(STORAGE_KEY)
  storage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      ...config,
      version: CONFIG_VERSION,
      apiKey: config.rememberKey ? config.apiKey : '',
    }),
  )
}
