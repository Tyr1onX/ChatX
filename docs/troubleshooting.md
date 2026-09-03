# ChatX 排障

遇到问题时，第一步通常都是：

```bash
chatx doctor
```

它会检查 Node.js、Workspace、Bridge、MCP、OAuth 和 Tunnel，并自动修复能够安全修复的部分，例如重新启动 Bridge 或重新建立 Tunnel。

如果需要只检查、不自动修复：

```bash
chatx doctor --no-fix
```

> `chatx` 是当前主命令；旧的 `c2c` 仍然作为兼容别名保留。

## 先判断问题在哪一层

ChatX 可以简单看成四层：

```text
ChatGPT
  ↓
Connector / Tunnel
  ↓
ChatX Bridge（本机后台进程）
  ↓
Workspace / Git / Process / Browser
```

所以排障时不要一上来全部重装。先运行：

```bash
chatx status
chatx doctor
```

一般可以快速判断是本机 Bridge、Tunnel、OAuth/Connector，还是 ChatGPT 账号权限的问题。

## `Bridge 未运行`

运行：

```bash
chatx start
```

或者直接让 doctor 自动处理：

```bash
chatx doctor
```

查看最近日志：

```bash
chatx logs
```

需要更多调试信息：

```bash
chatx logs --verbose
```

## 提示没有安装 `cloudflared`

默认的 Cloudflare 连接模式需要 `cloudflared`。

Windows：

```powershell
winget install --id Cloudflare.cloudflared
```

macOS：

```bash
brew install cloudflared
```

Linux 请按照 Cloudflare 官方方式安装。

安装后先确认：

```bash
cloudflared --version
```

然后重新运行：

```bash
chatx setup
```

或：

```bash
chatx doctor
```

## ChatGPT 看不到自定义 Connector / Developer Mode

这通常不是 ChatX 本机故障。

安装 ChatX **不会解锁 ChatGPT 账号本身没有的自定义 MCP 能力**。如果当前账号或工作区没有开放对应入口，本机 Bridge 可以正常运行，但 ChatGPT 仍然无法连接。

可以尝试以下入口：

- Developer Mode：<https://chatgpt.com/#settings/Security>
- 连接器管理：<https://chatgpt.com/plugins>
- 新建连接器：<https://chatgpt.com/plugins#settings/Connectors?create-connector=true&redirectAfter=%2Fplugins>

如果这些页面没有提供相应能力，需要等待账号 / 工作区获得对应功能，ChatX 无法绕过这个产品权限限制。

## `配对码无效` / `配对码已过期`

配对码是一次性的，并且只有几分钟有效期。

重新生成：

```bash
chatx pair
```

然后在 ChatGPT 的 OAuth 授权页输入新的配对码。

生成新配对码后，旧配对码立即视为无效。

## ChatGPT Connector 原来能用，后来突然连不上

如果你使用默认的 Cloudflare Quick Tunnel，电脑重启、Bridge/Tunnel 停止或 Tunnel 重建后，公网地址可能变化。

先运行：

```bash
chatx doctor
```

如果 doctor 提示连接地址已经更换：

1. 找到当前项目对应的 ChatGPT Connector
2. 删除旧 Connector
3. 使用 doctor 输出的新 MCP 地址重新添加
4. 如果 doctor 同时输出了新配对码，在 OAuth 授权页输入它

**不要把另一个项目的 Connector 删除。** ChatX 会按 Workspace 分开保存连接信息。

如果你不希望 Quick Tunnel 地址变化，可以考虑配置 Cloudflare 固定域名。

## Tunnel 地址无法访问 / ChatGPT 提示连接器损坏

先运行：

```bash
chatx doctor
```

### 使用 Cloudflare Quick Tunnel

如果公网地址已经变化，按 doctor 提示删除并重新创建当前 Workspace 的 Connector。

### 使用 Cloudflare 固定域名

如果固定域名本身没有变化，不要先删除 Connector。

尝试重新登录 Cloudflare：

```bash
chatx tunnel login
chatx doctor
```

### 使用 OpenAI Secure MCP Tunnel

