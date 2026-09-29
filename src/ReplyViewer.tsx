import { useLayoutEffect, useRef, useState } from 'react'
import { ArrowDown, BrainCircuit, ChevronDown, Copy, LoaderCircle } from 'lucide-react'
import type { RunResult } from './types'
import { MarkdownContent } from './MarkdownContent'

export default function ReplyViewer({
  result,
  model,
  hidden,
  onCopy,
}: {
  result: RunResult
  model: string
  hidden: boolean
  onCopy: (text: string) => void
}) {
  const [manualOpen, setManualOpen] = useState<boolean | null>(null)
  const [following, setFollowing] = useState(true)
  const scroll = useRef<HTMLDivElement>(null)
  const position = useRef(0)
  const wasHidden = useRef(hidden)
  const running = result.status === 'running'
  const blocks = result.reasoning.filter((block) => block.text.trim())
  const hasThinking = blocks.length > 0
  // 只有正文开始时才自动收起；仅思考或中断时仍方便阅读已收到的内容。
  const open = manualOpen ?? !result.text
  const thinking = blocks.some((block) => block.status === 'running')
  const interrupted = blocks.some((block) => block.status === 'interrupted')
  const status = thinking ? '正在思考' : interrupted ? '已中断' : '思考结束'
  const title = blocks.every((block) => block.kind === 'summary') ? '思考摘要' : '思考过程'
  const timedBlocks = blocks.filter((block) => block.startMs !== undefined)
  const observedMs = timedBlocks.length
    ? Math.max(...timedBlocks.map((block) => block.endMs ?? result.elapsed)) -
      Math.min(...timedBlocks.map((block) => block.startMs!))
    : undefined
  const contentSignature = `${result.text.length}:${blocks.map((block) => block.text.length).join(',')}:${open}:${result.status}`

  useLayoutEffect(() => {
    const element = scroll.current
    if (hidden || !element) {
      wasHidden.current = hidden
      return
    }
    if (following) element.scrollTop = element.scrollHeight
    else if (wasHidden.current) element.scrollTop = position.current
    position.current = element.scrollTop
    wasHidden.current = false
  }, [hidden, following, contentSignature])

  return (
    <div className="reply-view" hidden={hidden}>
      <div
        className="reply-scroll"
        ref={scroll}
        onScroll={() => {
          if (hidden || !scroll.current) return
          const node = scroll.current
          position.current = node.scrollTop
          setFollowing(node.scrollHeight - node.clientHeight - node.scrollTop <= 48)
        }}
      >
        <div className="text-meta">
          <span>{model || 'MODEL RESPONSE'}</span>
          {running && (
            <span className="streaming-label">
              <span />
              {thinking ? '接收思考中' : result.text ? '正在回答' : '等待响应'}
            </span>
          )}
        </div>
        {hasThinking && (
          <section className={`reasoning-card ${thinking ? 'thinking' : ''}`} aria-label="模型思考">
            <div className="reasoning-header">
              <button
                className="reasoning-toggle"
                type="button"
                aria-expanded={open}
                aria-controls="reasoning-details"
                onClick={() => setManualOpen(!open)}
              >
                {thinking ? (
                  <LoaderCircle size={16} className="spin" />
                ) : (
                  <BrainCircuit size={16} />
                )}
                <span>
                  {title}
                  <small>
                    {status}
                    {observedMs !== undefined &&
                      ` · 接收 ${(Math.max(0, observedMs) / 1000).toFixed(1)} 秒`}
                  </small>
                </span>
                <ChevronDown size={15} className={open ? 'expanded' : ''} />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label="复制思考内容"
                onClick={() => onCopy(blocks.map((block) => block.text).join('\n\n'))}
              >
                <Copy size={14} />
              </button>
            </div>
            <div id="reasoning-details" hidden={!open} className="reasoning-details">
              {blocks.map((block, index) => (
                <div key={block.id} className="reasoning-block">
                  {blocks.length > 1 && (
                    <span className="reasoning-block-label">
                      {block.kind === 'summary' ? '思考摘要' : '思考过程'} {index + 1}
                    </span>
                  )}
                  <MarkdownContent text={block.text} onCopy={onCopy} />
                </div>
              ))}
              {observedMs !== undefined && (
                <p className="reasoning-timing-note">
                  时间为客户端观察到的接收时长，不代表模型实际计算时间。
                </p>
              )}
            </div>
          </section>
        )}
        {result.text ? (
          <article className="answer-body" aria-label="模型正文">
            <MarkdownContent text={result.text} onCopy={onCopy} />
            {running && <span className="cursor" aria-label="正在输出正文" />}
          </article>
        ) : (
          <p className="answer-placeholder">
            {running
              ? hasThinking
                ? '思考内容接收中，等待模型正文…'
                : '请求已发送，等待模型开始回答…'
              : result.status === 'success' && hasThinking
                ? '请求完成，未返回正文。'
                : '尚未收到正文。'}
          </p>
        )}
      </div>
      {!following && (
        <button type="button" className="latest-button" onClick={() => setFollowing(true)}>
          <ArrowDown size={14} />
          回到最新
        </button>
      )}
    </div>
  )
}
