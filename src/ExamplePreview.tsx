import { useRef, useState } from 'react'

// 预置作品独立于请求配置和模型结果，只在首次实验前提供展示。
const examples = [
  {
    label: 'GPT',
    model: 'gpt-6.1-sol',
    file: 'gpt-6.1-sol-pelican-bicycle.html',
  },
  {
    label: 'Claude',
    model: 'opus-5.5',
    file: 'opus-5.5-pelican-bicycle.html',
  },
] as const

export default function ExamplePreview() {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const example = examples[selectedIndex]

  return (
    <div className="preview-stage example-preview">
      <div className="example-toolbar">
        <div className="example-switch" role="group" aria-label="示例模型">
          {examples.map((item, index) => (
            <button
              key={item.label}
              ref={(node) => {
                buttons.current[index] = node
              }}
              type="button"
              aria-pressed={selectedIndex === index}
              aria-controls="example-frame"
              onClick={() => setSelectedIndex(index)}
              onKeyDown={(event) => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
                event.preventDefault()
                // 切换与键盘焦点同步，左右方向键在两份示例之间循环。
                const next =
                  event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? examples.length - 1
                      : (index + (event.key === 'ArrowRight' ? 1 : -1) + examples.length) %
                        examples.length
                setSelectedIndex(next)
                buttons.current[next]?.focus()
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="example-caption" aria-live="polite">
          <span className="example-badge">预置示例</span>
          <span className="example-model">{example.model}</span>
        </div>
      </div>
      {/* 仅挂载当前作品；切换时销毁旧动画，保留原始页面的全部交互。 */}
      <iframe
        key={example.file}
        id="example-frame"
        title={`${example.label} 鹈鹕骑行预置示例`}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        src={`${import.meta.env.BASE_URL}${example.file}`}
      />
      <p className="preview-footnote">填入模型配置，点击「开始测试」，生成你的作品。</p>
    </div>
  )
}