OpenAI Tunnel 属于实验性路径。先确认：

- 当前 ChatGPT / OpenAI 工作区确实开放 Tunnel 能力
- `tunnel-client` 已安装
- Tunnel ID 和 runtime key 配置有效

然后运行：

```bash
chatx doctor
```

## 想使用 Cloudflare 固定域名

如果你已经有一个托管在 Cloudflare 的域名，例如 `example.com`：

```bash
chatx tunnel choose --mode named --zone example.com
```

按照提示登录 Cloudflare。

配置完成后再运行：

```bash
chatx setup
```

固定域名的主要好处是电脑重启后通常不需要因为 Quick Tunnel 地址变化而重新配置 ChatGPT Connector。

如果暂时不想配置域名，可以继续使用默认临时地址：

```bash
chatx tunnel choose --mode quick
```

## ChatGPT 每次调用都返回 `401`

这通常表示 ChatX OAuth 授权已经失效，例如 token 刷新失败、执行过 `chatx unpair`，或者 Connector 保存的授权已经过期。

先运行：

```bash
chatx doctor
```

如果公网地址没有变化，可以在 ChatGPT 中重新授权，并使用：

```bash
chatx pair
```

生成新的配对码。

如果公网地址也已经变化，则使用新的地址重新创建当前 Workspace 的 Connector。

## `ACCESS_DENIED_SENSITIVE_FILE`

这是预期的安全行为，不是程序故障。

ChatX 默认拒绝通过 AI 读取或写入一些敏感文件，例如：

- `.env`
- SSH 私钥
- 云服务凭据
- 私钥 / service-account 文件
- `.npmrc`
- 被 `.chatxignore` / `.c2cignore` 匹配的文件

`.env.example` 等公开示例文件可以正常访问。

如果文件确实包含密钥或账号信息，不建议为了方便而移除保护。

## Codex 无法写入 ChatX 状态目录 / 每个新对话都在修连接

ChatX 的状态目录位于项目目录之外。

常见位置：

- Windows：`%LOCALAPPDATA%\ChatX`
- macOS：`~/Library/Application Support/ChatX`

`chatx setup`、`chatx doctor` 和：

```bash
chatx sandbox-allow
```

会尝试把需要的状态目录加入 Codex 沙箱可写白名单，使后续对话能够正常维护 ChatX 状态和日志。

## 端口被占用

通常不需要手动处理。

如果同一个 Workspace 已经存在健康的 Bridge，ChatX 会复用它；否则会自动选择可用端口，并同步更新运行时配置。

如果仍然异常：

```bash
chatx stop
chatx start
```

## 如何确认完整链路真的已经成功？

先确认本机：

```bash
chatx status
chatx doctor
```

然后在已经启用 ChatX Connector 的 ChatGPT 对话中执行一个**只读任务**：

```text
列出当前 ChatX 工作区的顶层文件，不要修改任何内容。
```

如果 ChatGPT 返回的是真实本机项目文件，说明以下完整路径已经工作：

```text
ChatGPT -> Connector / Tunnel -> ChatX Bridge -> 本地 Workspace
```

第一次测试建议按这个顺序逐步增加权限：

```text
读取文件 -> Git status/diff -> 写测试文件 -> 本地命令 -> 浏览器控制
```

这样一旦失败，更容易知道问题出现在哪一层。

## 想完全重新建立当前项目的连接

先尝试：

```bash
chatx doctor
```

如果仍然无法恢复，可以：

```bash
chatx stop
chatx setup
```

如果还需要主动吊销当前 Workspace 已有的 ChatGPT 授权：

```bash
chatx unpair
```

`unpair` 会吊销当前 Workspace 的已授权 token，所以不要在只是 Tunnel 临时掉线时随意执行。

## 仍然无法定位

收集下面三项信息再提交 Issue：

```bash
chatx --version
chatx status
chatx doctor --no-fix
```

如果需要日志：

```bash
chatx logs --verbose
```

提交日志前请检查并删除任何你不希望公开的本机路径、项目名称或其他隐私信息。
