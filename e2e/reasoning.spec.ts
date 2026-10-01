import { test, expect, type Page } from '@playwright/test'

async function setupStream(page: Page) {
  // 用可逐步推进的模拟流验证真实的思考/正文切换，不调用收费接口。
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window)
    window.fetch = async (input, init) => {
      if (!String(input).startsWith('https://model.example.test/'))
        return originalFetch(input, init)
      return new Response(
        new ReadableStream({
          start(controller) {
            ;(window as any).__pelicanPush = (data: string) =>
              controller.enqueue(new TextEncoder().encode(data))
            ;(window as any).__pelicanClose = () => controller.close()
            init?.signal?.addEventListener('abort', () =>
              controller.error(new DOMException('aborted', 'AbortError')),
            )
          },
        }),
        { headers: { 'Content-Type': 'text/event-stream' } },
      )
    }
  })
  await page.goto('/')
  await page.getByLabel('Base URL').fill('https://model.example.test/v1')
  await page.getByLabel('API Key', { exact: true }).fill('mock-key')
  await page.getByLabel('模型名称').fill('reasoning-model')
  await page.getByRole('button', { name: '开始测试' }).click()
}
async function push(page: Page, data: unknown) {
  await page.evaluate(
    (chunk) => (window as any).__pelicanPush(chunk),
    `data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`,
  )
}
const thought = (text: string) => ({ choices: [{ delta: { reasoning_content: text } }] })
const answer = (text: string) => ({ choices: [{ delta: { content: text } }] })

