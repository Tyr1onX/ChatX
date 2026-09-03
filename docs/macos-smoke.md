# macOS Compatibility Smoke

这份清单用于真实 Mac 用户验证 ChatX 的完整链路。

ChatX 的 macOS 代码已经通过 GitHub `macos-latest` 上的 Node 20 / 22 自动测试，并且 CI 已真实启动 ChatX 独立浏览器完成页面 Smoke。项目维护者目前没有实体 Mac，因此 **Cloudflare + ChatGPT Connector + 本地 Workspace 的真实用户端到端结果仍需要社区确认**。

## 当前安装方式

最新公开 Release 仍是 `v0.1.0-alpha.1`，它不包含本轮新增的 macOS 浏览器支持。

在 `v0.1.0-alpha.2` prerelease 发布前，请从当前 `main` 源码测试：

```bash
git clone https://github.com/Tyr1onX/ChatX.git
cd ChatX
corepack pnpm install
corepack pnpm build
npm link
chatx --version
```

预期源码版本：

```text
0.1.0-alpha.2
```

## 测试环境

请记录：

- Hardware：Apple Silicon / Intel
- macOS 版本
- Node.js 版本
- ChatX 版本
- Browser：Chrome / Edge / Chromium / Chrome Canary
- Tunnel：Quick / Named

## 1. 安装系统依赖

```bash
brew install node cloudflared
node --version
cloudflared --version
```

Node.js 需要 20+。

## 2. 准备测试 Workspace

请使用不含重要数据的临时目录：

```bash
mkdir -p ~/chatx-macos-smoke
cd ~/chatx-macos-smoke
git init
printf "hello from macOS\n" > hello.txt
```

## 3. 首次配置

在测试 Workspace 中运行：

```bash
chatx setup
```

建议第一次先使用 Quick Tunnel。

确认：

- Bridge 能正常启动
- 能得到公网 MCP 地址
- 能得到配对信息
- 没有异常挂起或重复进程

## 4. ChatGPT Connector

在支持自定义 MCP Connector / Developer Mode 的 ChatGPT 账号中，为这个测试 Workspace 添加 Connector，并使用 `chatx setup` 输出的地址完成配对。

如果账号本身没有该能力，请记录：

```text
BLOCKED BY CHATGPT ACCOUNT CAPABILITY
```

这不算 ChatX macOS 失败。

## 5. Workspace 只读验证

对 ChatGPT 说：

```text
列出当前 ChatX 工作区的顶层文件，不要修改任何内容。
```

PASS：能够看到 `hello.txt`，并且 Workspace 身份正确。

## 6. Git 验证

```text
查看当前 Git 状态，不要修改文件。
```

PASS：结果与本机实际状态一致。

## 7. 本地进程验证

```text
运行 node --version，并告诉我输出。
```

PASS：返回当前 Mac 的真实 Node.js 版本。

## 8. 独立浏览器验证

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

标准位置包括 `/Applications` 和 `~/Applications`。

非标准安装位置可以设置：

```bash
export CHATX_BROWSER_BIN="/absolute/path/to/browser/executable"
```

然后重启当前 Workspace 的 Bridge 再测试。

## 9. 诊断

```bash
chatx status
chatx doctor --no-fix
```

需要修复时：

```bash
chatx doctor
```

## 完整 PASS 标准

一次真实 macOS Compatibility Smoke 需要同时满足：

- 源码安装 / 构建成功
- CLI 正常
- Bridge 后台运行正常
- Cloudflare Tunnel 正常
- ChatGPT Connector / 配对正常
- Workspace 读取正常
- Git 正常
- 本地进程正常
- 独立浏览器正常
- `chatx doctor` 没有未处理的关键错误

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
Connector: PASS / FAIL / BLOCKED
Workspace read: PASS / FAIL
Git: PASS / FAIL
Process: PASS / FAIL
Browser: PASS / FAIL
Doctor: PASS / FAIL

Notes:
-
```

失败时请附上必要的诊断输出，但先移除个人信息和敏感内容。
