import { test, expect } from '@playwright/test'

test('限制设置迁移和保存、超限反馈，以及超过旧阈值后完成预览', async ({ page }) => {
  const event = (content: string) =>
    `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`
  const html =
    '<html><body><h1>长响应预览成功</h1><svg width="200" height="80"><circle id="long-ball" cx="20" cy="40" r="15" fill="teal"><animate attributeName="cx" from="20" to="180" dur="1s" repeatCount="indefinite" /></circle></svg></body></html>'
  const metadata = (': ' + 'x'.repeat(1000) + '\n\n').repeat(8000)
  const body =
    event('```html\n') +
    metadata +
    event(html + '\n```') +
    'data: {"choices":[],"usage":{"prompt_tokens":31,"completion_tokens":71}}\n\ndata: [DONE]\n\n'
  expect(body.length).toBeGreaterThan(8_000_000)
  await page.route('https://api.example.test/v1/chat/completions', async (route) => {
    expect(route.request().postDataJSON()).toMatchObject({ max_completion_tokens: 65536 })
    expect(route.request().postDataJSON()).not.toHaveProperty('timeoutSeconds')
    expect(route.request().postDataJSON()).not.toHaveProperty('maxResponseMiB')
    await route.fulfill({ contentType: 'text/event-stream', body })
  })
  await page.goto('/')
  await page.evaluate(() =>
    localStorage.setItem(
      'pelican-lab.config.v1',
      JSON.stringify({
        protocol: 'chat',
        baseUrl: 'https://api.example.test/v1',
        apiKey: 'mock-key',
        rememberKey: true,
        model: 'mock-model',
        prompt: '请生成动画',
        maxTokens: 8192,
      }),
    ),
  )
  await page.reload()
  await expect(page.locator('.limit-summary')).toHaveText('32,768 tok · 30 分钟 · 大小不限')
  await page.locator('.advanced summary').click()
  await expect(page.getByLabel('最大输出 token', { exact: true })).toHaveValue('32768')
  await expect(page.getByLabel('请求总超时（秒）', { exact: true })).toHaveValue('1800')
  await expect(page.getByLabel('响应大小上限（MiB）', { exact: true })).toHaveValue('0')
  await expect(page.getByLabel('API Key', { exact: true })).toHaveValue('mock-key')
  await page.getByLabel('最大输出 token', { exact: true }).fill('65536')
  await page.getByLabel('请求总超时（秒）', { exact: true }).fill('0')
  await page.getByLabel('响应大小上限（MiB）', { exact: true }).fill('1')
  await page.reload()
  await expect(page.locator('.limit-summary')).toHaveText('65,536 tok · 不限时 · 1 MiB')
  await page.locator('.advanced summary').click()
  await expect(page.getByLabel('最大输出 token', { exact: true })).toHaveValue('65536')
  await expect(page.getByLabel('请求总超时（秒）', { exact: true })).toHaveValue('0')
  await expect(page.getByLabel('响应大小上限（MiB）', { exact: true })).toHaveValue('1')
  await page.screenshot({ path: 'test-results/limits-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.screenshot({ path: 'test-results/limits-mobile.png', fullPage: true })
  await page.getByRole('button', { name: '开始测试' }).click()
  await expect(page.getByRole('alert')).toContainText('1 MiB')
  await expect(page.locator('.answer-body .code-block')).toBeVisible()
  await page.getByLabel('响应大小上限（MiB）', { exact: true }).fill('0')
  await page.getByRole('button', { name: '开始测试' }).click()
  await expect(page.getByText('请求完成', { exact: true })).toBeVisible({ timeout: 15_000 })
  const frame = page.frameLocator('iframe')
  await expect(frame.getByRole('heading', { name: '长响应预览成功' })).toBeVisible()
  const position = await frame
    .locator('#long-ball')
    .evaluate((node: SVGCircleElement) => node.cx.animVal.value)
  await expect
    .poll(() =>
      frame.locator('#long-ball').evaluate((node: SVGCircleElement) => node.cx.animVal.value),
    )
    .not.toBe(position)
  await expect(page.locator('.metrics')).toContainText('31')
  await expect(page.locator('.metrics')).toContainText('71')
  await page.getByRole('tab', { name: '原始响应' }).click()
  const raw = await page.locator('.text-output pre').textContent()
  expect(raw?.length).toBe(body.length)
  expect(raw?.endsWith('data: [DONE]\n\n')).toBe(true)
})

test('桌面和手机布局、提示词、键盘和密钥保存', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '让模型，骑上自行车。' })).toBeVisible()
  await page.screenshot({ path: 'test-results/desktop.png', fullPage: true })
  const prompt = page.getByLabel('提示词', { exact: true })
  const defaultPrompt = await prompt.inputValue()
  await page.getByRole('button', { name: '复制提示词' }).click()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(defaultPrompt)
  await page.getByRole('button', { name: '清空提示词' }).click()
  await expect(prompt).toHaveValue('')
  await page.getByRole('button', { name: '恢复默认' }).click()
  await expect(prompt).toHaveValue(defaultPrompt)
  await page.getByLabel('API Key', { exact: true }).fill('temporary-secret')
  await page.getByLabel('模型名称').fill('mock-model')
  await page.reload()
  await expect(page.getByLabel('API Key', { exact: true })).toHaveValue('')
  await expect(page.getByLabel('模型名称')).toHaveValue('mock-model')
  await page.getByLabel('API Key', { exact: true }).fill('remembered-secret')
  await page.getByLabel('在此浏览器记住密钥').check()
  await page.reload()
  await expect(page.getByLabel('API Key', { exact: true })).toHaveValue('remembered-secret')
  await page.getByLabel('在此浏览器记住密钥').uncheck()
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('remembered-secret')
  await page.getByRole('tab', { name: '动画预览' }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('tab', { name: '原始响应' })).toBeFocused()
  await page.getByRole('tab', { name: '动画预览' }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.getByRole('button', { name: '使用指南' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).not.toBeVisible()
})