test('思考自动展开与收起，Markdown/公式/高亮/复制与安全排版', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const external: string[] = []
  await page.route('https://image.example.test/**', (route) => {
    external.push(route.request().url())
    return route.abort()
  })
  await setupStream(page)
  await push(page, thought('先分析结构，再检查 **边界条件**。'))
  const toggle = page.getByRole('button', { name: /思考过程/ })
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(page.locator('.reasoning-details strong')).toHaveText('边界条件')
  await expect(toggle).toContainText('正在思考')
  const markdown =
    '# 一个清晰的回答\n\n- 第一项\n- 第二项\n\n> 保留重要的上下文。\n\n| 项目 | 结果 |\n| --- | --- |\n| 动画 | 完成 |\n\n公式：$E = mc^2$\n\n```javascript\nconst answer = 42;\n```\n\n```unknownlang\nplain source\n```\n\n[危险链接](javascript:alert(1))\n\n![图片](https://image.example.test/tracker.png)\n\n<script>window.__unsafeExecuted = true</script>'
  await push(page, answer(markdown))
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByRole('heading', { name: '一个清晰的回答' })).toBeVisible()
  await expect(page.locator('.answer-body table')).toBeVisible()
  await expect(page.locator('.answer-body .katex')).toBeVisible()
  await expect(page.locator('.answer-body .hljs-keyword')).toHaveText('const')
  await page.getByRole('button', { name: '复制 javascript 代码' }).click()
  expect((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n')).toBe(
    'const answer = 42;\n',
  )
  await page.getByRole('button', { name: '复制回复', exact: true }).click()
  expect((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n')).toBe(
    markdown,
  )
  await toggle.click()
  await page.getByRole('button', { name: '复制思考内容' }).click()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    '先分析结构，再检查 **边界条件**。',
  )
  await push(page, '[DONE]')
  await expect(page.getByText('请求完成', { exact: true })).toBeVisible()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  expect(external).toEqual([])
  expect(await page.evaluate(() => (window as any).__unsafeExecuted)).toBeUndefined()
  expect(await page.locator('.answer-body a[href^="javascript:"]').count()).toBe(0)
  await expect(page.locator('.image-placeholder')).toContainText('外部图片未加载')
  await page.screenshot({ path: 'test-results/reasoning-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: 'test-results/reasoning-mobile.png', fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})

test('手动折叠优先，页签切换保留状态与阅读位置，向上阅读时停止跟随', async ({ page }) => {
  await setupStream(page)
  await push(page, thought('检查一个需要更长回答的问题。'))
  const toggle = page.getByRole('button', { name: /思考过程/ })
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await toggle.click()
  await push(page, thought('继续分析。'))
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await toggle.click()
  await push(
    page,
    answer(
      Array.from({ length: 80 }, (_, i) => `第 ${i + 1} 段：这是一段用于验证阅读滚动的正文。`).join(
        '\n\n',
      ),
    ),
  )
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  // 等待长正文真正渲染，避免在内容仍很短时误判已经滚动到底部。
  await expect(page.locator('.answer-body p')).toHaveCount(80)
  const scroll = page.locator('.reply-scroll')
  await expect
    .poll(() => scroll.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop))
    .toBeLessThan(50)
  await scroll.evaluate((node) => {
    node.scrollTop = 100
    node.dispatchEvent(new Event('scroll'))
  })
  await expect(page.getByRole('button', { name: '回到最新' })).toBeVisible()
  await push(page, answer('\n\n新增正文，不应该抢走阅读位置。'))
  await expect(page.locator('.answer-body')).toContainText('新增正文')
  await expect.poll(() => scroll.evaluate((node) => node.scrollTop)).toBe(100)
  await page.getByRole('tab', { name: '原始响应' }).click()
  await page.getByRole('tab', { name: '模型回复' }).click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect.poll(() => scroll.evaluate((node) => node.scrollTop)).toBe(100)
  await page.getByRole('button', { name: '回到最新' }).click()
  await expect
    .poll(() => scroll.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop))
    .toBeLessThan(50)
  await push(page, '[DONE]')
  await expect(page.getByText('请求完成', { exact: true })).toBeVisible()
})

test('只有思考、思考取消，以及未闭合代码块', async ({ page }) => {
  await setupStream(page)
  await push(page, thought('没有最终正文的思考。'))
  await push(page, '[DONE]')
  await expect(page.getByText('请求完成，未返回正文。')).toBeVisible()
  await page.getByRole('button', { name: '开始测试' }).click()
  await push(page, thought('未完成的思考'))
  await expect(page.locator('.reasoning-details')).toContainText('未完成的思考')
  await page.getByRole('button', { name: '停止生成' }).click()
  await expect(page.locator('.reasoning-toggle')).toContainText('已中断')
  await page.getByRole('button', { name: '开始测试' }).click()
  await push(page, answer('```javascript\nconst partial = 1;'))
  await expect(page.locator('.answer-body pre')).toContainText('const partial = 1;')
  await push(page, answer('\nconsole.log(partial);\n```'))
  await push(page, '[DONE]')
  await expect(page.locator('.answer-body .code-block')).toHaveCount(1)
})

test('思考参数按协议独立保存，默认请求兼容，DeepSeek 参数与预算校验', async ({ page }) => {
  let request: any
  await page.route('https://settings.example.test/**', async (route) => {
    request = route.request().postDataJSON()
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [{ message: { content: '设置正确' }, finish_reason: 'stop' }],
      }),
    })
  })
  await page.goto('/')
  await page.getByLabel('Base URL').fill('https://settings.example.test/v1')
  await page.getByLabel('API Key', { exact: true }).fill('mock-key')
  await page.getByLabel('模型名称').fill('mock-model')
  await page.locator('.advanced summary').click()
  await page.getByLabel('参数风格').selectOption('deepseek')
  await page.getByLabel('思考模式', { exact: true }).selectOption('enabled')
  await page.getByLabel('思考强度', { exact: true }).selectOption('max')
  await page.getByRole('button', { name: '开始测试' }).click()
  await expect(page.getByText('请求完成', { exact: true })).toBeVisible()
  expect(request).toMatchObject({
    thinking: { type: 'enabled' },
    reasoning_effort: 'max',
    max_tokens: 32768,
  })
  expect(request).not.toHaveProperty('max_completion_tokens')
  await page.getByLabel('接口协议').selectOption('responses')
  await page.getByLabel('推理摘要', { exact: true }).selectOption('auto')
  await page.getByLabel('接口协议').selectOption('anthropic')
  await page.getByLabel('思考模式', { exact: true }).selectOption('enabled')
  await page.getByLabel('思考预算 token', { exact: true }).fill('32768')
  expect(
    await page
      .getByLabel('思考预算 token', { exact: true })
      .evaluate((node: HTMLInputElement) => node.checkValidity()),
  ).toBe(false)
  await page.getByLabel('思考预算 token', { exact: true }).fill('4096')
  await page.getByLabel('接口协议').selectOption('gemini')
  await page.getByLabel('思考策略').selectOption('budget')
  await page.getByLabel('思考预算（-1 动态 / 0 关闭）').fill('0')
  await page.getByLabel('返回思考摘要').selectOption('enabled')
  await page.reload()
  await page.locator('.advanced summary').click()
  await expect(page.getByLabel('思考预算（-1 动态 / 0 关闭）')).toHaveValue('0')
  await page.getByLabel('接口协议').selectOption('responses')
  await expect(page.getByLabel('推理摘要')).toHaveValue('auto')
  await page.getByLabel('接口协议').selectOption('chat')
  await expect(page.getByLabel('参数风格')).toHaveValue('deepseek')
  await expect(page.getByLabel('思考强度', { exact: true })).toHaveValue('max')
})

test('超大代码块跳过高亮，保留全文且错误公式不破坏排版', async ({ page }) => {
  await setupStream(page)
  const code = 'const value = 1;\n'.repeat(7000)
  await push(page, answer('```javascript\n' + code + '```\n\n错误公式：$\\frac{1}{$'))
  await push(page, '[DONE]')
  await expect(page.getByText('请求完成', { exact: true })).toBeVisible()
  await expect(page.locator('.answer-body pre code')).toHaveClass(/no-highlight/)
  expect((await page.locator('.answer-body pre code').textContent())?.length).toBe(code.length)
  await expect(page.locator('.answer-body .katex-error')).toContainText('\\frac{1}{')
})
