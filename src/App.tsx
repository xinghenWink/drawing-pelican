import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  Code2,
  Copy,
  Eye,
  EyeOff,
  FlaskConical,
  HelpCircle,
  KeyRound,
  LoaderCircle,
  Maximize2,
  Monitor,
  Play,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Square,
  Terminal,
  Trash2,
  X,
} from 'lucide-react'
import { DEFAULT_PROMPT, loadConfig, PROTOCOLS, saveConfig } from './config'
import { endpoint } from './protocols'
import { emptyResult, runRequest } from './runner'
import { extractPreviews, makePreviewDocument } from './preview'
import type { Protocol, RequestConfig } from './types'
import Pelican from './Pelican'
import ThinkingSettings from './ThinkingSettings'
const ReplyViewer = lazy(() => import('./ReplyViewer'))

const tabs = [
  { id: 'reply', label: '模型回复', icon: Terminal },
  { id: 'preview', label: '动画预览', icon: Monitor },
  { id: 'raw', label: '原始响应', icon: Code2 },
] as const
type Tab = (typeof tabs)[number]['id']
const statusLabels = {
  idle: '准备就绪',
  running: '正在生成',
  success: '请求完成',
  error: '请求失败',
  cancelled: '已停止',
  timeout: '请求超时',
}
const formatTime = (ms?: number) => (ms === undefined ? '未提供' : `${(ms / 1000).toFixed(2)} s`)