test('流式生成、沙盒动画、隔离验证、下载与多作品切换', async ({ page }) => {
  const external: string[] = []
  await page.route('https://blocked.example/**', async (route) => {
    external.push(route.request().url())
    await route.abort()
  })
  const source = `<!doctype html><html><body><h1>测试动画</h1><svg width="200" height="80"><circle id="ball" cx="20" cy="40" r="15" fill="teal"><animate attributeName="cx" from="20" to="180" dur="1s" repeatCount="indefinite" /></circle></svg><script>document.body.dataset.ran='yes';try{parent.localStorage.getItem('pelican-lab.config.v1');document.body.dataset.isolated='no'}catch{document.body.dataset.isolated='yes'}fetch('https://blocked.example/fetch').catch(()=>document.body.dataset.blocked='yes')</script><img src="https://blocked.example/image.png"></body></html>`
  const text =
    '```html\n' +
    source +
    '\n```\n```svg\n<svg xmlns="http://www.w3.org/2000/svg"><text y="20">第二作品</text></svg>\n```'
  await page.route('https://api.example.test/v1/chat/completions', async (route) => {
    expect(route.request().headers().authorization).toBe('Bearer mock-key')
    const body = route.request().postDataJSON()
    expect(body.messages).toHaveLength(1)
    await route.fulfill({
      contentType: 'text/event-stream',
      body: `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 13, completion_tokens: 89 } })}\n\ndata: [DONE]\n\n`,
    })
  })
  await page.goto('/')
  await page.getByLabel('Base URL').fill('https://api.example.test/v1')
  await page.getByLabel('API Key', { exact: true }).fill('mock-key')
  await page.getByLabel('模型名称').fill('mock-model')
  await page.getByRole('button', { name: '开始测试' }).click()
  await expect(page.getByText('请求完成', { exact: true })).toBeVisible()
  const frame = page.frameLocator('iframe')
  await expect(frame.getByRole('heading', { name: '测试动画' })).toBeVisible()
  await expect(frame.locator('body')).toHaveAttribute('data-ran', 'yes')
  await expect(frame.locator('body')).toHaveAttribute('data-isolated', 'yes')
  await expect(frame.locator('body')).toHaveAttribute('data-blocked', 'yes')
  expect(external).toEqual([])
  expect(await page.locator('iframe').getAttribute('sandbox')).toBe('allow-scripts')
  const firstPosition = await frame
    .locator('#ball')
    .evaluate((node: SVGCircleElement) => node.cx.animVal.value)
  await expect
    .poll(() => frame.locator('#ball').evaluate((node: SVGCircleElement) => node.cx.animVal.value))
    .not.toBe(firstPosition)
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载 HTML' }).click()
  expect((await downloading).suggestedFilename()).toBe('pelican-result.html')
  await page.getByLabel('选择预览作品').selectOption('1')
  await expect(frame.getByText('第二作品')).toBeVisible()
  await page.getByRole('tab', { name: '模型回复' }).click()
  await expect(page.locator('.answer-body')).toContainText('测试动画')
  await page.getByRole('tab', { name: '原始响应' }).click()
  await expect(page.locator('.text-output pre')).toContainText('[DONE]')
})

test('HTTP 错误可读且下一次测试能够恢复', async ({ page }) => {
  let count = 0
  await page.route('https://api.example.test/**', async (route) => {
    count++
    await route.fulfill(
      count === 1
        ? {
            status: 401,
            contentType: 'application/json',
            body: JSON.stringify({ error: { message: 'Invalid API key' } }),
          }
        : {
            contentType: 'application/json',
            body: JSON.stringify({
              choices: [{ message: { content: '普通回复成功' }, finish_reason: 'stop' }],
            }),
          },
    )
  })
  await page.goto('/')
  await page.getByLabel('Base URL').fill('https://api.example.test/v1')
  await page.getByLabel('API Key', { exact: true }).fill('mock-key')
  await page.getByLabel('模型名称').fill('mock-model')
  await page.getByRole('button', { name: '开始测试' }).click()
  await expect(page.getByRole('alert')).toContainText('HTTP 401')
  await page.getByRole('button', { name: '开始测试' }).click()
  await expect(page.getByText('请求完成', { exact: true })).toBeVisible()
  await expect(page.locator('.answer-body')).toHaveText('普通回复成功')
  await page.getByRole('tab', { name: '动画预览' }).click()
  await expect(page.getByText('这里还没有可预览的作品')).toBeVisible()
})
