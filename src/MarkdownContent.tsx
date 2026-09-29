import { memo } from 'react'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeHighlight from 'rehype-highlight'
import type { Element, Root } from 'hast'
import { Copy, ImageOff } from 'lucide-react'
import 'katex/dist/katex.min.css'

type TreeNode = { value?: string; children?: TreeNode[] }
function nodeText(node?: TreeNode): string {
  return node?.value ?? node?.children?.map(nodeText).join('') ?? ''
}
// 大代码块仍完整渲染和复制，仅跳过昂贵的语法高亮。
function skipLargeHighlight() {
  return (tree: Root) => {
    const visit = (node: Root | Element | Root['children'][number]) => {
      if (node.type === 'element' && node.tagName === 'code' && nodeText(node).length > 100_000) {
        const classes = node.properties.className
        node.properties.className = [...(Array.isArray(classes) ? classes : []), 'no-highlight']
      }
      if ('children' in node) node.children.forEach(visit)
    }
    visit(tree)
  }
}
const remarkPlugins = [remarkGfm, remarkMath]
const rehypePlugins = [
  skipLargeHighlight,
  [rehypeHighlight, { detect: false, ignoreMissing: true }],
  [rehypeKatex, { strict: false, trust: false }],
] as import('unified').PluggableList

export const MarkdownContent = memo(function MarkdownContent({
  text,
  onCopy,
}: {
  text: string
  onCopy: (text: string) => void
}) {
  return (
    <div className="markdown-content">
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        urlTransform={(url) =>
          /^(?:https?:|mailto:|#)/i.test(url) ? defaultUrlTransform(url) : ''
        }
        components={{
          pre({ node, children }) {
            const code = node?.children.find(
              (child) => child.type === 'element' && child.tagName === 'code',
            ) as Element | undefined
            const classes = code?.properties.className
            const language =
              (Array.isArray(classes) ? classes : [])
                .map(String)
                .find((name) => name.startsWith('language-'))
                ?.slice(9) || 'text'
            const source = nodeText(code)
            return (
              <div className="code-block">
                <div className="code-toolbar">
                  <span>{language}</span>
                  <button
                    type="button"
                    onClick={() => onCopy(source)}
                    aria-label={`复制 ${language} 代码`}
                  >
                    <Copy size={13} />
                    复制代码
                  </button>
                </div>
                <pre>{children}</pre>
              </div>
            )
          },
          a({ href, children }) {
            return href ? (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            ) : (
              <span>{children}</span>
            )
          },
          img({ alt }) {
            return (
              <span className="image-placeholder">
                <ImageOff size={14} />
                {alt || '图片'} · 外部图片未加载
              </span>
            )
          },
          table({ children }) {
            return (
              <div className="markdown-table">
                <table>{children}</table>
              </div>
            )
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
})
