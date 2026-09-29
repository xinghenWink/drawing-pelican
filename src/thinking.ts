import type { RequestConfig, ThinkingConfig } from './types'

export const EFFORTS = [
  'default',
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const
export const DEFAULT_THINKING: ThinkingConfig = {
  chat: { style: 'openai', effort: 'default', mode: 'default', deepseekEffort: 'default' },
  responses: { effort: 'default', summary: 'default' },
  anthropic: { mode: 'default', budget: 4096, effort: 'default', display: 'default' },
  gemini: { strategy: 'default', level: 'low', budget: -1, includeThoughts: 'default' },
}
const choices = {
  chat: {
    style: ['openai', 'deepseek'],
    effort: EFFORTS,
    mode: ['default', 'enabled', 'disabled'],
    deepseekEffort: ['default', 'low', 'high', 'max'],
  },
  responses: { effort: EFFORTS, summary: ['default', 'auto', 'concise', 'detailed'] },
  anthropic: {
    mode: ['default', 'disabled', 'adaptive', 'enabled'],
    effort: ['default', 'low', 'medium', 'high', 'xhigh', 'max'],
    display: ['default', 'summarized', 'omitted'],
  },
  gemini: {
    strategy: ['default', 'level', 'budget'],
    level: ['minimal', 'low', 'medium', 'high'],
    includeThoughts: ['default', 'enabled', 'disabled'],
  },
}
// 每个协议独立恢复，损坏或未知字段不会变成额外 API 参数。
export function loadThinking(value: unknown): ThinkingConfig {
  const output = structuredClone(DEFAULT_THINKING)
  if (!value || typeof value !== 'object') return output
  for (const protocol of Object.keys(output) as (keyof ThinkingConfig)[]) {
    const source = (value as Record<string, unknown>)[protocol]
    if (!source || typeof source !== 'object') continue
    const saved = source as Record<string, unknown>
    const target = output[protocol] as unknown as Record<string, unknown>
    for (const [key, values] of Object.entries(choices[protocol])) {
      if ((values as readonly unknown[]).includes(saved[key])) target[key] = saved[key]
    }
    if (
      'budget' in target &&
      Number.isSafeInteger(saved.budget) &&
      Number(saved.budget) >= (protocol === 'gemini' ? -1 : 1024)
    )
      target.budget = saved.budget
  }
  return output
}
export function validateThinking(config: RequestConfig) {
  const { protocol, thinking, maxTokens } = config
  if (protocol === 'anthropic' && thinking.anthropic.mode === 'enabled') {
    const budget = thinking.anthropic.budget
    if (!Number.isSafeInteger(budget) || budget < 1024 || budget >= maxTokens)
      throw new Error('Anthropic 思考预算必须为至少 1024 且小于最大输出 token 的整数。')
  }
  if (
    protocol === 'gemini' &&
    thinking.gemini.strategy === 'budget' &&
    (!Number.isSafeInteger(thinking.gemini.budget) || thinking.gemini.budget < -1)
  )
    throw new Error('Gemini 思考预算必须是 -1、0 或正整数。')
}
// 只构造用户显式选择的思考字段，不猜测模型能力，不改变默认请求行为。
export function thinkingParams(config: RequestConfig): Record<string, unknown> {
  const settings = config.thinking[config.protocol]
  switch (config.protocol) {
    case 'chat': {
      const c = settings as ThinkingConfig['chat']
      if (c.style === 'openai') return c.effort === 'default' ? {} : { reasoning_effort: c.effort }
      return {
        ...(c.mode === 'default' ? {} : { thinking: { type: c.mode } }),
        ...(c.mode === 'enabled' && c.deepseekEffort !== 'default'
          ? { reasoning_effort: c.deepseekEffort }
          : {}),
      }
    }
    case 'responses': {
      const c = settings as ThinkingConfig['responses']
      const reasoning = {
        ...(c.effort === 'default' ? {} : { effort: c.effort }),
        ...(c.summary === 'default' ? {} : { summary: c.summary }),
      }
      return Object.keys(reasoning).length ? { reasoning } : {}
    }
    case 'anthropic': {
      const c = settings as ThinkingConfig['anthropic']
      if (c.mode === 'default') return {}
      const enabled = c.mode !== 'disabled'
      return {
        thinking: {
          type: c.mode,
          ...(c.mode === 'enabled' ? { budget_tokens: c.budget } : {}),
          ...(enabled && c.display !== 'default' ? { display: c.display } : {}),
        },
        ...(c.mode === 'adaptive' && c.effort !== 'default'
          ? { output_config: { effort: c.effort } }
          : {}),
      }
    }
    case 'gemini': {
      const c = settings as ThinkingConfig['gemini']
      const thinkingConfig = {
        ...(c.strategy === 'level'
          ? { thinkingLevel: c.level }
          : c.strategy === 'budget'
            ? { thinkingBudget: c.budget }
            : {}),
        ...(c.includeThoughts === 'default'
          ? {}
          : { includeThoughts: c.includeThoughts === 'enabled' }),
      }
      return Object.keys(thinkingConfig).length ? { thinkingConfig } : {}
    }
  }
}
