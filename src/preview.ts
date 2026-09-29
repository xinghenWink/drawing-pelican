export interface PreviewCandidate {
  name: string
  source: string
}
export function extractPreviews(text: string): PreviewCandidate[] {
  const candidates: PreviewCandidate[] = []
  const add = (source: string) => {
    const content = source.trim()
    if (content && !candidates.some((item) => item.source === content))
      candidates.push({
        name: `${/^<svg\b/i.test(content) ? 'SVG' : 'HTML'} 作品 ${candidates.length + 1}`,
        source: content,
      })
  }
  const fences = [...text.matchAll(/```(?:html|svg|xml)?[ \t]*\r?\n([\s\S]*?)```/gi)]
  for (const match of fences)
    if (/<(?:html|svg|!doctype|div|style|body|canvas)\b/i.test(match[1])) add(match[1])
  if (!candidates.length) {
    const html = text.match(/(?:<!doctype html[^>]*>\s*)?<html\b[\s\S]*?<\/html>/i)
    if (html) add(html[0])
    else {
      const svg = text.match(/<svg\b[\s\S]*?<\/svg>/i)
      if (svg) add(svg[0])
    }
  }
  return candidates
}
export function makePreviewDocument(source: string): string {
  // CSP 必须先于模型内容；移除可触发跳转的 meta/base，并只通过无同源权限的沙盒运行。
  const doc = new DOMParser().parseFromString(source, 'text/html')
  doc.querySelectorAll('meta, base, iframe, frame, object, embed').forEach((node) => node.remove())
  const csp = doc.createElement('meta')
  csp.httpEquiv = 'Content-Security-Policy'
  csp.content =
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
  doc.head.prepend(csp)
  const guard = doc.createElement('script')
  // 禁止链接导航离开预览文档；父页面从不接收模型的 postMessage。
  guard.textContent =
    "document.addEventListener('click',e=>{if(e.target.closest?.('a'))e.preventDefault()},true);"
  csp.after(guard)
  const viewport = doc.createElement('meta')
  viewport.name = 'viewport'
  viewport.content = 'width=device-width, initial-scale=1'
  guard.after(viewport)
  return '<!doctype html>\n' + doc.documentElement.outerHTML
}
