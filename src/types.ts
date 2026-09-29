export type Protocol = 'chat' | 'responses' | 'anthropic' | 'gemini'
export type Effort = 'default' | 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export interface ThinkingConfig {
  chat: {
    style: 'openai' | 'deepseek'
    effort: Effort
    mode: 'default' | 'enabled' | 'disabled'
    deepseekEffort: 'default' | 'low' | 'high' | 'max'
  }
  responses: { effort: Effort; summary: 'default' | 'auto' | 'concise' | 'detailed' }
  anthropic: {
    mode: 'default' | 'disabled' | 'adaptive' | 'enabled'
    budget: number
    effort: Exclude<Effort, 'none' | 'minimal'>
    display: 'default' | 'summarized' | 'omitted'
  }
  gemini: {
    strategy: 'default' | 'level' | 'budget'
    level: 'minimal' | 'low' | 'medium' | 'high'
    budget: number
    includeThoughts: 'default' | 'enabled' | 'disabled'
  }
}
export interface ReasoningDelta {
  id: string
  kind?: 'thinking' | 'summary'
  text?: string
  mode?: 'append' | 'snapshot'
  done?: boolean
}
export interface ReasoningBlock {
  id: string
  kind: 'thinking' | 'summary'
  text: string
  status: 'running' | 'complete' | 'interrupted'
  startMs?: number
  endMs?: number
}
export interface RequestConfig {
  protocol: Protocol
  baseUrl: string
  apiKey: string
  model: string
  prompt: string
  stream: boolean
  maxTokens: number
  timeoutSeconds: number
  maxResponseMiB: number
  temperature: string
  rememberKey: boolean
  thinking: ThinkingConfig
}
export interface ParsedEvent {
  text?: string
  reasoning?: ReasoningDelta[]
  inputTokens?: number
  outputTokens?: number
  done?: boolean
  reason?: string
  error?: string
}
export interface ProtocolAdapter {
  build: (config: RequestConfig) => { url: string; init: RequestInit }
  parse: (payload: unknown, streaming: boolean) => ParsedEvent
}
export interface RunResult {
  status: 'idle' | 'running' | 'success' | 'error' | 'cancelled' | 'timeout'
  text: string
  raw: string
  reasoning: ReasoningBlock[]
  elapsed: number
  firstTextMs?: number
  inputTokens?: number
  outputTokens?: number
  httpStatus?: number
  reason?: string
  error?: string
}
