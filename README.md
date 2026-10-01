# Pelican Lab · 鹈鹕模型测试工作台

自带 API Key 的纯前端模型测试网页，基于 React、TypeScript 和 Vite。无需后端，支持 OpenAI Chat Completions、OpenAI Responses、Anthropic Messages 和 Gemini 原生协议。

## 本地启动

需要 Node.js 22.12+（或 24 LTS）。

```bash
npm ci
npm run dev
```

打开终端显示的地址，默认是 `http://127.0.0.1:5173`。

## 使用方法

首次打开时，动画预览默认展示 GPT 的鹈鹕骑行作品；上方 GPT / Claude 按钮可点击或用左右方向键切换完整动画示例。示例保留暂停与速度控制，不会发起模型请求或修改连接配置。开始测试后，此区域展示你的生成结果。

1. 选择接口协议。兼容 OpenAI 的服务可选择 Chat Completions。
2. 填写 Base URL、API Key 和服务商提供的准确模型 ID。
3. 保留默认鹈鹕提示词，或输入任意文本任务。支持复制、清空和恢复默认。
4. 点击“开始测试”，或按 Ctrl/Cmd + Enter。生成过程中可以停止。
5. 查看流式回复、首段正文耗时、总耗时和真实 token 用量。成功返回 HTML/SVG 后自动进入动画预览，多个作品可以切换；也可查看原始响应、复制正文和下载 HTML。

每次请求只有当前提示词，不包含隐藏系统提示词或历史消息。不会自动重试，不会主动拉取模型列表。普通文本回复同样支持。

### Base URL 规则

Base URL 是包含版本号的完整接口前缀，不是完整生成接口 URL。程序只去掉尾部斜杠并追加下列路径，不擅自增删版本号或中转前缀。

| 协议                    | 默认 Base URL                                      | 追加路径                                        |
| ----------------------- | -------------------------------------------------- | ----------------------------------------------- |
| OpenAI Chat Completions | `https://api.openai.com/v1`                        | `/chat/completions`                             |
| OpenAI Responses        | `https://api.openai.com/v1`                        | `/responses`                                    |
| Anthropic Messages      | `https://api.anthropic.com/v1`                     | `/messages`                                     |
| Gemini                  | `https://generativelanguage.googleapis.com/v1beta` | `/models/{model}:streamGenerateContent?alt=sse` |

Gemini 关闭流式后使用 `:generateContent`。模型 ID 可以带 `models/` 前缀。修改协议时，官方默认地址会随之切换；自定义中转前缀会保留。Base URL 不能包含账号密码、查询参数或 URL 片段，页面实时显示最终请求地址。

### 参数与兼容性

- 默认流式输出，最大输出 token 为 32768；temperature 留空时不发送。
- Chat Completions 默认 OpenAI 参数风格，使用 `max_completion_tokens`；切换 DeepSeek 风格后使用 `max_tokens`。流式请求携带 `stream_options.include_usage`，请确认兼容服务支持。
- Responses 使用 `max_output_tokens`，并设置 `store: false`。
- Anthropic 使用 `max_tokens`、`anthropic-version: 2023-06-01` 和浏览器直连请求头。
- Gemini 使用 `generationConfig.maxOutputTokens`，API Key 放在请求头中。
- 各模型可接受的 token 上限和 temperature 参数不同，以服务商返回的校验结果为准。
- “高级设置”可修改最大输出 token、请求总超时（秒）和响应大小上限（MiB），标题旁显示当前限制摘要，修改后自动保存。
- 默认总超时 1800 秒（30 分钟），响应大小不限。超时或大小填 0 表示不限制；token 必须为正整数，另两项为非负整数。这些本地设置不能解除模型服务自身的 token、超时和连接限制。
- 超时从请求发起时开始计算，手动停止始终可用。自定义大小上限按实际读取的 UTF-8 字节累计（1 MiB = 1,048,576 字节），包括 SSE 事件信息；流式、非流式和 HTTP 错误响应使用同一上限。达到上限时保留上限内的原始内容与已解析正文，并明确提示调整设置。
- 超时、取消、达到 token 上限、流内错误或中途断流时保留已有内容，并明确标记未成功完成。界面更新每 100 毫秒合并一次，结束、错误或取消时立即刷新；不会偷偷截断正文或原始响应。
- 用量缺失时显示“未提供”，不会伪造或估算 token 数。首段正文耗时不包含单独的思考事件。

### 思考设置与回复阅读

高级设置中的“思考设置”按协议独立保存。所有新增选项初始使用服务默认，不追加思考参数；只有主动选择后才发送。不同模型支持的值不同，服务端拒绝时保留原始错误，不修改参数或重试。

| 协议 / 风格 | 可配置参数 |
| --- | --- |
| Chat / OpenAI | `reasoning_effort`：none、minimal、low、medium、high、xhigh、max |
| Chat / DeepSeek | `thinking.type`：开启或关闭；开启时可指定 `reasoning_effort`：low、high、max |
| Responses | `reasoning.effort`，以及 `reasoning.summary`：auto、concise、detailed |
| Anthropic | `thinking.type`：关闭、自适应、手动预算；手动 `budget_tokens` 至少 1024 且小于最大输出 token；自适应可设置 `output_config.effort`；开启时可设置 `thinking.display` |
| Gemini | `generationConfig.thinkingConfig`：等级与预算二选一，预算支持 -1 动态、0 关闭；`includeThoughts` 控制是否返回思考摘要 |

例如 DeepSeek：选择 Chat Completions，在高级设置中将参数风格改为 DeepSeek，再按需开启思考模式和设置强度。保持默认时由模型服务决定。

