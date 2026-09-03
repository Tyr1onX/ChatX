# ChatX

**让 ChatGPT 安全地使用你电脑上的本地能力。**

ChatX 是一个运行在你电脑上的本地桥接器。连接完成后，ChatGPT 可以在你授权的项目范围内直接读取和修改文件、查看 Git、运行本地程序，并使用一个独立浏览器。

你不需要反复把代码、日志、目录结构复制到聊天里，也不需要一直操作 ChatX。正常情况下，ChatX 在后台运行，你只需要继续和 ChatGPT 对话。

[English](README.en.md) · [AI Agent 安装说明](docs/agent-setup.md) · [排障](docs/troubleshooting.md) · [安全说明](docs/security.md)

> 当前版本：`v0.1.0-alpha.2`。ChatX 仍处于 Alpha 阶段。
>
> ChatX 不会绕过 ChatGPT 本身的产品权限。如果你的账号 / 工作区没有自定义 MCP Connector、Developer Mode 或对应 Tunnel 能力，本机安装成功后 ChatGPT 仍可能无法连接。

## 平台支持

| 平台 | 当前状态 |
| --- | --- |
| Windows | ✅ 已完成真实环境使用与自动 CI 验证 |
| macOS | 🧪 已支持代码路径与 GitHub Actions 自动验证，等待真实 Mac + ChatGPT 端到端社区 Smoke |
| Linux | 🧪 核心功能有自动 CI 验证，真实桌面端到端验证仍有限 |

macOS 与 Windows 使用同一个 npm 包，不需要单独下载“Mac 版”。ChatX 会自动使用对应系统的状态目录、命令和浏览器路径。

macOS 独立浏览器目前会自动查找 Google Chrome、Microsoft Edge、Chromium 和 Chrome Canary；如果安装在非标准位置，可以设置 `CHATX_BROWSER_BIN` 指向浏览器可执行文件。

如果你有 Mac 并愿意帮忙验证完整链路，请参考 [macOS Compatibility Smoke](docs/macos-smoke.md)。

## 它能做什么？

连接到一个项目后，你可以直接对 ChatGPT 说：

- “看看这个项目为什么启动失败。”
- “检查一下当前 Git diff，有没有明显问题。”
- “把这个功能实现掉并跑测试。”
- “读取本地日志，帮我定位报错。”
- “打开 ChatX 的独立浏览器验证这个页面。”

背后实际是：

```text
ChatGPT
   ↓
安全连接
   ↓
ChatX（运行在你的电脑上）
   ↓
文件 / Git / 本地进程 / 独立浏览器
```

ChatX 不是远程桌面，也不会默认接管你平时使用的 Chrome。

## 使用前需要准备什么？

一个全新的用户要真正把 ChatX 用起来，需要同时满足 **本机环境** 和 **外部账号 / 连接条件**。

### 必须有

1. **一台可以运行 ChatX 的电脑**
   - Node.js 20+
   - 可以安装 `cloudflared`
   - 有一个你愿意让 ChatGPT 操作的本地项目目录

2. **一个能够使用自定义 MCP Connector 的 ChatGPT 账号 / Workspace**
   - 需要能进入 Developer Mode / 自定义 Connector 相关入口
   - 如果你的 ChatGPT 当前没有这项产品能力，ChatX 本机装好也无法完成最后连接

3. **能够登录 ChatGPT**
   - 首次连接时需要在 ChatGPT 中创建当前项目对应的 Connector，并完成 OAuth / 配对
   - 登录、验证码、2FA、明确授权确认等步骤通常需要你本人完成

### Cloudflare 域名不是必须的

ChatX 有两种常用公网连接方式：

**A. 临时地址（默认，最容易开始）**

- 不需要 Cloudflare 账号
- 不需要自己的域名
- ChatX 可以直接建立临时公网地址
- 缺点是电脑重启或 Tunnel 重建后地址可能变化，此时 ChatGPT 里的 Connector 需要更新 / 重新建立