export default function App() {
  const [config, setConfig] = useState(loadConfig)
  const [result, setResult] = useState(emptyResult)
  const [tab, setTab] = useState<Tab>('preview')
  const [showKey, setShowKey] = useState(false)
  const [toast, setToast] = useState('')
  const [storageError, setStorageError] = useState('')
  const [candidateIndex, setCandidateIndex] = useState(0)
  const [previewVersion, setPreviewVersion] = useState(0)
  const [runModel, setRunModel] = useState('')
  const [runId, setRunId] = useState(0)
  const controller = useRef<AbortController | null>(null)
  const form = useRef<HTMLFormElement>(null)
  const previewContainer = useRef<HTMLDivElement>(null)
  const helpDialog = useRef<HTMLDialogElement>(null)
  const running = result.status === 'running'
  const limitSummary = [
    Number.isSafeInteger(config.maxTokens) && config.maxTokens > 0
      ? `${config.maxTokens.toLocaleString()} tok`
      : 'token 待设置',
    !Number.isSafeInteger(config.timeoutSeconds) || config.timeoutSeconds < 0
      ? '超时待设置'
      : config.timeoutSeconds === 0
        ? '不限时'
        : config.timeoutSeconds % 60 === 0
          ? `${config.timeoutSeconds / 60} 分钟`
          : `${config.timeoutSeconds} 秒`,
    !Number.isSafeInteger(config.maxResponseMiB) || config.maxResponseMiB < 0
      ? '大小待设置'
      : config.maxResponseMiB === 0
        ? '大小不限'
        : `${config.maxResponseMiB} MiB`,
  ].join(' · ')
  const candidates = useMemo(
    () => (result.status === 'success' ? extractPreviews(result.text) : []),
    [result.status, result.text],
  )
  const candidate = candidates[candidateIndex] || candidates[0]
  const previewDocument = useMemo(
    () => (candidate ? makePreviewDocument(candidate.source) : ''),
    [candidate],
  )
  const update = <K extends keyof RequestConfig>(key: K, value: RequestConfig[K]) =>
    setConfig((previous) => ({ ...previous, [key]: value }))

  useEffect(() => {
    try {
      saveConfig(config)
      setStorageError('')
    } catch {
      setStorageError('浏览器未允许本地保存，当前页面仍可正常使用。')
    }
  }, [config])
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(''), 2500)
    return () => clearTimeout(timer)
  }, [toast])
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !controller.current) {
        event.preventDefault()
        form.current?.requestSubmit()
      }
    }
    window.addEventListener('keydown', shortcut)
    return () => {
      window.removeEventListener('keydown', shortcut)
      controller.current?.abort()
    }
  }, [])
  useEffect(() => {
    if (!running) return
    const timer = setInterval(
      () =>
        setResult((previous) =>
          previous.status === 'running'
            ? { ...previous, elapsed: previous.elapsed + 100 }
            : previous,
        ),
      100,
    )
    return () => clearInterval(timer)
  }, [running])

  function changeProtocol(protocol: Protocol) {
    setConfig((previous) => ({
      ...previous,
      protocol,
      baseUrl:
        previous.baseUrl === PROTOCOLS[previous.protocol].baseUrl
          ? PROTOCOLS[protocol].baseUrl
          : previous.baseUrl,
    }))
  }
  async function start() {
    if (controller.current) return
    const active = new AbortController()
    controller.current = active
    setTab('reply')
    setCandidateIndex(0)
    setRunModel(config.model.trim())
    setRunId((value) => value + 1)
    try {
      const response = await runRequest({ ...config }, setResult, { signal: active.signal })
      if (response.status === 'success' && extractPreviews(response.text).length) setTab('preview')
    } finally {
      if (controller.current === active) controller.current = null
    }
  }
  const copy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setToast('已复制到剪贴板')
    } catch {
      setToast('复制失败，请手动选择文本复制')
    }
  }, [])
  function download() {
    if (!previewDocument) return
    const url = URL.createObjectURL(
      new Blob([previewDocument], { type: 'text/html;charset=utf-8' }),
    )
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'pelican-result.html'
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    setToast('已下载 HTML 文件')
  }
  function selectTab(next: Tab) {
    setTab(next)
  }

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="./" aria-label="Pelican Lab 首页">
          <span className="brand-icon">
            <FlaskConical size={22} strokeWidth={1.7} />
          </span>
          <span>
            pelican<span className="brand-light">lab</span>
            <span className="brand-dot">.</span>
          </span>
          <span className="brand-divider" />
          <span className="brand-caption">模型能力实验室</span>
        </a>
        <div className="header-actions">
          <span className="local-badge">
            <span /> 浏览器本地运行
          </span>
          <button className="help-button" onClick={() => helpDialog.current?.showModal()}>
            <HelpCircle size={16} />
            <span>使用指南</span>
            <ArrowUpRight size={13} />
          </button>
        </div>
      </header>

      <main>
        <section className="intro">
          <div>
            <div className="eyebrow">
              <span /> A SMALL PROMPT. A BIG POSSIBILITY.
            </div>
            <h1>
              让模型，骑上自行车<span>。</span>
            </h1>
            <p>从一只鹈鹕开始，探索模型的创造力。连接你的 API，让想法即刻可见。</p>
          </div>
          <div className="intro-note">
            <span className="note-line" />
            <span>
              你的模型，你的提示词。
              <br />
              <strong>一次简单的创造力实验。</strong>
            </span>
          </div>
        </section>

        <div className="workspace">
          <form
            ref={form}
            className="control-panel"
            onSubmit={(event) => {
              event.preventDefault()
              void start()
            }}
          >
            <fieldset disabled={running}>
              <section className="config-section">
                <div className="section-heading">
                  <h2>
                    <Settings2 size={17} /> 连接模型
                  </h2>
                  <span className="step">01 / CONNECT</span>
                </div>
                <label className="field-label" htmlFor="protocol">
                  接口协议
                </label>
                <div className="select-wrap">
                  <select
                    id="protocol"
                    value={config.protocol}
                    onChange={(event) => changeProtocol(event.target.value as Protocol)}
                  >
                    {Object.entries(PROTOCOLS).map(([key, info]) => (
                      <option key={key} value={key}>
                        {info.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={14} />
                </div>
                <p className="field-hint">{PROTOCOLS[config.protocol].hint}</p>
                <label className="field-label" htmlFor="base-url">
                  Base URL
                </label>
                <input
                  id="base-url"
                  className="mono"
                  type="url"
                  required
                  value={config.baseUrl}
                  onChange={(event) => update('baseUrl', event.target.value)}
                  placeholder="https://api.example.com/v1"
                  spellCheck={false}
                  autoComplete="off"
                />
                <label className="field-label" htmlFor="api-key">
                  API Key <KeyRound size={12} />
                </label>
                <div className="key-input">
                  <input
                    id="api-key"
                    className="mono"
                    type={showKey ? 'text' : 'password'}
                    required
                    value={config.apiKey}
                    onChange={(event) => update('apiKey', event.target.value)}
                    placeholder="输入你的 API Key"
                    spellCheck={false}
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={showKey ? '隐藏密钥' : '显示密钥'}
                    onClick={() => setShowKey(!showKey)}
                  >
                    {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={config.rememberKey}
                    onChange={(event) => update('rememberKey', event.target.checked)}
                  />{' '}
                  在此浏览器记住密钥
                </label>
                {config.rememberKey && (
                  <p className="key-note">密钥将明文保存在此浏览器，请仅在私人设备上使用。</p>
                )}
                <label className="field-label" htmlFor="model">
                  模型名称
                </label>
                <input
                  id="model"
                  className="mono"
                  value={config.model}
                  required
                  onChange={(event) => update('model', event.target.value)}
                  placeholder="输入服务商提供的模型 ID"
                  spellCheck={false}
                  autoComplete="off"
                />
                <details className="advanced">
                  <summary>
                    <Settings2 size={13} /> 高级设置
                    <span className="limit-summary">{limitSummary}</span>
                    <ChevronDown size={13} />
                  </summary>
                  <div className="advanced-body">
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={config.stream}
                        onChange={(event) => update('stream', event.target.checked)}
                      />{' '}
                      流式输出
                    </label>
                    <div className="advanced-grid">
                      <label htmlFor="max-tokens">
                        最大输出 token
                        <input
                          id="max-tokens"
                          type="number"
                          min="1"
                          step="1"
                          required
                          value={Number.isNaN(config.maxTokens) ? '' : config.maxTokens}
                          onChange={(event) => update('maxTokens', event.target.valueAsNumber)}
                        />
                      </label>
                      <label htmlFor="temperature">
                        Temperature
                        <input
                          id="temperature"
                          type="number"
                          min="0"
                          max={config.protocol === 'anthropic' ? '1' : '2'}
                          step="any"
                          value={config.temperature}
                          onChange={(event) => update('temperature', event.target.value)}
                          placeholder="模型默认"
                        />
                      </label>
                      <label htmlFor="timeout-seconds">
                        请求总超时（秒）
                        <input
                          id="timeout-seconds"
                          type="number"
                          min="0"
                          step="1"
                          required
                          aria-describedby="limit-help"
                          value={Number.isNaN(config.timeoutSeconds) ? '' : config.timeoutSeconds}
                          onChange={(event) => update('timeoutSeconds', event.target.valueAsNumber)}
                        />
                      </label>
                      <label htmlFor="max-response-mib">
                        响应大小上限（MiB）
                        <input
                          id="max-response-mib"
                          type="number"
                          min="0"
                          step="1"
                          required
                          aria-describedby="limit-help"
                          value={Number.isNaN(config.maxResponseMiB) ? '' : config.maxResponseMiB}
                          onChange={(event) => update('maxResponseMiB', event.target.valueAsNumber)}
                        />
                      </label>
                    </div>
                    <p id="limit-help" className="limit-help">
                      超时与响应大小填 0 表示不限制。大小按实际接收字节计算，包含流式事件信息。
                      模型服务自身的 token、超时和连接限制仍然有效。
                    </p>
                    <ThinkingSettings
                      config={config}
                      onChange={(thinking) => update('thinking', thinking)}
                    />
                  </div>
                </details>
                <div className="endpoint">
                  <span>POST</span>
                  <code>{endpoint(config)}</code>
                </div>
              </section>

              <section className="prompt-section">
                <div className="section-heading">
                  <h2>
                    <Terminal size={17} /> 提示词
                  </h2>
                  <span className="step">02 / PROMPT</span>
                </div>
                <div className="prompt-caption">
                  <span className="preset-tag">
                    <span /> 鹈鹕骑行挑战
                  </span>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => update('prompt', DEFAULT_PROMPT)}
                    title="恢复默认提示词"
                  >
                    <RotateCcw size={12} /> 恢复默认
                  </button>
                </div>
                <label className="sr-only" htmlFor="prompt">
                  提示词
                </label>
                <textarea
                  id="prompt"
                  required
                  value={config.prompt}
                  onChange={(event) => update('prompt', event.target.value)}
                  placeholder="写下你想测试的问题或创作任务…"
                />
                <div className="editor-footer">
                  <span>
                    {config.prompt.length} 字符 <span className="subtle-dot">·</span> 可自由编辑
                  </span>
                  <div>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="复制提示词"
                      onClick={() => void copy(config.prompt)}
                    >
                      <Copy size={14} />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="清空提示词"
                      onClick={() => update('prompt', '')}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </section>
            </fieldset>
            <div className="submit-section">
              {running ? (
                <button
                  type="button"
                  className="run-button stopping"
                  onClick={(event) => {
                    // 取消会立即切换为提交按钮，阻止本次点击继续触发表单提交。
                    event.preventDefault()
                    controller.current?.abort()
                  }}
                >
                  <Square size={15} fill="currentColor" /> 停止生成 <span>保留已收到的内容</span>
                </button>
              ) : (
                <button type="submit" className="run-button">
                  <Play size={15} fill="currentColor" /> 开始测试 <kbd>Ctrl ↵</kbd>
                </button>
              )}
              <p>
                <ShieldCheck size={13} /> 密钥仅发送至你指定的 API 地址
              </p>
              {storageError && (
                <p className="storage-error" role="alert">
                  {storageError}
                </p>
              )}
            </div>
          </form>

          <section className="output-panel" aria-label="测试结果">
            <div className="output-heading">
              <div>
                <span className="output-kicker">PLAYGROUND</span>
                <h2>让想法成为画面</h2>
              </div>
              <span className={`status-pill ${result.status}`} role="status">
                {running ? (
                  <LoaderCircle size={12} className="spin" />
                ) : (
                  <span className="status-dot" />
                )}{' '}
                {statusLabels[result.status]}
              </span>
            </div>
            <div className="result-toolbar">
              <div className="tabs" role="tablist" aria-label="结果视图">
                {tabs.map(({ id, label, icon: Icon }, index) => (
                  <button
                    type="button"
                    key={id}
                    id={`tab-${id}`}
                    role="tab"
                    aria-selected={tab === id}
                    aria-controls="result-content"
                    tabIndex={tab === id ? 0 : -1}
                    className={tab === id ? 'active' : ''}
                    onClick={() => selectTab(id)}
                    onKeyDown={(event) => {
                      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
                        event.preventDefault()
                        const next =
                          event.key === 'Home'
                            ? 0
                            : event.key === 'End'
                              ? 2
                              : (index + (event.key === 'ArrowRight' ? 1 : -1) + 3) % 3
                        setTab(tabs[next].id)
                        document.getElementById(`tab-${tabs[next].id}`)?.focus()
                      }
                    }}
                  >
                    <Icon size={15} />
                    {label}
                  </button>
                ))}
              </div>
              <button
                className="icon-button copy-result"
                aria-label="复制回复"
                disabled={!result.text}
                onClick={() => void copy(result.text)}
              >
                <Copy size={15} />
              </button>
            </div>

            {result.error && (
              <div
                role="alert"
                className={`error-banner ${result.status === 'cancelled' ? 'cancelled' : ''}`}
              >
                <strong>{statusLabels[result.status]}</strong>
                <span>{result.error}</span>
              </div>
            )}

            <div
              id="result-content"
              role="tabpanel"
              aria-labelledby={`tab-${tab}`}
              tabIndex={0}
              className={`result-content ${tab === 'preview' || result.status === 'idle' ? 'canvas' : ''}`}
              ref={previewContainer}
            >
              {result.status !== 'idle' && (
                <Suspense fallback={null}>
                  <ReplyViewer
                    key={runId}
                    result={result}
                    model={runModel}
                    hidden={tab !== 'reply'}
                    onCopy={copy}
                  />
                </Suspense>
              )}
              {result.status === 'idle' ? (
                <div className="empty-state">
                  <div className="art-label">
                    THE PELICAN CHALLENGE <span>↗</span>
                  </div>
                  <Pelican />
                  <h3>一只鹈鹕，无限种可能。</h3>
                  <p>
                    填入模型配置，点击「开始测试」
                    <br />
                    看看你的模型会如何描绘这一刻。
                  </p>
                  <div className="empty-chips">
                    <span>SVG 绘制</span>
                    <span>2D 动画</span>
                    <span>模型创造力</span>
                  </div>
                  <div className="illustration-note">示意插画 · 你的模型作品将在这里呈现</div>
                </div>
              ) : tab === 'preview' ? (
                candidate ? (
                  <div className="preview-stage">
                    <div className="preview-tools">
                      <select
                        aria-label="选择预览作品"
                        value={candidateIndex}
                        onChange={(event) => setCandidateIndex(Number(event.target.value))}
                      >
                        {candidates.map((item, index) => (
                          <option key={index} value={index}>
                            {item.name}
                          </option>
                        ))}
                      </select>
                      <div>
                        <button
                          className="icon-button"
                          aria-label="重新播放动画"
                          onClick={() => setPreviewVersion(previewVersion + 1)}
                        >
                          <RotateCcw size={15} />
                        </button>
                        <button
                          className="icon-button"
                          aria-label="全屏预览"
                          onClick={() => {
                            void previewContainer.current
                              ?.requestFullscreen()
                              .catch(() => setToast('浏览器不支持全屏预览'))
                          }}
                        >
                          <Maximize2 size={15} />
                        </button>
                      </div>
                    </div>
                    <iframe
                      key={`${candidateIndex}-${previewVersion}`}
                      title="模型生成的动画预览"
                      sandbox="allow-scripts"
                      referrerPolicy="no-referrer"
                      srcDoc={previewDocument}
                    />
                    <div className="preview-footnote">
                      <ShieldCheck size={12} /> 独立沙盒预览 · 外部资源已禁用
                    </div>
                  </div>
                ) : (
                  <div className="empty-state compact">
                    <Monitor size={36} strokeWidth={1} />
                    <h3>{running ? '创作正在路上…' : '这里还没有可预览的作品'}</h3>
                    <p>
                      {running
                        ? '完整回复到达后，将自动提取 HTML / SVG。'
                        : result.status === 'success'
                          ? '回复中没有识别到 HTML / SVG，切换到模型回复查看。'
                          : '请求完整成功后才会执行预览，部分内容已保留在模型回复中。'}
                    </p>
                    <button className="text-button" onClick={() => setTab('reply')}>
                      查看模型回复 <ArrowRight size={14} />
                    </button>
                  </div>
                )
              ) : tab === 'raw' ? (
                <div className="text-output">
                  <div className="text-meta">
                    <span>RESPONSE / 原始响应</span>
                    {running && (
                      <span className="streaming-label">
                        <span /> 接收中
                      </span>
                    )}
                  </div>
                  <pre>{result.raw || '等待服务端响应…'}</pre>
                </div>
              ) : null}
            </div>

            <div className="metrics" aria-label="请求统计">
              <div>
                <span>首段正文耗时</span>
                <strong>{formatTime(result.firstTextMs)}</strong>
              </div>
              <div>
                <span>总耗时</span>
                <strong>{result.status === 'idle' ? '未提供' : formatTime(result.elapsed)}</strong>
              </div>
              <div>
                <span>输入 Tokens</span>
                <strong>{result.inputTokens?.toLocaleString() ?? '未提供'}</strong>
              </div>
              <div>
                <span>输出 Tokens</span>
                <strong>{result.outputTokens?.toLocaleString() ?? '未提供'}</strong>
              </div>
            </div>
            <div className="output-footer">
              <span>
                {result.httpStatus ? (
                  `HTTP ${result.httpStatus}${result.reason ? ` · ${result.reason}` : ''}`
                ) : (
                  <>
                    <span className="tiny-dot" /> 等待你的第一次实验
                  </>
                )}
              </span>
              <button className="text-button" disabled={!candidate} onClick={download}>
                <ArrowDownToLine size={14} /> 下载 HTML
              </button>
            </div>
          </section>
        </div>
        <footer className="site-footer">
          <span>
            <ShieldCheck size={14} /> 纯前端 · 无后端代理 · 自带 API Key
          </span>
          <span>一个小小的提示词，一次关于可能性的探索。</span>
          <span className="footer-brand">
            BUILT FOR CURIOSITY <ArrowUpRight size={12} />
          </span>
        </footer>
      </main>
      {toast && (
        <div className="toast" role="status">
          <Check size={16} />
          {toast}
        </div>
      )}
      <dialog ref={helpDialog} className="help-dialog">
        <div className="dialog-heading">
          <h2>开始你的第一次实验</h2>
          <button
            className="icon-button"
            aria-label="关闭使用指南"
            onClick={() => helpDialog.current?.close()}
          >
            <X size={20} />
          </button>
        </div>
        <ol>
          <li>
            <strong>连接服务</strong>
            <p>
              选择服务支持的协议，填写包含版本路径的 Base URL（例如
              https://api.example.com/v1）、密钥和模型 ID。
            </p>
          </li>
          <li>
            <strong>给模型一个任务</strong>
            <p>使用默认鹈鹕挑战，也可以改成代码、写作或任意文本问题。每次请求都独立开始。</p>
          </li>
          <li>
            <strong>观察结果</strong>
            <p>
              逐步查看回复与耗时；成功返回 HTML/SVG 时自动切换到沙盒预览。普通文字在模型回复中查看。
            </p>
          </li>
        </ol>
        <div className="guide-note">
          请求直接由浏览器发送。服务必须允许当前网页跨域访问；网络失败时请检查地址、跨域设置和
          HTTPS。预览不加载外部资源。勾选“记住密钥”会将其明文保存在当前浏览器。
        </div>
        <button className="run-button" onClick={() => helpDialog.current?.close()}>
          开始探索 <ArrowRight size={16} />
        </button>
      </dialog>
    </div>
  )
}
