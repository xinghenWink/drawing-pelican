import { BrainCircuit } from 'lucide-react'
import { EFFORTS } from './thinking'
import type { RequestConfig, ThinkingConfig } from './types'

const labels: Record<string, string> = {
  default: '服务默认（不发送）',
  enabled: '开启',
  disabled: '关闭',
  adaptive: '自适应',
  openai: 'OpenAI',
  deepseek: 'DeepSeek',
  level: '按等级',
  budget: '按预算',
  summarized: '返回摘要',
  omitted: '不返回摘要',
  auto: 'auto · 自动',
  concise: 'concise · 简洁',
  detailed: 'detailed · 详细',
}
function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
  names = labels,
}: {
  label: string
  value: T
  options: readonly T[]
  onChange: (value: T) => void
  names?: Record<string, string>
}) {
  return (
    <label className="thinking-field">
      {label}
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
      >
        {options.map((option) => (
          <option value={option} key={option}>
            {names[option] || option}
          </option>
        ))}
      </select>
    </label>
  )
}
export default function ThinkingSettings({
  config,
  onChange,
}: {
  config: RequestConfig
  onChange: (thinking: ThinkingConfig) => void
}) {
  const set = <P extends keyof ThinkingConfig>(protocol: P, patch: Partial<ThinkingConfig[P]>) =>
    onChange({ ...config.thinking, [protocol]: { ...config.thinking[protocol], ...patch } })
  const c = config.thinking
  return (
    <section className="thinking-settings" aria-label="思考设置">
      <h3>
        <BrainCircuit size={14} />
        思考设置
      </h3>
      <div className="thinking-settings-grid">
        {config.protocol === 'chat' && (
          <>
            <Choice
              label="参数风格"
              value={c.chat.style}
              options={['openai', 'deepseek']}
              onChange={(style) => set('chat', { style })}
            />
            {c.chat.style === 'openai' ? (
              <Choice
                label="思考强度"
                value={c.chat.effort}
                options={EFFORTS}
                onChange={(effort) => set('chat', { effort })}
              />
            ) : (
              <>
                <Choice
                  label="思考模式"
                  value={c.chat.mode}
                  options={['default', 'enabled', 'disabled']}
                  onChange={(mode) => set('chat', { mode })}
                />
                {c.chat.mode === 'enabled' && (
                  <Choice
                    label="思考强度"
                    value={c.chat.deepseekEffort}
                    options={['default', 'low', 'high', 'max']}
                    onChange={(deepseekEffort) => set('chat', { deepseekEffort })}
                  />
                )}
              </>
            )}
          </>
        )}
        {config.protocol === 'responses' && (
          <>
            <Choice
              label="思考强度"
              value={c.responses.effort}
              options={EFFORTS}
              onChange={(effort) => set('responses', { effort })}
            />
            <Choice
              label="推理摘要"
              value={c.responses.summary}
              options={['default', 'auto', 'concise', 'detailed']}
              onChange={(summary) => set('responses', { summary })}
            />
          </>
        )}
        {config.protocol === 'anthropic' && (
          <>
            <Choice
              label="思考模式"
              value={c.anthropic.mode}
              options={['default', 'disabled', 'adaptive', 'enabled']}
              names={{ ...labels, enabled: '手动预算（旧版模式）' }}
              onChange={(mode) => set('anthropic', { mode })}
            />
            {c.anthropic.mode === 'adaptive' && (
              <Choice
                label="思考强度"
                value={c.anthropic.effort}
                options={['default', 'low', 'medium', 'high', 'xhigh', 'max']}
                onChange={(effort) => set('anthropic', { effort })}
              />
            )}
            {c.anthropic.mode === 'enabled' && (
              <label className="thinking-field">
                思考预算 token
                <input
                  type="number"
                  min="1024"
                  max={config.maxTokens - 1}
                  step="1"
                  required
                  value={Number.isNaN(c.anthropic.budget) ? '' : c.anthropic.budget}
                  onChange={(event) => set('anthropic', { budget: event.target.valueAsNumber })}
                />
              </label>
            )}
            {['adaptive', 'enabled'].includes(c.anthropic.mode) && (
              <Choice
                label="思考摘要显示"
                value={c.anthropic.display}
                options={['default', 'summarized', 'omitted']}
                onChange={(display) => set('anthropic', { display })}
              />
            )}
          </>
        )}
        {config.protocol === 'gemini' && (
          <>
            <Choice
              label="思考策略"
              value={c.gemini.strategy}
              options={['default', 'level', 'budget']}
              onChange={(strategy) => set('gemini', { strategy })}
            />
            {c.gemini.strategy === 'level' && (
              <Choice
                label="思考等级"
                value={c.gemini.level}
                options={['minimal', 'low', 'medium', 'high']}
                onChange={(level) => set('gemini', { level })}
              />
            )}
            {c.gemini.strategy === 'budget' && (
              <label className="thinking-field">
                思考预算（-1 动态 / 0 关闭）
                <input
                  type="number"
                  min="-1"
                  step="1"
                  required
                  value={Number.isNaN(c.gemini.budget) ? '' : c.gemini.budget}
                  onChange={(event) => set('gemini', { budget: event.target.valueAsNumber })}
                />
              </label>
            )}
            <Choice
              label="返回思考摘要"
              value={c.gemini.includeThoughts}
              options={['default', 'enabled', 'disabled']}
              onChange={(includeThoughts) => set('gemini', { includeThoughts })}
            />
          </>
        )}
      </div>
      <p className="limit-help">
        默认不追加思考参数。可选值因模型而异，请按服务商支持范围选择；只有接口返回可读的思考或摘要时才会展示。
      </p>
    </section>
  )
}
