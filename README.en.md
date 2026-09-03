# ChatX

**A local capability bridge for ChatGPT.** ChatX runs on your computer and lets ChatGPT work with an authorized local workspace, Git, local processes, and a dedicated browser through MCP.

> **Latest public release:** `v0.1.0-alpha.1`  
> `main` is now the `v0.1.0-alpha.2` candidate and contains the first macOS support pass. Until that prerelease is published, macOS testers should use the source-install path in [docs/macos-smoke.md](docs/macos-smoke.md).

[中文](README.md) · [AI Agent setup](docs/agent-setup.md) · [Troubleshooting](docs/troubleshooting.md) · [Security](docs/security.md)

## Platform status

| Platform | Status |
| --- | --- |
| Windows | Verified in real use and CI |
| macOS | Source verified on GitHub macOS Node 20/22 CI, including a real dedicated-browser launch smoke; real Mac + ChatGPT end-to-end community smoke still requested |
| Linux | Core CI verified; real desktop end-to-end coverage is still limited |

macOS uses the same ChatX codebase as Windows. Browser discovery supports Google Chrome, Microsoft Edge, Chromium, and Chrome Canary in standard macOS locations. Use `CHATX_BROWSER_BIN` for a non-standard executable path.

## What ChatX does

```text
ChatGPT
   ↓
authenticated connection
   ↓
ChatX on your computer
   ↓
Workspace / Git / Process / Dedicated browser
```

Typical tasks include inspecting project files, reviewing Git state, applying requested workspace changes, running local commands, reading logs, and validating pages in ChatX's separate browser profile.

## Before you start

A complete ChatX setup requires:

1. Node.js 20+, `cloudflared`, and a local project workspace.
2. A ChatGPT account/workspace with custom MCP Connector / Developer Mode access.
3. One-time Connector setup and pairing for the target workspace.

A Cloudflare account or custom domain is **not required**. Quick Tunnel is the simplest default. A Cloudflare-managed domain is optional when you want a stable address.

## Recommended: let your AI Agent configure ChatX

If you use Codex, Claude Code, Cursor Agent, or another local terminal-capable agent, give it the repository and ask it to continue through the actual ChatGPT Connector and end-to-end workspace verification rather than stopping after package installation.

- Codex: read `skill/SKILL.md`
- Other agents: read `docs/agent-setup.md`

## Manual install

Windows dependencies:

```powershell
winget install --id OpenJS.NodeJS.LTS
winget install --id Cloudflare.cloudflared
```

macOS dependencies:

```bash
brew install node cloudflared
```

Latest public release:

```bash
npm install -g https://github.com/Tyr1onX/ChatX/releases/download/v0.1.0-alpha.1/chatx-local-bridge-0.1.0-alpha.1.tgz
```

Then, inside the target project:

```bash
chatx setup
```

Add the MCP address produced by `chatx setup` to the matching ChatGPT Connector and complete pairing. A final read-only check should confirm ChatGPT can see the real target workspace.

> macOS testers should not use `alpha.1` to judge the new browser support. Follow [docs/macos-smoke.md](docs/macos-smoke.md) and test current `main` until the next prerelease is public.

## Maintenance

```bash
chatx status
chatx doctor
chatx pair
chatx logs
chatx stop
```

Use `chatx doctor` first when the connection needs repair.

## Security

ChatX has strong local capabilities. Only connect trusted AI clients and only expose workspaces you intend to authorize. Local processes run with the permissions of the current OS account; ChatX is not a full host sandbox.

See [docs/security.md](docs/security.md) for the complete boundary.

## More documentation

- [AI Agent setup](docs/agent-setup.md)
- [macOS Compatibility Smoke](docs/macos-smoke.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Security](docs/security.md)
- [Architecture](docs/architecture.md)
- [Protocol](docs/protocol.md)

**Unofficial community project. Not affiliated with or endorsed by OpenAI or Cloudflare.**
