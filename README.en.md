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

## Recommended setup: let Codex / an AI Agent do it

Users should not need to manually manage Node.js, Bridge processes, ports, or Cloudflare commands.

Give Codex this prompt:

```text
Install and fully configure ChatX for the current project:
https://github.com/Tyr1onX/ChatX

Read skill/SKILL.md and follow the first-time setup workflow.
Handle local installation, workspace selection, Bridge, cloudflared, Cloudflare connectivity, chatx setup, diagnostics, and verification yourself.
Only ask me to act when a login, authorization, OAuth step, CAPTCHA/2FA, or explicit consent genuinely requires me.

For ChatGPT, use only the verified path:
Settings → Plugins → New plugin → Server URL → paste the URL produced by ChatX → Authentication: OAuth → create and finish authorization/pairing.
Do not send me to Developer Mode and do not infer an alternative MCP setup path from my plan.

Finish only after ChatGPT can read the real current workspace.
Do not modify project business code just to install ChatX.
```

Other terminal-capable agents should read [docs/agent-setup.md](docs/agent-setup.md) and follow the same verified path.

## What the user actually needs to do

During a normal first-time setup, user interaction should be limited to actions that cannot be reliably delegated:

1. **Cloudflare login / authorization**, only when the selected connection requires it.
2. **ChatGPT plugin creation / OAuth**, using the MCP Server URL produced by ChatX.

In ChatGPT, use:

```text
Settings
→ Plugins
→ New plugin
→ Connection: Server URL
→ paste the URL from ChatX
→ Authentication: OAuth
→ acknowledge the custom MCP warning
→ Create
→ finish authorization / pairing
```

Do not use Developer Mode as a prerequisite and do not look for a separate setup route under Advanced Settings or Security.

Then verify with a read-only request such as:

```text
List the top-level files in the current ChatX workspace. Do not modify anything.
```

The setup is complete only when the result comes from the real local workspace.

## Cloudflare connection

Cloudflare Quick Tunnel is the default simple path:

- no custom domain required
- easiest to start
- the public address may change after a restart or reconnect

If the user already has a Cloudflare-managed domain and wants a stable address, the Agent can configure a Named Tunnel. The user should only be involved for login / authorization when required.

## Advanced: manual install

Use this only when no AI Agent is available.

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

Copy the MCP Server URL from `chatx setup`, then create a ChatGPT plugin through:

```text
Settings → Plugins → New plugin → Server URL → OAuth
```

Paste the URL, create the plugin, and complete authorization / pairing.

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