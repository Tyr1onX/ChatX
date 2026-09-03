# ChatX

**让 ChatGPT 安全地调用你电脑上的本地能力。**

ChatX 是一个运行在你电脑上的 MCP 本地桥接器。它可以把指定项目目录、Git、本地进程和一个独立浏览器 Profile 暴露给 ChatGPT，同时尽量把权限限制在明确的边界内。

[English](README.en.md) · [安全模型](docs/security.md) · [架构](docs/architecture.md) · [排障](docs/troubleshooting.md)

> **当前状态：Alpha (`v0.1.0-alpha.1`)。** 现阶段主要面向愿意参与测试的用户。Cloudflare 连接链路已经完整实现并作为默认方案；OpenAI Secure MCP Tunnel 已实现，但 ChatGPT 侧是否提供 Tunnel / 自定义 Connector 入口仍取决于账号和工作区权限。

> **重要：安装 ChatX 不会给你的 ChatGPT 账号解锁自定义 MCP。** 如果你的 ChatGPT 当前没有 Developer Mode / 自定义 Connector / MCP 连接能力，ChatX 无法绕过这个产品权限限制。

## 它到底有什么用？

正常连接后，你可以在 ChatGPT 里让它直接对**你指定的本地项目**做这些事：

- 查看、搜索和读取项目文件
- 查看 Git status / diff
- 在项目边界内写文件
- 运行本地命令或程序
- 操作 ChatX 自己的独立 Playwright 浏览器
- 读取 ChatX 保存的执行记录和项目上下文

例如，不再需要反复手动把代码、日志、目录结构复制到聊天里；ChatGPT 可以直接通过 ChatX 读取项目、执行命令、修改文件，再把结果告诉你。

```text
ChatGPT / MCP Client
        |
        | 认证后的 MCP 连接
        v
      ChatX                  <- 运行在你的电脑上，仅监听 loopback
  +-----+------+-----+
  |            |     |
工作区         Git   独立浏览器
读 / 写             Playwright
  |
本地进程执行
(shell:false / 输出限制 / 超时)
        |
        v
      你的操作系统
```

ChatX **不是远程桌面**，也不会默认接管你正在使用的 Chrome。浏览器能力使用独立 Profile。

## 先确认你能不能用

开始前建议确认：

1. **Node.js 20+**
2. 默认 Cloudflare 连接模式需要 **cloudflared**
3. 你的 ChatGPT 账号 / 工作区能够添加自定义 MCP Connector（或具有对应 Developer Mode / Tunnel 能力）
4. 你理解 `process.run` 属于高权限能力：它运行的程序拥有当前操作系统用户本身具备的权限

如果第 3 条不满足，ChatX 本机部分仍然可以运行，但 ChatGPT 无法真正连进来。

## 最快开始

### 1. 安装 Node.js 和 cloudflared

Windows 可以使用：

```powershell
winget install --id OpenJS.NodeJS.LTS
winget install --id Cloudflare.cloudflared
```

macOS：

```bash
brew install node cloudflared
```

Linux 请安装 Node.js 20+，并按照 Cloudflare 官方方式安装 `cloudflared`。

安装后确认：

```bash
node --version
cloudflared --version
```

### 2. 安装 ChatX

当前公开测试版本可以直接从 GitHub Release 安装：

```bash
npm install -g https://github.com/Tyr1onX/ChatX/releases/download/v0.1.0-alpha.1/chatx-local-bridge-0.1.0-alpha.1.tgz
```

确认安装成功：

```bash
chatx --version
```

应该看到：

```text
0.1.0-alpha.1
```

> `chatx` 是现在的主命令；旧的 `c2c` 命令仍然保留兼容。

### 3. 在你想让 ChatGPT 操作的项目目录启动

进入项目目录：

```bash
cd /path/to/your/project
```

Windows 示例：

```powershell
cd D:\Projects\my-project
```

然后运行：

```bash
chatx setup
```

默认情况下，ChatX 会启动本地 Bridge，并通过 Cloudflare Quick Tunnel 建立安全连接。

正常情况下你会看到类似：

```text
✓ 当前项目已识别（my-project）
✓ Workspace Bridge 已启动
✓ 安全连接已建立

连接地址：https://...trycloudflare.com/mcp
配对码：XXXXXX（约 5 分钟内有效）
```

### 4. 在 ChatGPT 添加连接器

ChatX 输出连接地址和配对码后：

1. 打开 ChatGPT 的连接器 / Developer Mode 设置
2. 新建自定义 Connector
3. 填入 ChatX 输出的 `https://.../mcp` 地址
4. 使用 OAuth 授权
5. 在授权页输入 ChatX 输出的一次性配对码

可直接尝试这些入口：

- Developer Mode：<https://chatgpt.com/#settings/Security>
- 连接器管理：<https://chatgpt.com/plugins>
- 新建连接器：<https://chatgpt.com/plugins#settings/Connectors?create-connector=true&redirectAfter=%2Fplugins>

如果你的账号看不到对应入口，不代表 ChatX 本机安装失败，而是当前 ChatGPT 账号没有开放相应能力。

