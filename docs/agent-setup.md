# ChatX — AI Agent 安装说明

这份文档是给能够操作用户本机终端的 AI Agent 阅读的。

目标不是向用户解释 ChatX 的内部实现，而是尽可能自动完成首次安装、连接准备和验证，只在确实需要用户本人参与时请求操作。

## 目标

在用户指定的 Workspace 上完成：

1. 检查并安装运行依赖
2. 安装 ChatX 当前公开版本
3. 启动该 Workspace 的 ChatX Bridge
4. 建立可供 ChatGPT 使用的连接
5. 输出或继续处理 Connector / OAuth 配对信息
6. 运行诊断并确认本地链路正常

不要为了安装 ChatX 修改用户项目的业务代码。

## 用户交互原则

能自动完成的步骤直接完成。

仅在以下情况请求用户操作：

- 账号登录
- CAPTCHA
- 2FA
- 操作系统或第三方服务明确要求的授权 / consent
- Agent 本身没有能力操作 ChatGPT Connector UI，需要用户完成最后一步

不要让用户手动执行一串本来可以由 Agent 自己执行的命令。

不要读取、打印或复制 OAuth token、Cookie、浏览器 Session、私钥等凭据。ChatX 的一次性配对码可以按正常流程用于授权。

## 0. 确定 Workspace

目标 Workspace 是用户希望 ChatGPT 操作的项目目录，不是 ChatX 仓库本身。

如果 Agent 当前就在用户项目目录工作，默认使用当前目录。

记为：

```text
<WORKSPACE>
```

后续命令优先显式使用：

```bash
-w <WORKSPACE>
```

避免误连到错误项目。

## 1. 检查依赖

ChatX 需要 Node.js 20+。

先检查：

```bash
node --version
```

如果不存在或版本低于 20，使用当前操作系统常规包管理方式安装 Node.js LTS。

默认 Cloudflare 连接方式还需要：

```bash
cloudflared --version
```

缺失时：

Windows：

```powershell
winget install --id Cloudflare.cloudflared
```

macOS：

```bash
brew install cloudflared
```

Linux 使用适合当前发行版的 Cloudflare 官方安装方式。

安装后重新确认命令可用。

## 2. 安装 ChatX

普通用户优先安装公开 Release，不要为了使用 ChatX 去 clone 源码和建立开发环境。

当前公开版本：

```text
v0.1.0-alpha.1
```

安装：

```bash
npm install -g https://github.com/Tyr1onX/ChatX/releases/download/v0.1.0-alpha.1/chatx-local-bridge-0.1.0-alpha.1.tgz
```

验证：

```bash
chatx --version
```

预期：

```text
0.1.0-alpha.1
```

如果机器已经安装 ChatX，不要无条件重复安装。先确认版本与运行状态。

## 3. 首次配置

对目标 Workspace 执行：

```bash
chatx setup -w <WORKSPACE> --json
```

优先解析 JSON 输出，而不是依赖面向人的终端文案。

需要关注的字段可能包括：

```text
workspaceId
workspaceName
connectorName
mcpUrl
pairingCode
pairingExpiresAt
tunnel
```

如果配对码过期：

```bash
chatx pair -w <WORKSPACE> --json
```

不要在项目目录中保存连接凭据。

## 4. ChatGPT Connector

如果 Agent 具备受支持的 ChatGPT UI / Connector 操作能力，可以继续完成：

1. 确认 ChatGPT 账号 / Workspace 已开放自定义 MCP Connector 或对应 Developer Mode
2. 使用 `connectorName` 创建当前 Workspace 对应的 Connector
3. Server URL 使用 `mcpUrl`
4. Authentication 使用 OAuth
5. 在授权流程中使用 ChatX 的一次性 `pairingCode`

不要修改或删除属于其他 Workspace 的 Connector。

如果 Agent 不具备可靠的 ChatGPT UI 操作能力，不要假装已经完成。只向用户说明最后一个必须由用户完成的动作，并提供：

- Connector 名称
- MCP 地址
- 当前有效的一次性配对码

如果用户的 ChatGPT 账号根本没有对应功能，需要明确说明这是 ChatGPT 产品权限限制，而不是 ChatX 本机安装失败。

## 5. 验证

本机运行：

```bash
chatx status -w <WORKSPACE> --json
chatx doctor -w <WORKSPACE> --json
```

成功标准至少包括：

- 当前 Workspace 身份正确
- Bridge 正常运行
- 本地 MCP 检查正常
- 所选连接方式处于正常状态，或本地模式符合用户预期
- 没有需要继续处理的 repair 状态

如果 `doctor` 能安全自动修复问题，优先让它修复，而不是直接要求用户重装。

如果 ChatGPT Connector 已完成连接，再进行一次只读端到端验证：

```text
列出当前 ChatX 工作区的顶层文件，不要修改任何内容。
```

确认返回内容确实对应 `<WORKSPACE>` 后，首次配置才算完整成功。

## 6. 出错处理

第一选择：

```bash
chatx doctor -w <WORKSPACE> --json
```

常用辅助命令：

```bash
chatx status -w <WORKSPACE> --json
chatx pair -w <WORKSPACE> --json
chatx logs -w <WORKSPACE>
chatx restart -w <WORKSPACE> --tunnel
```

完整排障规则见：

```text
docs/troubleshooting.md
```

安全边界见：

```text
docs/security.md
```

## Codex

如果当前 Agent 是 Codex，除了本文件，还要阅读：

```text
skill/SKILL.md
```

`skill/SKILL.md` 包含 ChatX 针对 Codex 的更完整工作流，包括 Codex 沙箱、ChatGPT 页面操作、连接维护和会话管理。

Codex 场景下，如本文件与 `skill/SKILL.md` 对 Codex 专属行为存在差异，以 `skill/SKILL.md` 为准。

## 完成后如何向用户汇报

保持简短，只需要说明：

- ChatX 是否已安装
- 当前连接的 Workspace
- Bridge / 安全连接是否正常
- ChatGPT Connector 是否已经完成
- 如果还有一步必须由用户完成，只给出那一步

不要向普通用户倾倒端口、内部 token、PKCE、状态文件路径或长篇协议细节，除非用户正在主动排障或询问实现原理。
