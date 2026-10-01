import { expect, test } from '@playwright/test'

test('预置示例切换保留完整动画与控制，不修改配置或发起模型请求', async ({ page }) => {
  const modelRequests: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'POST') modelRequests.push(request.url())
  })
  await page.goto('/')
  const savedConfig = await page.evaluate(() => localStorage.getItem('pelican-lab.config.v1'))
  const model = await page.getByLabel('模型名称').inputValue()
  const protocol = await page.getByLabel('接口协议').inputValue()
  const baseUrl = await page.getByLabel('Base URL').inputValue()
  const selector = page.getByRole('group', { name: '示例模型' })
  const gpt = selector.getByRole('button', { name: 'GPT', exact: true })
  const claude = selector.getByRole('button', { name: 'Claude', exact: true })
  const frame = page.frameLocator('#example-frame')

  await expect(gpt).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.example-model')).toHaveText('gpt-6.1-sol')
  await expect(page.locator('#example-frame')).toHaveAttribute('sandbox', 'allow-scripts')
  await expect(frame.getByRole('heading', { name: '海风骑行' })).toBeVisible()
  const firstRotation = await frame.locator('#rear-spokes').getAttribute('transform')
  await expect
    .poll(() => frame.locator('#rear-spokes').getAttribute('transform'))
    .not.toBe(firstRotation)
  await frame.getByRole('button', { name: '暂停动画' }).click()
  await expect(frame.getByRole('button', { name: '播放动画' })).toBeVisible()
  await frame.getByRole('button', { name: '骑行速度 1.5 倍' }).click()
  await expect(frame.getByRole('button', { name: '骑行速度 1.5 倍' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await frame.getByRole('button', { name: '播放动画' }).click()

  await claude.click()
  await expect(claude).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.example-model')).toHaveText('opus-5.5')
  await expect(page.locator('iframe')).toHaveCount(1)
  await expect(frame.getByRole('heading', { name: '海边骑行' })).toBeVisible()
  const claudeRotation = await frame.locator('#rear-wheel').getAttribute('transform')
  await expect
    .poll(() => frame.locator('#rear-wheel').getAttribute('transform'))
    .not.toBe(claudeRotation)
  await frame.getByRole('button', { name: '暂停动画' }).click()
  await expect(frame.getByRole('button', { name: '播放动画' })).toBeVisible()
  // 原页面的速度标签包含实时倍率，使用滑块角色匹配完整可访问名称。
  const speed = frame.getByRole('slider', { name: /速度/ })
  await speed.focus()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await expect(speed).toHaveValue('1.5')
  await expect(frame.locator('#speed-value')).toHaveText('1.5×')
  await frame.getByRole('button', { name: '播放动画' }).click()

  await gpt.click()
  await expect(frame.getByRole('heading', { name: '海风骑行' })).toBeVisible()
  // 重新挂载原始页面，返回 GPT 时速度恢复默认，而不是复用旧动画。
  await expect(frame.getByRole('button', { name: '骑行速度 1 倍', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.getByLabel('模型名称')).toHaveValue(model)
  await expect(page.getByLabel('接口协议')).toHaveValue(protocol)
  await expect(page.getByLabel('Base URL')).toHaveValue(baseUrl)
  expect(await page.evaluate(() => localStorage.getItem('pelican-lab.config.v1'))).toBe(savedConfig)
  expect(modelRequests).toEqual([])
  await expect(page.getByRole('button', { name: '复制回复', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: '下载 HTML' })).toBeDisabled()
  await expect(page.locator('.metrics strong')).toHaveText(['未提供', '未提供', '未提供', '未提供'])
})

test('示例支持键盘切换、手机布局、等待视图与刷新默认值', async ({ page }) => {
  await page.goto('/')
  const selector = page.getByRole('group', { name: '示例模型' })
  const gpt = selector.getByRole('button', { name: 'GPT', exact: true })
  const claude = selector.getByRole('button', { name: 'Claude', exact: true })
  await gpt.focus()
  await page.keyboard.press('ArrowRight')
  await expect(claude).toBeFocused()
  await expect(claude).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('ArrowLeft')
  await expect(gpt).toBeFocused()
  await expect(gpt).toHaveAttribute('aria-pressed', 'true')
  await expect(
    page.frameLocator('#example-frame').getByRole('heading', { name: '海风骑行' }),
  ).toBeVisible()
  await page.screenshot({ path: 'test-results/examples-desktop-gpt.png', fullPage: true })
  await claude.click()
  await expect(
    page.frameLocator('#example-frame').getByRole('heading', { name: '海边骑行' }),
  ).toBeVisible()
  await page.screenshot({ path: 'test-results/examples-desktop-claude.png', fullPage: true })

  await page.setViewportSize({ width: 390, height: 844 })
  for (const label of ['GPT', 'Claude']) {
    await selector.getByRole('button', { name: label, exact: true }).click()
    await expect(page.locator('#example-frame')).toHaveAttribute(
      'title',
      `${label} 鹈鹕骑行预置示例`,
    )
    await expect(page.frameLocator('#example-frame').locator('.scene')).toBeVisible()
    // 画面底部应位于 iframe 的初始视口内，避免仅验证元素存在却截断车轮。
    expect(
      await page
        .frameLocator('#example-frame')
        .locator('.scene')
        .evaluate((node) => node.getBoundingClientRect().bottom <= window.innerHeight),
    ).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    const previewBounds = await page.locator('#example-frame').boundingBox()
    expect(previewBounds?.width).toBeGreaterThan(0)
    expect((previewBounds?.x ?? 0) + (previewBounds?.width ?? 0)).toBeLessThanOrEqual(390)
    await page.screenshot({
      path: `test-results/examples-mobile-${label.toLowerCase()}.png`,
      fullPage: true,
    })
  }
  await page.getByRole('tab', { name: '模型回复' }).click()
  await expect(page.getByRole('heading', { name: '等待模型回复' })).toBeVisible()
  await expect(page.locator('iframe')).toHaveCount(0)
  await page.getByRole('tab', { name: '原始响应' }).click()
  await expect(page.getByRole('heading', { name: '等待原始响应' })).toBeVisible()
  await expect(page.locator('iframe')).toHaveCount(0)
  await page.reload()
  await expect(gpt).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('tab', { name: '动画预览' })).toHaveAttribute('aria-selected', 'true')
})

test('开始测试后退出预置示例，错误、生成作品及普通回复沿用结果流程', async ({ page }) => {
  let requestCount = 0
  await page.route('https://api.example.test/v1/chat/completions', async (route) => {
    requestCount++
    await route.fulfill(
      requestCount === 1
        ? {
            status: 401,
            contentType: 'application/json',
            body: JSON.stringify({ error: { message: 'Invalid API key' } }),
          }
        : {
            contentType: 'application/json',
            body: JSON.stringify({
              choices: [
                {
                  message: {
                    content:
                      requestCount === 2
                        ? '```html\n<html><body><h1>我的生成作品</h1></body></html>\n```'
                        : '普通回复成功',
                  },
                  finish_reason: 'stop',
                },
              ],
            }),
          },
    )
  })
  await page.goto('/')
  await expect(page.locator('#example-frame')).toBeVisible()
  await page.getByLabel('Base URL').fill('https://api.example.test/v1')
  await page.getByLabel('API Key', { exact: true }).fill('mock-key')
  await page.getByLabel('模型名称').fill('mock-model')
  await page.getByRole('button', { name: '开始测试' }).click()
  await expect(page.getByRole('alert')).toContainText('HTTP 401')
  await expect(page.locator('.example-preview')).toHaveCount(0)
  await page.getByRole('tab', { name: '动画预览' }).click()
  await expect(page.getByRole('heading', { name: '这里还没有可预览的作品' })).toBeVisible()

  await page.getByRole('button', { name: '开始测试' }).click()
  await expect(page.getByText('请求完成', { exact: true })).toBeVisible()
  await expect(page.locator('.example-preview')).toHaveCount(0)
  await expect(
    page.frameLocator('iframe').getByRole('heading', { name: '我的生成作品' }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: '下载 HTML' })).toBeEnabled()

  await page.getByRole('button', { name: '开始测试' }).click()
  await expect(page.locator('.answer-body')).toHaveText('普通回复成功')
  await page.getByRole('tab', { name: '动画预览' }).click()
  await expect(page.getByRole('heading', { name: '这里还没有可预览的作品' })).toBeVisible()
  await expect(page.locator('iframe')).toHaveCount(0)
  expect(requestCount).toBe(3)
})