**B. 固定域名（可选，长期使用更方便）**

如果你已经有：

- Cloudflare 账号
- 一个已经托管到 Cloudflare 的域名

ChatX 可以给当前 Workspace 配一个固定子域名。首次配置时需要登录一次 Cloudflare 并授权对应域名。

优点是地址稳定，电脑重启后通常不需要重新改 ChatGPT Connector。

> 所以：**没有 Cloudflare 账号或域名也完全可以用 ChatX。** 固定域名只是为了降低后续维护成本。

实验性的 OpenAI Secure MCP Tunnel 也已经有支持，但是否可用取决于对应 ChatGPT / OpenAI 账号能力，目前不作为普通用户默认路径。

## 安装

### 推荐：让 AI Agent 帮你装

如果你已经在使用 Codex、Claude Code、Cursor Agent 或其他能够操作本机终端的 AI Agent，推荐直接让它完成安装和后续连接准备。

重要的是：**让 Agent 不只“把软件装上”，而是一直跟到 ChatGPT Connector 和端到端验证完成。**

#### 用 Codex

把下面这段话发给 Codex：

```text
请帮我把 ChatX 安装到本机，并为我当前正在工作的项目完整配置好：
https://github.com/Tyr1onX/ChatX

先阅读仓库里的 skill/SKILL.md，并按其中的 first-time setup 完成。
不要只完成本机软件安装；还要检查 ChatGPT 自定义 MCP Connector 能力、连接地址选择、Connector/OAuth 配对和最终端到端验证。

如果我没有 Cloudflare 账号或域名，就使用临时地址；如果我已经有托管在 Cloudflare 的域名，可以询问我是否使用固定域名。

能自动完成的步骤都直接完成。只有登录、验证码、2FA、Cloudflare/ChatGPT 授权或必须由我确认的页面操作再叫我做，而且每次只告诉我当前必须完成的一步。
我完成后继续接着配置，不要把任务停在“请自行完成后续配置”。

完成后运行 chatx doctor，并确认：
1. 当前 Workspace 正确；
2. Bridge / 公网连接正常；
3. ChatGPT Connector 已连接；
4. ChatGPT 能真实读取当前 Workspace 的文件。

不要为了安装 ChatX 修改我项目的业务代码。
```

ChatX 已经为 Codex 提供专门的 `skill/SKILL.md`，里面包含安装、连接、维护和排障流程。

#### 其他 AI Agent

把下面这段话交给能够执行本机命令的 Agent：

```text
请帮我在这台电脑上完整安装并配置 ChatX：
https://github.com/Tyr1onX/ChatX

目标是让 ChatGPT 能安全访问我当前正在工作的项目目录。
请先阅读仓库里的 docs/agent-setup.md，并按其中流程完成。

不要把“npm 安装成功”当作完成。你还需要检查外部条件：
- ChatGPT 是否支持自定义 MCP Connector / Developer Mode；
- 当前使用临时地址还是 Cloudflare 固定域名；
- ChatGPT Connector / OAuth / 配对是否完成；
- 最后是否通过真实只读端到端验证。

能自动完成的步骤直接完成，不要让我手动复制命令。
只有遇到登录、验证码、2FA 或明确授权时再让我操作，而且每次只给我当前必须完成的一步；我完成后继续接着配置。
不要修改当前项目的业务代码来完成安装。
```

如果 Agent 能可靠操作 ChatGPT 的 Connector 设置，它可以继续把连接也配置好；如果不能，它应该明确告诉你唯一需要手工完成的当前步骤，并在你完成后继续验证，而不是提前宣布安装结束。

完整的 Agent 执行规范见 [docs/agent-setup.md](docs/agent-setup.md)。

### 手动安装

如果你希望自己完成，最短流程如下。

#### 1. 准备依赖

