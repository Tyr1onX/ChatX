# ChatX

**让 ChatGPT 安全地调用你本机能力的本地桥接器。** ChatX 运行在你的电脑上，通过 MCP 暴露受边界控制的工作区、Git、本地进程和专用浏览器能力。

> **Alpha：** `v0.1.0-alpha.1` 面向技术测试用户。Cloudflare 仍是当前已经完整跑通的默认传输；OpenAI Secure MCP Tunnel 已完成实现并在 Windows 本机验证到 `healthy / ready / MCP 200`，但 ChatGPT 侧是否能创建 Tunnel 连接仍取决于账号/工作区权限。

> **ChatGPT 权限说明：** 安装 ChatX 本身不会给 ChatGPT 账号解锁自定义 MCP。Connector / Developer Mode / Tunnel 能否使用取决于当前套餐、工作区策略和 OpenAI 产品开放情况。Cloudflare 只解决网络链路，ChatGPT 账号本身仍需具备添加/使用连接器的权限。

[English](README.md) · [安全模型](docs/security.md) · [架构](docs/architecture.md) · [排障](docs/troubleshooting.md)

## ChatX 是什么

```text
ChatGPT / MCP Client
        |
        | MCP + 认证传输
        v
      ChatX                 <- 本机 Node.js，HTTP 只监听 loopback
  +-----+------+-----+
  |            |     |
工作区         Git   专用浏览器
读 / 写             Playwright
  |
本地进程执行
(shell:false / 输出限制 / 超时)
        |
        v
      Windows / macOS / Linux
```

当前 MCP 能力包括：

- 工作区识别、目录、文件读取、搜索
- Git status / diff
- 执行记录读取
- 工作区文件写入
- 本地进程执行
- 专用 Playwright 浏览器的 navigate / snapshot / click / type

直接控制权限已经拆分为：

- `workspace.write`：仅写工作区内文件
- `process.run`：运行本地可执行程序；**这是当前 OS 用户权限下的主机级代码执行能力，属于高权限能力**
- `browser.control`：控制 ChatX 自己的专用浏览器 Profile
- `workspace.control`：旧版宽权限，仅为了兼容现有已配对连接继续保留

## 传输方式

ChatX 核心不绑定某一家 Tunnel：

- **Cloudflare Quick / Named Tunnel**：当前默认，已在真实 ChatGPT 环境长期使用。公网 MCP 由 ChatX OAuth + 一次性配对码保护。
- **OpenAI Secure MCP Tunnel（实验性）**：官方 `tunnel-client` 主动连 OpenAI，再转发到本机 loopback MCP。支持 managed runtime、健康检查、Windows 单独代理注入，不产生 ChatX 公网 URL。
- **Local**：仅 localhost，开发和测试使用。

## 从源码安装

需要 Node.js 20+、Git。Cloudflare 模式还需要 `cloudflared`。

```bash
git clone https://github.com/Tyr1onX/ChatX.git
cd ChatX
corepack pnpm install
corepack pnpm build
node bin/c2c.js --version
```

对外主 CLI 是 `chatx`；`c2c` 作为兼容别名继续保留。源码 checkout 可以：

```bash
npm link
chatx --version
```

对某个项目：

```bash
chatx setup -w /你的/项目路径
chatx status -w /你的/项目路径
chatx doctor -w /你的/项目路径
```

仓库里的 `skill/SKILL.md` 可安装给 Codex，让它自动处理 ChatX 的安装、连接维护和排障。

## 发布包

每个 tag 版本都必须通过：

```text
测试
TypeScript typecheck
build
生产依赖 audit
真正的 npm tarball 全新安装 smoke
```

GitHub Release 自动生成 `.tgz` 和 `SHA256SUMS.txt`。

发布包使用明确白名单，只包含运行所需的 `dist/`、CLI、文档、Skill、示例、README 和 License，不包含 `src/`、`tests/`。这专门修复了之前已经实测确认的发布缺陷：旧包没有 `dist/`，全新安装后会尝试加载开发依赖 `tsx` 并直接报错。

## 安全边界

ChatX 的能力很强，所以发布版不再使用“ChatGPT 没有写/执行能力”这种错误安全承诺，而是明确能力边界：

- Bridge HTTP 只绑定 `127.0.0.1 / ::1 / localhost`
- Cloudflare 公网路径必须经过 ChatX OAuth，token 与单一 workspace 绑定
- OpenAI Tunnel 模式下，MCP 目标仍只在 loopback；远端身份由 OpenAI Tunnel 权限承担，本机仍由 ChatX 执行工作区/敏感文件/进程/浏览器规则
- 文件路径 canonicalize，拦截 `..`、绝对路径逃逸、符号链接逃逸
- `.env`、SSH key、私钥、云凭据、`.npmrc` 等默认不可读取/写入
- `.chatxignore` 可以额外屏蔽项目文件；旧 `.c2cignore` 继续兼容
- `write_file` 受 workspace 边界和 1 MiB 限制
- `run_command` 使用 `executable + args`，默认 `shell:false`，限制输出和超时；**但被启动的程序本身仍可能访问当前 Windows/macOS/Linux 用户有权限访问的主机资源**
- 浏览器使用独立 Profile，不自动接管你的正常 Chrome Profile
- OpenAI Tunnel runtime key 只通过环境变量引用，不写入项目、Git 或 ChatX 状态文件

启用 `process.run` 等权限前建议先读：[docs/security.md](docs/security.md)。

## 兼容旧版本

这次改名不会粗暴破坏现有用户：

- `c2c` 命令继续有效
- 旧 `workspace.control` token 继续能调用新拆分后的控制能力
- 已保存的 ChatGPT Connector 名称不会强制改名
- 当前 alpha 仍复用旧 `codex-with-chatgpt` OS 状态目录，因此现有 OAuth token、Tunnel 元数据、session、日志不会因为改名丢失
- 新环境变量优先使用 `CHATX_*`，旧 `C2C_*` 仍兼容

## 开发 / 发布门禁

```bash
corepack pnpm test
corepack pnpm typecheck
corepack pnpm build
corepack pnpm audit --prod
corepack pnpm release:smoke
```

CI 当前覆盖 Windows + Ubuntu，Node.js 20 / 22。

## 当前版本目标

`v0.1.0-alpha.1` 的重点不是继续堆功能，而是把已经能用的桥真正做成一个可以公开测试的项目：

- 正式 ChatX 品牌
- Cloudflare / OpenAI / Local transport 抽象
- 细粒度权限
- 与真实能力一致的安全文档
- 可重复的发布包
- 跨平台 CI
- clean install 发布验收

**这是非官方社区项目，与 OpenAI、Cloudflare 无隶属或背书关系。**

## 上游与许可证

ChatX 从 [XiaoDuoYa/codex-with-chatgpt](https://github.com/XiaoDuoYa/codex-with-chatgpt) 演化而来。原 Git 历史和 MIT License 保留。见 [LICENSE](LICENSE)。
