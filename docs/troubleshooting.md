# ChatX 排障

遇到问题时，第一步通常都是：

```bash
chatx doctor
```

它会检查 Node.js、Workspace、Bridge、MCP、OAuth 和 Cloudflare 连接，并自动修复能够安全修复的部分，例如重新启动 Bridge 或重新建立公网连接。

如果需要只检查、不自动修复：

```bash
chatx doctor --no-fix
```

> `chatx` 是当前主命令；旧的 `c2c` 仍然作为兼容别名保留。

## 先判断问题在哪一层

ChatX 当前首次安装只采用这一条已经验证过的路线：

```text
ChatGPT 插件
  ↓
Cloudflare 公网连接
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

默认 Cloudflare 连接需要 `cloudflared`。

Windows：

```powershell
winget install --id Cloudflare.cloudflared
```

macOS：

```bash
brew install cloudflared
```

安装后重新运行：

```bash
chatx setup
```

或：

```bash
chatx doctor
```

如果你是让 Codex / AI Agent 安装 ChatX，这一步应该由 Agent 自己完成，不需要用户手动执行。

## ChatGPT 里找不到 ChatX 的添加入口

ChatX 只检查已经验证的添加入口，不根据套餐名称切换接入方式。

ChatX 已验证的添加入口是：

```text
设置
→ 插件
→ 新插件
```

在「新插件」页面：

```text
连接：服务器 URL
服务器 URL：chatx setup / doctor 给出的当前 MCP URL
身份验证：OAuth
```

然后勾选自定义 MCP 风险确认，创建并完成 OAuth / 配对。

如果当前 ChatGPT 界面确实没有「插件 → 新插件」入口，记录当前实际界面并提交兼容性反馈。不要自行尝试另一套接入方式，也不要把套餐猜测当成故障结论。

## `配对码无效` / `配对码已过期`

配对码是一次性的，并且只有几分钟有效期。

重新生成：

```bash
chatx pair
```

然后在 ChatGPT 的 OAuth 授权页输入新的配对码。

生成新配对码后，旧配对码立即视为无效。

## ChatGPT 插件原来能用，后来突然连不上

如果使用默认 Cloudflare Quick 地址，电脑重启、Bridge / cloudflared 停止或连接重建后，公网地址可能变化。

先运行：

```bash
chatx doctor
```

如果 doctor 提示地址已经更换：

1. 获取 doctor 输出的新 MCP Server URL。
2. 只删除当前 Workspace 对应的旧 ChatX 插件。
3. 使用同一条「设置 → 插件 → 新插件 → 服务器 URL → OAuth」路线重新创建。
4. 如果输出了新配对码，在 OAuth 授权页输入它。
5. 再次做端到端验证。

**不要删除另一个 Workspace 的 ChatX 插件。**

如果不希望 Quick 地址变化，可以让 Agent 配置 Cloudflare 固定域名。

## Cloudflare 地址无法访问 / ChatGPT 提示插件损坏

先运行：

```bash
chatx doctor
```

### 使用 Cloudflare Quick

如果公网地址已经变化，按 doctor 提示删除并重新创建当前 Workspace 的 ChatX 插件。

### 使用 Cloudflare 固定域名

如果固定域名本身没有变化，不要先删除 ChatGPT 插件。

尝试重新登录 Cloudflare：

```bash
chatx tunnel login
chatx doctor
```

需要登录 / 授权时由用户完成浏览器页面，其余操作继续交给 Agent。

## 想使用 Cloudflare 固定域名

如果已经有托管在 Cloudflare 的域名，例如 `example.com`：

```bash
chatx tunnel choose --mode named --zone example.com
```

按照提示完成 Cloudflare 登录 / 授权。

配置完成后：

```bash
chatx setup
```

固定域名的主要好处是电脑重启后通常不需要因为 Quick 地址变化而重新配置 ChatGPT 插件。

没有固定域名需求时继续使用：

```bash
chatx tunnel choose --mode quick
```

如果由 Codex / AI Agent 安装，应由 Agent 自己运行这些命令，只在 Cloudflare 登录 / 授权页面需要用户操作。

## ChatGPT 每次调用都返回 `401`

这通常表示 ChatX OAuth 授权已经失效，例如 token 刷新失败、执行过 `chatx unpair`，或者插件保存的授权已经过期。

先运行：

```bash
chatx doctor
```

如果公网地址没有变化，重新授权，并使用：

```bash
chatx pair
```

生成新的配对码。

如果公网地址也已经变化，则使用新的地址按同一条「新插件 → 服务器 URL → OAuth」路线重新创建当前 Workspace 的插件。

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

`chatx setup`、`chatx doctor` 和：

```bash
chatx sandbox-allow
```

会尝试把需要的状态目录加入 Codex 沙箱可写白名单，使后续对话能够正常维护 ChatX 状态和日志。

这一步应该由 Codex 自动处理。

## 端口被占用

通常不需要手动处理。

如果同一个 Workspace 已经存在健康的 Bridge，ChatX 会复用它；否则会自动选择可用端口，并同步更新运行时配置。

如果仍然异常：

```bash
chatx stop
chatx start
```

## 如何确认完整链路真的成功？

先确认本机：

```bash
chatx status
chatx doctor
```

然后在已经启用 ChatX 插件的 ChatGPT 对话中执行一个只读任务：

```text
列出当前 ChatX 工作区的顶层文件，不要修改任何内容。
```

如果 ChatGPT 返回的是真实本机项目文件，说明完整路径已经工作：

```text
ChatGPT → ChatX 插件 → Cloudflare → ChatX Bridge → 本地 Workspace
```

第一次测试建议按这个顺序逐步增加权限：

```text
读取文件 → Git status/diff → 写测试文件 → 本地命令 → 浏览器控制
```

## 想完全重新建立当前项目的连接

先尝试：

```bash
chatx doctor
```

如果仍然无法恢复：

```bash
chatx stop
chatx setup
```

如果还需要主动吊销当前 Workspace 已有的 ChatGPT 授权：

```bash
chatx unpair
```

`unpair` 会吊销当前 Workspace 的已授权 token，所以不要在只是 Cloudflare 临时掉线时随意执行。

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