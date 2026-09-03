# ChatX — AI Agent 安装说明

这份文档是给能够操作用户本机终端的 AI Agent 阅读的。

目标不是只把 ChatX 软件装上，而是尽可能把 **本机环境、外部连接条件、ChatGPT Connector 和端到端验证** 连续完成。只有在确实需要用户本人参与时才请求操作，并在用户完成后继续后续步骤。

不要为了安装 ChatX 修改用户项目的业务代码。

## 完成定义

只有下面四层都达到预期，才能把“ChatX 已配置完成”汇报给用户：

1. **Local** — ChatX 已安装，目标 Workspace 正确，Bridge 正常
2. **Transport** — 当前 Workspace 已有可用的公网连接地址
3. **ChatGPT** — 当前 Workspace 对应的自定义 MCP Connector 已创建并完成 OAuth / 配对
4. **End-to-end** — ChatGPT 通过该 Connector 能真实读取目标 Workspace

如果只完成了 `npm install`、`chatx setup` 或本机 `doctor`，不要声称完整配置已经完成。

## 外部条件清单

首次开始前先判断这些条件，不要等本机都装完才发现外部条件缺失。

### 必需：ChatGPT 自定义 MCP 能力

用户的 ChatGPT 账号 / Workspace 必须能够使用自定义 MCP Connector / Developer Mode 或对应能力。

这是外部产品权限，不是 ChatX 可以安装出来的功能。

如果用户账号没有入口：

- 可以继续完成 ChatX 本机安装和本地诊断
- 必须明确标记 `ChatGPT Connector blocked by account/workspace capability`
- 不要反复重装 ChatX
- 不要声称端到端配置成功

### 必需：ChatGPT 登录

首次创建 Connector、OAuth 授权、验证码、2FA 等步骤可能要求用户本人操作。

Agent 可以导航或填写非敏感表单，但不要读取、打印或保存用户 Cookie、OAuth token、浏览器 Session 等凭据。

### 可选：Cloudflare 账号和域名

**Cloudflare 账号和自己的域名不是使用 ChatX 的硬性要求。**

ChatX 支持两种主要连接选择：

#### Quick / 临时地址

适合没有 Cloudflare 账号或域名的用户：

- 不需要 Cloudflare 登录
- 不需要自己的域名
- 可以直接建立临时公网地址
- 地址在电脑重启或 Tunnel 重建后可能变化
- 地址变化后需要修复 / 重建当前 Workspace 的 ChatGPT Connector

#### Named / 固定域名

适合已经长期使用 Cloudflare 的用户：

需要：

- Cloudflare 账号
- 一个已经托管在 Cloudflare 的域名
- 首次配置时完成 Cloudflare 登录 / 授权

优点是公网地址稳定，通常不需要因为电脑重启而反复更新 Connector。

如果用户没有 Cloudflare 账号或域名，直接使用 Quick，不要把“先注册 Cloudflare / 买域名”作为阻塞条件。

### 实验性：OpenAI Secure MCP Tunnel

仅当当前 ChatGPT / OpenAI 环境确实具备对应能力并且用户明确希望使用时再选择。

不要把它作为普通新用户的默认路径。

## 用户交互原则

能自动完成的步骤直接完成。

仅在以下情况请求用户操作：

- ChatGPT / Cloudflare 等账号登录
- CAPTCHA
- 2FA
- 操作系统或第三方服务明确要求的授权 / consent
- Agent 本身没有能力操作 ChatGPT Connector UI
- 用户需要在 Quick 和已有 Cloudflare 固定域名之间做真实偏好选择

请求用户操作时：

1. 每次只给 **当前必须完成的一步**
2. 不要把后续十几步一起扔给用户
3. 用户完成后，Agent 必须继续原来的安装 / 验证流程
4. 不要以“请自行完成后续配置”提前结束任务

不要让用户手动执行一串本来可以由 Agent 自己执行的命令。

ChatX 的一次性配对码可以按正常流程用于授权，但不要读取、打印或复制 OAuth token、Cookie、浏览器 Session、私钥等长期凭据。

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

## 1. 检查本机依赖

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

## 3. 选择公网连接方式

先检查当前 Workspace 是否已经做过选择：

```bash
chatx tunnel status -w <WORKSPACE> --json
```

如果已有有效偏好，不要无理由改动。

如果需要首次选择：

### 用户没有 Cloudflare 账号 / 域名，或只想最快开始

使用 Quick：

```bash
chatx tunnel choose -w <WORKSPACE> --mode quick --json
```

不要要求 Cloudflare 登录。

### 用户已有托管在 Cloudflare 的域名，并希望固定地址

确认真实域名后使用 Named：

```bash
chatx tunnel choose -w <WORKSPACE> --mode named --zone <DOMAIN> --json
```

该流程可能打开 Cloudflare 登录 / 授权页面。

这是允许请求用户参与的交互步骤。用户完成后继续执行，不要停在这里。