需要 Node.js 20+ 和 `cloudflared`。

Windows：

```powershell
winget install --id OpenJS.NodeJS.LTS
winget install --id Cloudflare.cloudflared
```

macOS：

```bash
brew install node cloudflared
```

#### 2. 安装 ChatX

```bash
npm install -g https://github.com/Tyr1onX/ChatX/releases/download/v0.1.0-alpha.2/chatx-local-bridge-0.1.0-alpha.2.tgz
```

确认：

```bash
chatx --version
```

#### 3. 在目标项目里启动

```bash
cd /path/to/your/project
chatx setup
```

ChatX 会启动本机 Bridge，并让你选择临时地址或固定域名，然后输出当前 Workspace 的连接地址和配对信息。

如果选择固定域名，需要按提示登录 Cloudflare 并授权你的域名；如果选择临时地址，不需要 Cloudflare 账号。

#### 4. 在 ChatGPT 添加当前 Workspace 的 Connector

你仍然需要让 ChatGPT 知道应该连接到哪里：

1. 确认 ChatGPT 已开放 Developer Mode / 自定义 MCP Connector
2. 新建当前 Workspace 对应的 Connector
3. Server URL 使用 `chatx setup` 输出的 MCP 地址
4. Authentication 使用 OAuth
5. 按授权页面提示输入 ChatX 的一次性配对码

如果配对码过期，可以运行：

```bash
chatx pair
```

连接后先测试一个只读任务：

```text
列出当前 ChatX 工作区的顶层文件，不要修改任何内容。
```

如果 ChatGPT 能看到你本机项目的真实文件，才说明 **本机 ChatX → 公网连接 → ChatGPT Connector → 当前 Workspace** 的完整链路真的配置完成。

## 日常使用与后续维护

安装完成后，通常不需要再操作 ChatX。直接和 ChatGPT 说你要做什么即可。

需要检查状态或自动修复时：

```bash
chatx doctor
```

常见的后续情况：

- **临时地址变化**：让你的 Agent 运行 `chatx doctor`，并继续修复 / 更新当前 Workspace 的 ChatGPT Connector
- **配对码过期**：`chatx pair`
- **Bridge / Tunnel 异常**：优先 `chatx doctor`，必要时 `chatx restart`
- **固定域名需要重新授权 Cloudflare**：Agent 应只让你完成登录 / 授权，然后继续后面的验证
- **ChatGPT 账号没有 Connector 权限**：这是外部产品权限问题，不能靠重装 ChatX 解决

常用命令：

```bash
chatx status     # 查看当前状态
chatx doctor     # 检查并自动修复
chatx pair       # 重新生成配对码
chatx logs       # 查看日志
chatx stop       # 停止当前 Workspace 的 Bridge
```

更完整的问题处理见 [排障文档](docs/troubleshooting.md)。

## 安全

ChatX 可以获得较强的本机能力，因此请只把它连接到你信任的 AI 客户端，并只授权你愿意开放的项目。

默认情况下 ChatX 会限制 Workspace 路径，并阻止读取 `.env`、SSH 私钥、云凭据等常见敏感文件；浏览器也使用独立 Profile。

但 `process.run` 启动的程序仍然拥有当前操作系统用户本身具备的权限，因此它不是一个完整的主机沙箱。

详细边界见 [安全说明](docs/security.md)。

## 更多文档

- [给 AI Agent 的安装说明](docs/agent-setup.md)
- [macOS Compatibility Smoke](docs/macos-smoke.md)
- [排障](docs/troubleshooting.md)
- [安全模型](docs/security.md)
- [架构](docs/architecture.md)
- [协议](docs/protocol.md)
- [英文 README](README.en.md)

开发、CI、发布和内部实现细节不再放在首页 README 中，需要时直接查看仓库源码和对应文档。

ChatX 是非官方社区项目，与 OpenAI、Cloudflare 无隶属或背书关系。