- 思考区只显示 API 实际返回的结构化可读内容；摘要标为“思考摘要”，签名与加密思考不作为思考文本展示，不从正文的 `<think>` 标签猜测内容。原始响应页签仍保留接口数据。
- 收到思考内容时自动展开，开始正文后自动收起；手动展开或收起后，本次请求始终尊重该选择。切换预览、回复和原始响应时保留展开状态与阅读位置。
- 流式显示的是客户端观察到的思考接收时长，不代表模型计算时间；非流式不推算。只有思考而无正文的正常响应显示“请求完成，未返回正文”；异常、超时、取消仍保留相应失败状态和部分内容。
- 正文支持 Markdown 标题、列表、引用、表格、代码高亮和数学公式。代码块可独立复制，超过 100,000 字符时仅跳过高亮、全文仍可阅读和复制。公式解析失败时保留可读原文，未闭合的流式代码块仍可阅读。
- 顶部复制按钮复制完整正文 Markdown；思考区单独复制思考。预览提取和 HTML 下载只使用正文。靠近底部时自动跟随，向上阅读后停止跟随，点击“回到最新”可继续。

思考参数参考：[OpenAI](https://developers.openai.com/api/docs/guides/reasoning)、[DeepSeek](https://api-docs.deepseek.com/guides/thinking_mode/)、[Anthropic](https://platform.claude.com/docs/en/build-with-claude/thinking)、[Gemini](https://ai.google.dev/gemini-api/docs/generate-content/thinking)。

## 隐私与浏览器限制

请求由浏览器直接发送到用户指定地址，密钥不会交给本站后端。无分析统计、外部字体或自动第三方请求。请求不会携带浏览器 Cookie，也不跟随重定向。

配置和提示词自动保存在 `localStorage`。密钥默认仅在页面内存中；仅勾选“记住密钥”后才以明文保存在当前浏览器。取消勾选立即清除已保存的密钥。浏览器禁用存储时仍可临时使用。

旧配置会进行一次性迁移：旧默认 token 值 8192 升级为 32768，其他自定义 token 值保留；缺少的超时和响应大小字段补为 1800 秒与不限大小。地址、模型、提示词和密钥保存选择不变。新版再次手动设置为 8192 时不会重复升级。

当前配置版本为 3，升级只补齐思考字段；版本 2 起保存的 8192 会原样保留，不重复执行旧默认值迁移。

目标 API 必须允许网页来源的跨域请求和所需鉴权头；HTTPS 网页通常不能调用 HTTP 服务。`fetch` 的网络错误无法精确区分 CORS、DNS 或 TLS 问题，可结合浏览器网络面板检查。纯前端网页无法绕过服务端 CORS 限制。

模型正文和思考采用安全 Markdown 渲染，主页面不执行模型 HTML；链接只允许 HTTP(S)、mailto 和页内锚点，远程图片显示占位说明。数学公式字体与代码高亮随构建打包，无需 CDN。原始响应按纯文本展示。HTML/SVG 在只有 `allow-scripts` 权限的 iframe 中执行，不开放同源、弹窗、表单或顶层导航；CSP 禁止外部脚本、样式、图片与网络接口。预览不与父页面交换消息。需要 CDN、远程图片等外部资源的作品可能显示不完整。HTML 下载保留同样的资源限制。此预览用于查看自带密钥的模型输出，不作为任意恶意程序的执行服务。

## 构建与部署

```bash
npm run build
npm run preview
```

构建产物在 `dist/`，可部署到任意静态托管，例如 Nginx、GitHub Pages 或 Cloudflare Pages。使用相对资源路径，支持子目录部署。通过 HTTP(S) 服务器访问，不建议直接双击 `index.html`。不存在生产环境后端代理，部署时不需要配置服务端密钥。

## 测试

```bash
npm test
npx playwright install chromium
npm run test:e2e
```

也可以使用已安装的 Chrome，在 PowerShell 中运行：

```powershell
$env:PLAYWRIGHT_CHANNEL = 'chrome'
npm run test:e2e
```

单元测试覆盖四种协议、中文逐字节流解析、用量、结束事件、错误、取消、超时和本地保存。浏览器测试使用拦截的模拟 API，验证编辑、复制、持久化、键盘操作、桌面/手机布局、动画播放、沙盒隔离、下载和错误恢复。截图输出到 `test-results/`。

思考相关测试还覆盖默认不发送参数、预算校验、结构化思考与正文分离、完成事件去重、仅思考与中断、配置版本迁移；浏览器验证折叠与手动优先、阅读位置和滚动跟随、代码复制、表格/公式、安全链接与图片占位、长代码和流式未闭合代码块。

**未使用真实密钥调用收费 API；模拟测试通过不等同于真实服务连接已经验证。**

## 代码结构

- `src/App.tsx` / `styles.css`：工作台界面与响应式布局。
- `src/protocols.ts` / `runner.ts`：协议适配、SSE 流解析和请求生命周期。
- `src/thinking.ts` / `reasoning.ts`：思考设置校验、请求参数和结构化思考解析。
- `src/ThinkingSettings.tsx` / `ReplyViewer.tsx` / `MarkdownContent.tsx`：思考配置、折叠与滚动阅读、安全 Markdown 排版。
- `src/preview.ts`：作品提取和沙盒文档构造。
- `src/config.ts` / `types.ts`：默认提示词、配置持久化和公共内部类型。
- `src/ExamplePreview.tsx`：首次测试前的 GPT / Claude 预置动画切换，加载 `public/` 中的完整 HTML 示例。

协议参考：[OpenAI Chat Completions](https://platform.openai.com/docs/api-reference/chat/create)、[OpenAI Responses](https://platform.openai.com/docs/api-reference/responses)、[Anthropic Messages](https://platform.claude.com/docs/en/api/messages/create)、[Gemini Generate Content](https://ai.google.dev/api/generate-content)。