如果 Named 配置失败并且 ChatX 提供 Quick fallback，优先保证用户先可用；之后再根据用户意愿升级到固定域名。

## 4. 首次配置

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

确认：

- `workspaceName` 对应真实 `<WORKSPACE>`
- Bridge 已启动
- `mcpUrl` 是当前有效公网地址
- 当前 tunnel 与前一步选择一致

如果配对码过期：

```bash
chatx pair -w <WORKSPACE> --json
```

不要在项目目录中保存连接凭据。

## 5. 配置 ChatGPT Connector

这是完整安装里不可省略的一层。

如果 Agent 具备受支持且可靠的 ChatGPT UI / Connector 操作能力，可以继续完成：

1. 确认用户已登录 ChatGPT
2. 确认账号 / Workspace 已开放自定义 MCP Connector / Developer Mode
3. 为当前 Workspace 创建或修复 `connectorName` 对应的 Connector
4. Server URL 使用当前 `mcpUrl`
5. Authentication 使用 OAuth
6. 在授权流程中使用当前有效的一次性 `pairingCode`
7. 等待 Connected / authorized / pairing accepted 等明确成功状态

一个 Workspace 只维护它自己的 Connector。不要修改或删除属于其他 Workspace 的 Connector。

### Agent 不能操作 ChatGPT UI 时

不要假装已经完成。

只向用户说明 **当前唯一需要手工完成的动作**。例如：

> 请打开 ChatGPT 的自定义 Connector 页面，为“<connectorName>”添加连接。我已经准备好地址和配对信息；完成授权后告诉我“好了”，我会继续验证。

如果必须提供具体值，可以给：

- Connector 名称
- MCP 地址
- 当前有效的一次性配对码

用户完成后必须继续执行第 6 节验证。

### ChatGPT 根本没有 Connector 能力时

明确区分状态：

```text
Local ChatX: READY
Public connection: READY
ChatGPT Connector: BLOCKED — account/workspace capability unavailable
End-to-end: NOT VERIFIED
```

不要把这个问题误诊断成本机安装失败。

## 6. 验证

本机运行：

```bash
chatx status -w <WORKSPACE> --json
chatx doctor -w <WORKSPACE> --json
```

本机成功标准至少包括：

- 当前 Workspace 身份正确
- Bridge 正常运行
- 本地 MCP 检查正常
- 所选连接方式处于正常状态
- 没有需要继续处理的 repair 状态

如果 `doctor` 能安全自动修复问题，优先让它修复，而不是直接要求用户重装。

### 必须做真实端到端验证

如果 ChatGPT Connector 已完成连接，再发送一个只读任务：

```text
列出当前 ChatX 工作区的顶层文件，不要修改任何内容。
```

确认返回内容确实来自 `<WORKSPACE>`。

只有这一步通过，才可以汇报完整首次配置成功。

## 7. 持续维护与恢复

ChatX 是长期运行的本机桥接器，Agent 不应该只会“第一次安装”，还应能够在之后继续维护。

### Quick 地址变化

症状通常发生在电脑重启或 Tunnel 重建之后。

先运行：

```bash
chatx doctor -w <WORKSPACE> --json
```

如果当前公网地址已经变化：

1. 获取新的 `mcpUrl`
2. 只修复当前 Workspace 的 ChatGPT Connector
3. 如需要重新配对，生成新的 `pairingCode`
4. 再做一次端到端只读验证

不要修改其他 Workspace 的 Connector。

### 配对码过期

直接：

```bash
chatx pair -w <WORKSPACE> --json
```

然后继续原来的 OAuth / 配对步骤。

### Bridge / Tunnel 异常

优先：

```bash
chatx doctor -w <WORKSPACE> --json
```

必要时：

```bash
chatx restart -w <WORKSPACE> --tunnel
```

之后再次运行 `doctor` 和端到端验证。

### Named 固定域名需要重新登录 Cloudflare

让用户只完成 Cloudflare 登录 / 域名授权这一动作，完成后继续运行诊断。

固定域名本身没变化时，不要因为授权失效就无理由重建 ChatGPT Connector。

### ChatGPT Connector 丢失 / 失效

重新获取当前 Workspace 的真实 `connectorName` 和 `mcpUrl`，只修复当前 Workspace 对应的 Connector，然后重新端到端验证。

### 外部权限变化

如果 ChatGPT 账号后来失去自定义 MCP 能力，明确报告为外部权限变化，不要重装本机 ChatX。

## 8. 出错处理

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

保持简短，但必须区分层级：

```text
ChatX: READY / BLOCKED
Workspace: <name>
Bridge: READY / BLOCKED
Public connection: READY / BLOCKED
ChatGPT Connector: READY / BLOCKED / NEEDS USER ACTION
End-to-end: VERIFIED / NOT VERIFIED
```

如果还有一步必须由用户完成，只给出那一步。

不要向普通用户倾倒端口、内部 token、PKCE、状态文件路径或长篇协议细节，除非用户正在主动排障或询问实现原理。
