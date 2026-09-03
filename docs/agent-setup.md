# ChatX — AI Agent 安装说明

这份文档给能够操作用户本机终端的 AI Agent 使用。

目标不是“把 ChatX 装上”，而是把下面四层连续完成：

1. **Local** — ChatX 安装完成，Workspace 正确，Bridge 正常
2. **Transport** — 当前 Workspace 有可用公网连接
3. **ChatGPT** — 当前 Workspace 的自定义 MCP Connector 已完成连接和配对
4. **End-to-end** — ChatGPT 能通过该 Connector 真实读取目标 Workspace

只完成 `npm install`、`chatx setup` 或本机诊断，都不能汇报“完整配置成功”。

不要为了安装 ChatX 修改用户项目的业务代码。

## 用户交互原则

能自动完成的步骤直接完成。

只在确实需要用户本人参与时请求操作，例如：

- ChatGPT / Cloudflare 登录
- CAPTCHA / 2FA
- 明确的第三方授权确认
- Agent 无法可靠操作 ChatGPT Connector 页面
- 用户需要在临时地址和已有固定域名之间做选择

每次只让用户完成当前一步；用户完成后继续原任务，不要把后续流程甩回给用户。

## 0. 确定 Workspace

目标 Workspace 是用户希望 ChatGPT 操作的项目目录，不是 ChatX 仓库。

如果 Agent 当前就在目标项目中工作，可以使用当前目录。后续命令优先显式传入：

```bash
-w <WORKSPACE>
```

## 1. 检查本机环境

ChatX 需要 Node.js 20+：

```bash
node --version
```

默认 Cloudflare 路径还需要：

```bash
cloudflared --version
```

缺失时自行安装：

Windows：

```powershell
winget install --id Cloudflare.cloudflared
```

macOS：

```bash
brew install cloudflared
```

macOS 独立浏览器支持 Google Chrome、Microsoft Edge、Chromium 和 Chrome Canary。非标准安装位置可以通过 `CHATX_BROWSER_BIN` 指定。

## 2. 判断应该安装哪个版本

### 普通用户

当前最新公开 Release 是：

```text
v0.1.0-alpha.1
```

安装：

```bash
npm install -g https://github.com/Tyr1onX/ChatX/releases/download/v0.1.0-alpha.1/chatx-local-bridge-0.1.0-alpha.1.tgz
```

### macOS Compatibility Smoke

`main` 已经包含第一版 macOS 支持，源码版本为：

```text
0.1.0-alpha.2
```

在 `v0.1.0-alpha.2` prerelease 正式发布前，Mac 测试者应从 `main` 源码安装，而不是使用旧的 `alpha.1` 判断 macOS 浏览器兼容性：

```bash
git clone https://github.com/Tyr1onX/ChatX.git
cd ChatX
corepack pnpm install
corepack pnpm build
npm link
chatx --version
```

如果机器已经安装 ChatX，不要无条件重装；先确认版本和当前运行状态。

## 3. 检查外部条件

在继续之前确认用户的 ChatGPT 账号 / Workspace 能使用自定义 MCP Connector / Developer Mode。

如果账号没有这项能力：

```text
Local ChatX: 可以继续准备
ChatGPT Connector: BLOCKED BY ACCOUNT / WORKSPACE CAPABILITY
End-to-end: NOT VERIFIED
```

不要把这个外部权限问题误诊断成本机安装失败。

## 4. 选择公网连接

先检查当前 Workspace：

```bash
chatx tunnel status -w <WORKSPACE> --json
```

如果已有有效选择，不要无理由更改。

### Quick / 临时地址

没有 Cloudflare 账号或域名时直接使用：

```bash
chatx tunnel choose -w <WORKSPACE> --mode quick --json
```

Quick 不要求用户先注册 Cloudflare 或购买域名。

### Named / 固定域名

只有用户已经有托管在 Cloudflare 的域名并希望固定地址时使用：

```bash
chatx tunnel choose -w <WORKSPACE> --mode named --zone <DOMAIN> --json
```

如果需要 Cloudflare 登录或授权，让用户完成当前页面动作，然后继续流程。

Named 配置失败并提供 Quick fallback 时，优先让用户先可用，不要反复阻塞在固定域名上。

## 5. 首次配置

```bash
chatx setup -w <WORKSPACE> --json
```

确认输出中的：

- Workspace 身份正确
- Bridge 已启动
- 当前公网连接正常
- MCP 地址对应当前 Workspace
- 有可用于首次配对的信息

如果配对信息失效：

```bash
chatx pair -w <WORKSPACE> --json
```

## 6. 配置 ChatGPT Connector

如果 Agent 能可靠操作 ChatGPT 页面，则继续完成：

1. 确认 Developer Mode / 自定义 MCP Connector 可用
2. 为当前 Workspace 创建或修复它自己的 Connector
3. 使用 `chatx setup` 当前输出的 MCP 地址
4. 按 ChatX 的配对流程完成连接
5. 不要修改其他 Workspace 的 Connector

如果 Agent 不能操作 ChatGPT UI，只让用户完成当前唯一必须的页面动作；用户完成后继续第 7 节验证。

## 7. 必须做端到端验证

本机先运行：

```bash
chatx status -w <WORKSPACE> --json
chatx doctor -w <WORKSPACE> --json
```

然后让 ChatGPT 执行只读验证：

```text
列出当前 ChatX 工作区的顶层文件，不要修改任何内容。
```

确认结果确实来自 `<WORKSPACE>`。

只有这一层通过，完整首次配置才算成功。

## 8. 持续维护

### 临时地址变化

```bash
chatx doctor -w <WORKSPACE> --json
```

如果公网地址变化，只修复当前 Workspace 的 Connector，再重新做端到端验证。

### 配对失效

```bash
chatx pair -w <WORKSPACE> --json
```

然后继续原来的连接步骤。

### Bridge / Tunnel 异常

优先：

```bash
chatx doctor -w <WORKSPACE> --json
```

必要时：

```bash
chatx restart -w <WORKSPACE> --tunnel
```

修复后再次诊断并做端到端验证。

### 固定域名需要重新登录

只让用户完成 Cloudflare 登录 / 授权，然后继续诊断。固定地址没有变化时，不要无理由重建 Connector。

### Connector 丢失

重新获取当前 Workspace 的真实连接信息，只恢复当前 Workspace 的 Connector，然后再次验证。

## 9. macOS 社区测试

如果当前机器是 Mac，并且用户是在测试第一版 macOS 支持，还要阅读：

```text
docs/macos-smoke.md
```

需要验证 Workspace、Git、本地进程和独立浏览器，而不仅仅是 `chatx setup`。

## Codex

如果当前 Agent 是 Codex，还要阅读：

```text
skill/SKILL.md
```

Codex 专属工作流以 `skill/SKILL.md` 为准。

## 完成后汇报

保持简短，但明确层级：

```text
ChatX: READY / BLOCKED
Workspace: <name>
Bridge: READY / BLOCKED
Public connection: READY / BLOCKED
ChatGPT Connector: READY / BLOCKED / NEEDS USER ACTION
End-to-end: VERIFIED / NOT VERIFIED
```

如果还有一步必须由用户完成，只给出那一步。
