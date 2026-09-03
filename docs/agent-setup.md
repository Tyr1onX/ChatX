# ChatX — AI Agent 安装说明

这份文档给能够操作用户本机终端的 AI Agent 使用。

目标只有一个：

> 让 ChatGPT 通过 ChatX 真实访问当前本地 Workspace。

首次安装只采用已经实际跑通的 ChatGPT 接入路线：

```text
ChatX 本机配置
→ Cloudflare 公网连接
→ 得到 MCP Server URL
→ ChatGPT「设置 → 插件 → 新插件」
→ 服务器 URL
→ OAuth
→ 完成授权 / 配对
→ 端到端验证
```

**首次安装只执行以上路线。不要根据账号套餐或其他设置页面推断替代接入方式。**

## Agent 的职责

本机能够自动完成的事情全部由 Agent 完成，不要把命令逐条甩给用户。

Agent 应自行完成：

- 检查 Node.js 20+
- 安装 / 更新 ChatX
- 确定目标 Workspace
- 安装 / 检查 `cloudflared`
- 启动 ChatX Bridge
- 配置 Cloudflare 连接
- 运行 `chatx setup`
- 获取当前 Workspace 的 MCP Server URL 和配对信息
- 运行 `chatx status` / `chatx doctor`
- 最终端到端验证

只有确实必须由用户本人完成时才请求操作，例如：

- Cloudflare 登录 / 授权
- CAPTCHA / 2FA
- ChatGPT 页面上的明确授权确认
- Agent 无法可靠操作 ChatGPT「新插件」页面时，让用户粘贴一次 URL 并完成 OAuth

每次只让用户完成当前这一步；完成后 Agent 继续接管原任务。

不要为了安装 ChatX 修改用户项目的业务代码。

## 0. 确定 Workspace

目标 Workspace 是用户希望 ChatGPT 操作的项目目录，不是 ChatX 仓库。

后续命令优先显式传入：

```bash
-w <WORKSPACE>
```

## 1. 检查本机环境

ChatX 需要 Node.js 20+：

```bash
node --version
```

默认 Cloudflare 路线需要：

```bash
cloudflared --version
```

缺失时由 Agent 自行安装。

Windows：

```powershell
winget install --id Cloudflare.cloudflared
```

macOS：

```bash
brew install cloudflared
```

不要让用户手动执行这些安装命令，除非当前 Agent 没有执行权限。

## 2. 安装 ChatX

### 普通用户

当前最新公开 Release：

```text
v0.1.0-alpha.1
```

安装：

```bash
npm install -g https://github.com/Tyr1onX/ChatX/releases/download/v0.1.0-alpha.1/chatx-local-bridge-0.1.0-alpha.1.tgz
```

如果机器已经安装 ChatX，先检查版本和运行状态，不要无条件重装。

### macOS Compatibility Smoke

在 `v0.1.0-alpha.2` prerelease 正式发布前，Mac 测试者按 `docs/macos-smoke.md` 从 `main` 源码安装。

## 3. 配置 Cloudflare 连接

先检查当前 Workspace：

```bash
chatx tunnel status -w <WORKSPACE> --json
```

如果已有有效配置，继续使用，不要重建。

### 默认：临时地址

没有现成固定域名需求时，直接使用 Quick：

```bash
chatx tunnel choose -w <WORKSPACE> --mode quick --json
```

Quick 不要求用户购买域名，也不要求用户理解 Tunnel、DNS 或端口。

### 用户明确希望固定域名

只有用户已经有托管在 Cloudflare 的域名并明确希望固定地址时使用 Named：

```bash
chatx tunnel choose -w <WORKSPACE> --mode named --zone <DOMAIN> --json
```

需要 Cloudflare 登录 / 授权时，只让用户完成当前浏览器页面，然后 Agent 继续执行。

Named 配置失败且 ChatX 提供 Quick fallback 时，优先先恢复可用状态，不要反复阻塞用户。

## 4. 运行首次配置

```bash
chatx setup -w <WORKSPACE> --json
```

确认：

- Workspace 正确
- Bridge 正常
- Cloudflare 公网连接正常
- 输出了当前 Workspace 的 `mcpUrl`
- 输出了当前可用的配对信息

如果配对信息失效：

```bash
chatx pair -w <WORKSPACE> --json
```

此时本机侧已经完成。接下来只需要把 `mcpUrl` 添加到 ChatGPT。

## 5. ChatGPT：只走「新插件 → 服务器 URL → OAuth」

首次安装固定使用已经验证过的入口：

```text
ChatGPT
→ 设置
→ 插件
→ 新插件
```

在「新插件」页面填写：

```text
名称：<connectorName，通常为 ChatX · <workspace>>
描述：Securely connect ChatGPT to the current Codex workspace for planning and review.
连接：服务器 URL
服务器 URL：<chatx setup 输出的 mcpUrl>
身份验证：OAuth
```

然后：

1. 勾选页面上的自定义 MCP 风险确认。
2. 点击「创建」。
3. 按页面进入 OAuth 授权。
4. 需要 ChatX 配对码时，使用当前 `pairingCode`。
5. 显示已连接 / 授权成功后继续。

**只使用上述「新插件 → 服务器 URL → OAuth」入口。当前界面没有这个入口时，记录实际界面并提交兼容性反馈，不要自行切换到其他接入方式。**

如果 Agent 能可靠操作这个页面，可以直接完成表单与跳转；如果不能，只让用户做这一件事：

```text
请在 ChatGPT「设置 → 插件 → 新插件」中，选择「服务器 URL」，
粘贴我给你的 URL，身份验证选 OAuth，然后完成创建和授权。
```

不要再让用户处理任何本机命令。

## 6. 必须做端到端验证

先检查本机：

```bash
chatx status -w <WORKSPACE> --json
chatx doctor -w <WORKSPACE> --json
```

然后在已经连接 ChatX 插件的 ChatGPT 对话中执行：

```text
列出当前 ChatX 工作区的顶层文件，不要修改任何内容。
```

确认结果确实来自 `<WORKSPACE>`。

只有这一层通过，首次安装才算成功。

## 7. 后续维护

出现问题先运行：

```bash
chatx doctor -w <WORKSPACE> --json
```

### Quick 地址变化

如果公网地址变化：

1. Agent 获取新的 `mcpUrl` 和配对信息。
2. 只处理当前 Workspace 对应的 ChatGPT 插件。
3. 删除旧插件并按同一条「新插件 → 服务器 URL → OAuth」路线重新创建。
4. 再次端到端验证。

不要改动其他 Workspace 的 ChatX 插件。

### 配对失效

```bash
chatx pair -w <WORKSPACE> --json
```

然后完成 OAuth / 配对并重新验证。

### 固定域名需要重新登录

只让用户完成 Cloudflare 登录 / 授权。固定地址没有变化时，不要无理由删除并重建 ChatGPT 插件。

## Codex

如果当前 Agent 是 Codex，还要阅读：

```text
skill/SKILL.md
```

Codex 工作流也必须遵守本文的唯一首次安装路线。

## 完成后汇报

保持简短：

```text
ChatX: READY / BLOCKED
Workspace: <name>
Bridge: READY / BLOCKED
Cloudflare: READY / BLOCKED
ChatGPT 插件: READY / NEEDS USER ACTION
End-to-end: VERIFIED / NOT VERIFIED
```

如果还有一步必须由用户本人完成，只给出那一步。