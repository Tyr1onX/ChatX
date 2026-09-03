# ChatX

**让 ChatGPT 安全地使用你电脑上的本地能力。**

ChatX 是运行在你电脑上的本地桥接器。连接完成后，ChatGPT 可以在你授权的项目范围内读取和修改文件、查看 Git、运行本地程序，并使用独立浏览器。

正常情况下 ChatX 在后台运行，你只需要继续和 ChatGPT 对话。

[English](README.en.md) · [AI Agent 安装说明](docs/agent-setup.md) · [排障](docs/troubleshooting.md) · [安全说明](docs/security.md)

> **最新公开 Release：`v0.1.0-alpha.1`**  
> `main` 已进入 `v0.1.0-alpha.2` 候选状态，并包含第一版 macOS 支持。新的 prerelease 尚未发布，因此 macOS 测试请按 [macOS Compatibility Smoke](docs/macos-smoke.md) 使用源码安装。

## 它能做什么？

连接一个项目后，你可以直接让 ChatGPT：

- 检查项目为什么启动失败
- 查看 Git 状态和 diff
- 修改文件并运行测试
- 读取本地日志定位问题
- 使用 ChatX 的独立浏览器验证页面

```text
ChatGPT
   ↓
安全连接
   ↓
ChatX（本机后台运行）
   ↓
Workspace / Git / Process / Browser
```

ChatX 不是远程桌面，也不会默认接管你平时使用的浏览器。

## 平台支持

| 平台 | 当前状态 |
| --- | --- |
| Windows | ✅ 真实环境使用 + CI 已验证 |
| macOS | 🧪 源码已通过 macOS Node 20/22 CI，并真实启动独立浏览器完成 Smoke；等待社区真实 Mac + ChatGPT 端到端验证 |
| Linux | 🧪 核心 CI 已验证，真实桌面端到端覆盖仍有限 |

macOS 和 Windows 使用同一套 ChatX 代码，不维护独立“Mac 版”。

macOS 会自动查找 Google Chrome、Microsoft Edge、Chromium 和 Chrome Canary。非标准安装位置可以通过 `CHATX_BROWSER_BIN` 指定浏览器可执行文件。

## 推荐安装方式：交给 Codex / AI Agent

普通用户不需要自己处理 Node、Bridge、端口、Tunnel 或本地配置。

把下面这段话直接交给 Codex：

```text
请帮我把 ChatX 安装并完整配置到当前项目：
https://github.com/Tyr1onX/ChatX

先阅读 skill/SKILL.md，按 first-time setup 执行。
本机安装、Workspace、Bridge、cloudflared、Cloudflare 连接、chatx setup、诊断和验证都由你自己完成。
只有 Cloudflare 登录/授权、ChatGPT 页面授权或其他必须由我本人确认的步骤再叫我操作，而且每次只告诉我当前一步。

ChatGPT 端只使用已经验证过的路线：
设置 → 插件 → 新插件 → 服务器 URL → 粘贴 ChatX 输出的 URL → 身份验证选择 OAuth → 创建并完成授权/配对。
不要引导我寻找 Developer Mode，也不要根据套餐猜测另一套 MCP 接入路径。

最后确认 ChatGPT 能真实读取当前 Workspace。
不要修改项目业务代码来完成 ChatX 安装。
```

其他能够操作本机终端的 AI Agent 使用：

```text
请帮我完整安装并配置 ChatX：
https://github.com/Tyr1onX/ChatX

先阅读 docs/agent-setup.md，并持续执行到 ChatGPT 能真实读取当前 Workspace 为止。
能自动完成的步骤全部自己完成；只在登录、授权、OAuth 或必须由我本人确认时让我操作。
ChatGPT 端只走「设置 → 插件 → 新插件 → 服务器 URL → OAuth」这条已经验证过的路线。
不要引导我寻找 Developer Mode。
```

完整 Agent 执行规范见 [docs/agent-setup.md](docs/agent-setup.md)。

## 用户实际需要做什么？

正常首次安装中，用户只需要处理两类不能可靠代办的动作：

1. **Cloudflare 登录 / 授权**：仅在 Agent 配置固定域名或当前环境要求登录时出现。完成页面操作后，让 Agent 继续。
2. **ChatGPT 插件创建 / OAuth**：Agent 会给出当前 Workspace 的 MCP Server URL。

ChatGPT 中固定使用：

```text
设置
→ 插件
→ 新插件
→ 连接选择「服务器 URL」
→ 粘贴 Agent 给出的 URL
→ 身份验证选择「OAuth」
→ 勾选风险确认
→ 创建
→ 完成授权 / 配对
```

不需要先开启 Developer Mode，也不需要到 Advanced Settings / Security 中寻找其他入口。

最后在 ChatGPT 中测试：

```text
列出当前 ChatX 工作区的顶层文件，不要修改任何内容。
```

能看到当前项目的真实文件，才算完整链路配置成功。

## Cloudflare 地址

默认可以直接使用 **Cloudflare Quick Tunnel**：

- 不需要购买域名
- 最容易开始
- 重启或重建连接后地址可能变化

如果你已经有托管在 Cloudflare 的域名并希望固定地址，Agent 会配置 **Named Tunnel**。需要登录或授权时再由你本人完成页面操作。

普通用户不需要手动运行 Cloudflare 命令。

## 高级：手动安装

只有不使用 AI Agent 时才需要手动执行。

### 1. 安装依赖

Windows：

```powershell
winget install --id OpenJS.NodeJS.LTS
winget install --id Cloudflare.cloudflared
```

macOS：

```bash
brew install node cloudflared
```

### 2. 安装最新公开 Release

```bash
npm install -g https://github.com/Tyr1onX/ChatX/releases/download/v0.1.0-alpha.1/chatx-local-bridge-0.1.0-alpha.1.tgz
chatx --version
```

> `alpha.1` 不包含本轮新增的 macOS 浏览器支持。Mac 测试者请使用 [macOS Compatibility Smoke](docs/macos-smoke.md) 中的源码安装方式测试当前 `main`。

### 3. 配置当前项目

```bash
cd /path/to/your/project
chatx setup
```

记录输出的 MCP Server URL。

### 4. 添加 ChatGPT 插件

```text
设置 → 插件 → 新插件
```

选择「服务器 URL」，粘贴 `chatx setup` 输出的 URL，身份验证选择 OAuth，然后完成创建、授权和配对。

## 日常使用

通常直接和 ChatGPT 对话即可。出现连接问题时先运行：

```bash
chatx doctor
```

常用命令：

```bash
chatx status
chatx doctor
chatx pair
chatx logs
chatx stop
```

## 安全

ChatX 具备较强的本机能力，请只连接你信任的 AI 客户端，并只开放你愿意授权的 Workspace。

`process.run` 启动的程序仍拥有当前操作系统用户本身具备的权限，因此 ChatX 不是完整的主机沙箱。

详细边界见 [安全说明](docs/security.md)。

## 更多文档

- [AI Agent 安装说明](docs/agent-setup.md)
- [macOS Compatibility Smoke](docs/macos-smoke.md)
- [排障](docs/troubleshooting.md)
- [安全模型](docs/security.md)
- [架构](docs/architecture.md)
- [协议](docs/protocol.md)
- [英文 README](README.en.md)

ChatX 是非官方社区项目，与 OpenAI、Cloudflare 无隶属或背书关系。