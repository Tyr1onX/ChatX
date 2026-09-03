# ChatX

**让 ChatGPT 安全地使用你电脑上的本地能力。**

ChatX 是一个运行在你电脑上的本地桥接器。连接完成后，ChatGPT 可以在你授权的项目范围内直接读取和修改文件、查看 Git、运行本地程序，并使用一个独立浏览器。

你不需要反复把代码、日志、目录结构复制到聊天里，也不需要一直操作 ChatX。正常情况下，ChatX 在后台运行，你只需要继续和 ChatGPT 对话。

[English](README.en.md) · [AI Agent 安装说明](docs/agent-setup.md) · [排障](docs/troubleshooting.md) · [安全说明](docs/security.md)

> 当前版本：`v0.1.0-alpha.1`。ChatX 仍处于 Alpha 阶段。
>
> ChatX 不会绕过 ChatGPT 本身的产品权限。如果你的账号 / 工作区没有自定义 MCP Connector、Developer Mode 或对应 Tunnel 能力，本机安装成功后 ChatGPT 仍可能无法连接。

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

# 安装

## 推荐：直接让你的 AI Agent 帮你配置

如果你已经在使用 Codex、Claude Code、Cursor Agent 或其他能够操作本机终端的 AI Agent，最省事的方式不是自己照着几十条命令安装，而是把下面这段话直接交给它：

```text
请帮我在这台电脑上安装并配置 ChatX：
https://github.com/Tyr1onX/ChatX

目标：让 ChatGPT 能安全访问我当前正在工作的项目目录。

请先阅读仓库里的 docs/agent-setup.md，并按里面的首次安装流程完成。
如果你是 Codex，再同时阅读 skill/SKILL.md，并优先遵循其中的 ChatX 工作流。

能自动完成的步骤直接完成，不要让我手动复制命令。
只有遇到登录、验证码、2FA 或明确的授权确认时再让我操作。
安装完成后运行 chatx doctor，并验证本地 Bridge、连接和当前 Workspace 都正常。
不要修改当前项目的业务代码来完成安装。
```

然后让 Agent 自己处理 Node.js、`cloudflared`、ChatX 安装、启动、诊断等步骤即可。

如果 Agent 能操作 ChatGPT 的连接器设置，它还可以继续完成连接；如果不能，它应该只把最后必须由你完成的那一步告诉你。

### Codex 用户

ChatX 仓库内已经提供专门的：

```text
skill/SKILL.md
```

它包含 Codex 如何安装 ChatX、维护连接、排障以及与 ChatGPT 配合的完整流程。对于 Codex 用户，推荐直接让 Codex读取并执行这个 Skill，而不是人工逐条操作。

## 手动安装

如果你希望自己完成，最短流程如下。

### 1. 准备依赖

需要：

- Node.js 20+
- `cloudflared`（默认连接方式）

Windows：

```powershell
winget install --id OpenJS.NodeJS.LTS
winget install --id Cloudflare.cloudflared
```

macOS：

```bash
brew install node cloudflared
```

### 2. 安装 ChatX

```bash
npm install -g https://github.com/Tyr1onX/ChatX/releases/download/v0.1.0-alpha.1/chatx-local-bridge-0.1.0-alpha.1.tgz
```

确认：

```bash
chatx --version
```

### 3. 在目标项目里启动

进入你希望 ChatGPT 操作的项目目录：

```bash
cd /path/to/your/project
chatx setup
```

ChatX 会启动本机 Bridge，并输出连接地址和配对信息。

### 4. 连接 ChatGPT

在 ChatGPT 的自定义 Connector / Developer Mode 中添加 `chatx setup` 输出的地址，并完成 OAuth 配对。

连接后可以先测试：

```text
列出当前 ChatX 工作区的顶层文件，不要修改任何内容。
```

如果 ChatGPT 能看到你本机项目的真实文件，说明完整链路已经工作。

# 日常使用

安装完成后，通常不需要再操作 ChatX。

直接和 ChatGPT 说你要做什么即可。

需要检查状态或自动修复时：

```bash
chatx doctor
```

常用命令只有这些：

```bash
chatx status     # 查看当前状态
chatx doctor     # 检查并自动修复
chatx pair       # 重新生成配对码
chatx logs       # 查看日志
chatx stop       # 停止当前 Workspace 的 Bridge
```

更完整的问题处理见 [排障文档](docs/troubleshooting.md)。

# 安全

ChatX 可以获得较强的本机能力，因此请只把它连接到你信任的 AI 客户端，并只授权你愿意开放的项目。

默认情况下 ChatX 会限制 Workspace 路径，并阻止读取 `.env`、SSH 私钥、云凭据等常见敏感文件；浏览器也使用独立 Profile。

但 `process.run` 启动的程序仍然拥有当前操作系统用户本身具备的权限，因此它不是一个完整的主机沙箱。

详细边界见 [安全说明](docs/security.md)。

# 更多文档

- [给 AI Agent 的安装说明](docs/agent-setup.md)
- [排障](docs/troubleshooting.md)
- [安全模型](docs/security.md)
- [架构](docs/architecture.md)
- [协议](docs/protocol.md)
- [英文 README](README.en.md)

开发、CI、发布和内部实现细节不再放在首页 README 中，需要时直接查看仓库源码和对应文档。

ChatX 是非官方社区项目，与 OpenAI、Cloudflare 无隶属或背书关系。
