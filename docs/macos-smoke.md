# macOS Compatibility Smoke

这份清单用于真实 Mac 用户验证 ChatX 的完整链路。

当前 macOS 已有 GitHub Actions 自动验证，但项目维护者暂时没有真实 macOS 设备，因此 **真实 Mac + Cloudflare + ChatGPT Connector 的完整端到端结果仍需要社区确认**。

## 测试目标

确认下面这条链路在真实 macOS 上成立：

```text
macOS Workspace
  → ChatX Bridge
  → Cloudflare Tunnel
  → ChatGPT MCP Connector
  → OAuth / pairing
  → Workspace / Git / process / dedicated browser
```

## 建议环境

请在反馈中注明：

- Mac 型号：Apple Silicon / Intel
- macOS 版本
- Node.js 版本
- ChatX 版本
- 浏览器：Chrome / Edge / Chromium / Chrome Canary
- Tunnel：Quick / Named

## 1. 安装依赖

```bash
brew install node cloudflared
node --version
cloudflared --version
```

Node.js 需要 20+。

## 2. 安装 ChatX

优先使用 README 当前公开 Release 的安装命令。

然后确认：

```bash
chatx --version
```

## 3. 准备一个测试 Workspace

不要用包含隐私或重要凭据的目录。

例如：

```bash
mkdir -p ~/chatx-macos-smoke
cd ~/chatx-macos-smoke
git init
printf "hello from macOS\n" > hello.txt
git add hello.txt
git commit -m "chatx macOS smoke"
```

如果 Git 尚未配置用户名/邮箱，可以只创建文件，不要求一定提交成功。

## 4. 首次配置

```bash
chatx setup
```

优先先测试默认 Quick Tunnel。

记录：

- Bridge 是否正常启动
- 是否得到公网 MCP 地址
- 是否得到 pairing code
- 终端是否出现异常挂起或重复进程

## 5. ChatGPT Connector

在具有自定义 MCP Connector / Developer Mode 权限的 ChatGPT 账号中：

1. 新建当前 Workspace 对应的 Connector
2. Server URL 使用 `chatx setup` 输出的 MCP 地址
3. Authentication 使用 OAuth
4. 输入一次性 pairing code

如果账号没有自定义 MCP 能力，请明确标记为 **BLOCKED BY CHATGPT ACCOUNT CAPABILITY**，不要判定为 ChatX macOS 失败。

## 6. 只读端到端验证

在 ChatGPT 中要求：

```text
列出当前 ChatX 工作区的顶层文件，不要修改任何内容。
```

PASS 条件：能看到 `hello.txt`，且 Workspace 路径身份正确。

## 7. Git 验证

要求 ChatGPT：

```text
查看当前 Git 状态，不要修改文件。
```

PASS 条件：Git 状态与本机实际状态一致。

## 8. 本地进程验证

要求 ChatGPT 执行一个无副作用命令，例如：

```text
运行 node --version，并告诉我输出。
```

PASS 条件：返回当前 Mac 的真实 Node.js 版本。

## 9. 独立浏览器验证

要求 ChatGPT：

```text
用 ChatX 的独立浏览器打开 https://example.com ，告诉我页面标题。
```

预期标题：

```text
Example Domain
```

ChatX 会自动查找：

- Google Chrome
- Microsoft Edge
- Chromium
- Google Chrome Canary

标准安装位置包括 `/Applications` 和 `~/Applications`。

如果浏览器在非标准位置，可设置：

```bash
export CHATX_BROWSER_BIN="/absolute/path/to/browser/executable"
```

然后重启当前 Workspace 的 ChatX Bridge 再测试。

## 10. 诊断

```bash
chatx status
chatx doctor --no-fix
```

如发现问题，再运行：

```bash
chatx doctor
```

## PASS 标准

只有以下项目全部通过，才记为一次完整 macOS Compatibility Smoke PASS：

- Release 可安装
- CLI 可运行
- Bridge 可后台运行
- Cloudflare Tunnel 正常
- ChatGPT Connector + OAuth/pairing 正常
- Workspace 只读访问正常
- Git 正常
- `process.run` 正常
- 独立浏览器正常
- `chatx doctor` 无未处理关键错误

## 反馈模板

```text
macOS Compatibility Smoke

Hardware: Apple Silicon / Intel
macOS:
Node:
ChatX:
Browser:
Tunnel: Quick / Named
ChatGPT custom MCP available: Yes / No

Install: PASS / FAIL
Bridge: PASS / FAIL
Tunnel: PASS / FAIL
Connector/OAuth: PASS / FAIL / BLOCKED
Workspace read: PASS / FAIL
Git: PASS / FAIL
Process: PASS / FAIL
Browser: PASS / FAIL
Doctor: PASS / FAIL

Notes:
- 
```

如果失败，请附上相关的 `chatx doctor --no-fix` 输出和必要日志片段；提交前先检查并删除 token、Cookie、私钥、个人路径等敏感信息。