### 5. 验证连接

本机先运行：

```bash
chatx status
chatx doctor
```

然后在已经启用 ChatX Connector 的 ChatGPT 对话里尝试一个只读任务，例如：

```text
列出当前 ChatX 工作区的顶层文件，不要修改任何内容。
```

如果 ChatGPT 能返回你本机项目的真实文件列表，说明完整链路已经工作。

## 出问题先运行这个

```bash
chatx doctor
```

它会检查 Node.js、Workspace、Bridge、MCP、OAuth 和 Tunnel，并自动修复能够安全修复的部分。

常见情况：

- **Bridge 未运行**：`chatx start`
- **配对码过期**：`chatx pair`
- **查看日志**：`chatx logs`
- **完全重来**：`chatx stop` 后重新 `chatx setup`
- **电脑重启后临时 Cloudflare 地址变化**：运行 `chatx doctor`，再按提示更新对应 ChatGPT Connector

详细说明见 [排障文档](docs/troubleshooting.md)。

## Cloudflare 临时地址和固定域名

### 默认：临时地址

不需要 Cloudflare 账号或域名：

```bash
chatx tunnel choose --mode quick
```

优点是最容易开始；缺点是电脑重启或 Tunnel 重建后公网地址可能变化，此时 ChatGPT 里的旧 Connector 需要更新。

### 可选：固定域名

如果你已经有托管在 Cloudflare 的域名，可以配置固定地址：

```bash
chatx tunnel choose --mode named --zone example.com
```

之后按提示登录 Cloudflare。固定域名配置完成后，一般不需要因为 Quick Tunnel 地址变化而反复更新 Connector。

### 实验性：OpenAI Secure MCP Tunnel

ChatX 已实现 OpenAI Secure MCP Tunnel 支持，但它依赖 ChatGPT / OpenAI 侧对应功能是否对你的账号或工作区开放，因此目前不作为普通用户的默认安装路径。

## 权限与安全边界

ChatX 能运行本地命令，因此不要把它理解成“只读工具”。当前直接控制权限拆分为：

- `workspace.write`：写入当前工作区内文件
- `process.run`：运行本地可执行程序
- `browser.control`：控制 ChatX 的独立浏览器 Profile
- `workspace.control`：旧版本兼容权限

同时有这些默认限制：

- Bridge HTTP 只监听 `127.0.0.1 / ::1 / localhost`
- Cloudflare 公网 MCP 需要 ChatX OAuth + 一次性配对
- Workspace 路径会 canonicalize，阻止 `..`、绝对路径和符号链接逃逸
- `.env`、SSH / 私钥、云凭据、`.npmrc` 等敏感文件默认拒绝访问
- `.chatxignore` 可以增加项目级屏蔽规则；`.c2cignore` 继续兼容
- `write_file` 受 Workspace 边界和大小限制
- `run_command` 使用 executable + args，`shell:false`，并限制输出和超时
- 浏览器使用独立 Profile，不会自动附着到你的日常 Chrome Profile

**注意：** 即使 `run_command` 不通过 shell 执行，被启动的程序本身仍然拥有当前操作系统用户允许的主机权限。启用 `process.run` 前请阅读 [完整安全模型](docs/security.md)。

## 从源码安装（开发者）

普通测试用户优先使用上面的 GitHub Release。需要开发 ChatX 本身时再使用源码安装：

```bash
git clone https://github.com/Tyr1onX/ChatX.git
cd ChatX
corepack pnpm install
corepack pnpm build
npm link
chatx --version
```

开发 / 发布检查：

```bash
corepack pnpm test
corepack pnpm typecheck
corepack pnpm build
corepack pnpm audit --prod
corepack pnpm release:smoke
```

CI 当前覆盖 Windows + Ubuntu、Node.js 20 / 22。Release 流程还会执行真实 npm tarball 的全新安装 smoke，确认发布包里存在编译后的 `dist/` 和 `chatx / c2c` CLI。

## Codex Skill

仓库包含 `skill/SKILL.md`。如果你使用 Codex，可以让 Skill 自动处理 ChatX 安装、Tunnel 选择、连接维护和部分排障，减少手动执行命令的步骤。

## 当前版本定位

`v0.1.0-alpha.1` 的重点是把已有桥接能力整理成一个可以公开测试的产品化基础：

- ChatX 品牌与兼容迁移
- Workspace / Git / Process / Browser MCP 能力
- Cloudflare / OpenAI / Local Transport 抽象
- 更细粒度的控制权限
- 明确的安全边界
- 可重复的 Release 打包
- 跨平台 CI 和 clean-install smoke

目前仍然最需要补的是：**更多真实用户、不同 ChatGPT 账号权限和不同 Windows 环境下的端到端测试。**

**ChatX 是非官方社区项目，与 OpenAI、Cloudflare 无隶属或背书关系。**

## 上游与许可证

ChatX 从 [XiaoDuoYa/codex-with-chatgpt](https://github.com/XiaoDuoYa/codex-with-chatgpt) 演化而来，保留原 Git 历史与 MIT License。见 [LICENSE](LICENSE)。
