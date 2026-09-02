# ChatX

**A local capability bridge for ChatGPT.** ChatX runs on your computer and exposes a bounded set of workspace, Git, process, and dedicated-browser capabilities through MCP.

> **Alpha:** `v0.1.0-alpha.1` is intended for technical testers. Cloudflare transport is the production-tested path. OpenAI Secure MCP Tunnel support is implemented and locally verified, but availability of the ChatGPT-side Tunnel connection UI depends on the account/workspace.

> **ChatGPT access:** installing ChatX does not itself enable custom MCP in ChatGPT. Connector / Developer Mode / Tunnel availability depends on the ChatGPT plan, workspace policy, and current OpenAI product rollout. Cloudflare can provide the network path, but the ChatGPT account still needs permission to add/use the connector.

[中文文档](README.zh-CN.md) · [Security](docs/security.md) · [Architecture](docs/architecture.md) · [Troubleshooting](docs/troubleshooting.md)

## What ChatX does

```text
ChatGPT / MCP client
        |
        | MCP over an authenticated transport
        v
      ChatX                <- local Node.js process, loopback only
  +-----+------+-----+
  |            |     |
Workspace     Git  Dedicated browser
read/write         Playwright
  |
Process runner
(shell:false, bounded output/timeout)
        |
        v
     Your OS
```

Current MCP capabilities include workspace inspection/search/read, Git status/diff, execution summaries, workspace file writes, local process execution, and navigation/snapshot/click/type in a dedicated Playwright browser profile.

Direct-control capabilities are separated into OAuth scopes:

- `workspace.write` — write files inside the workspace boundary.
- `process.run` — run local executables. **This is host-level code execution under your OS account and is intentionally high privilege.**
- `browser.control` — control ChatX's dedicated browser profile.
- `workspace.control` — legacy broad scope retained only for upgrade compatibility.

## Transports

ChatX's core is transport-neutral:

- **Cloudflare Quick / Named Tunnel** — current default and end-to-end tested with ChatGPT. ChatX OAuth + one-time pairing protects the public MCP endpoint.
- **OpenAI Secure MCP Tunnel (experimental)** — `tunnel-client` connects outbound to OpenAI and forwards to ChatX on loopback. ChatX supports the official managed runtime, Windows proxy injection, and tunnel health/readiness checks. No public ChatX URL is created.
- **Local** — loopback-only development/testing.

## Install from source

Requirements: Node.js 20+, Git. Cloudflare mode also needs `cloudflared`.

```bash
git clone https://github.com/Tyr1onX/ChatX.git
cd ChatX
corepack pnpm install
corepack pnpm build
node bin/c2c.js --version
```

The primary CLI name is `chatx`. `c2c` is retained as a compatibility alias. When installed from the packaged release artifact, both names are created automatically.

For a local checkout you can link it globally:

```bash
npm link
chatx --version
```

Then, for a workspace:

```bash
chatx setup -w /path/to/project
chatx status -w /path/to/project
chatx doctor -w /path/to/project
```

The bundled Codex skill is under `skill/SKILL.md` for users who want Codex to automate setup and connection maintenance.

## Release package

Every tagged alpha release is gated by tests, typecheck, build, production dependency audit, and a **clean tarball install smoke test**. The GitHub Release workflow publishes a `.tgz` plus `SHA256SUMS.txt`.

The package is intentionally allow-listed: runtime `dist/`, CLI entry, docs, skill, examples, README and license are included; `src/` and `tests/` are excluded. This prevents the old failure mode where a packed install had no `dist/` and crashed looking for the development-only `tsx` dependency.

## Security model

ChatX is powerful by design. The security boundary is explicit rather than implied:

- Bridge HTTP binds only to loopback.
- Cloudflare/public MCP requests require OAuth; access/refresh tokens are scoped to one workspace.
- OpenAI Tunnel mode keeps the target on loopback and relies on the tunnel's remote access policy; ChatX still enforces workspace/sensitive-file/process/browser policy locally.
- Workspace paths are canonicalized; traversal and symlink escapes are blocked.
- Sensitive files such as `.env`, SSH/private keys, cloud credentials and `.npmrc` are denied by default.
- `.chatxignore` can add project-specific exclusions; `.c2cignore` remains supported.
- `write_file` is workspace-bounded and size-limited.
- `run_command` uses an executable + argument array with `shell:false`, output limits and timeouts, **but the executable itself can access host resources allowed to the current OS user**.
- The dedicated browser uses a separate profile; ChatX does not automatically attach to your normal Chrome profile.
- Long-lived keys are not committed or printed by ChatX. OpenAI tunnel runtime keys are referenced through environment variables.

Read the complete threat model before enabling direct-control scopes: [docs/security.md](docs/security.md).

## Compatibility

This alpha deliberately preserves existing installations:

- `c2c` remains a CLI alias.
- Existing `workspace.control` tokens remain accepted for the new narrower control capabilities.
- Existing saved connector names are not rewritten.
- The legacy `codex-with-chatgpt` OS state directory is reused so existing OAuth tokens, tunnel metadata, sessions and logs continue to resolve.
- New environment variables use `CHATX_*`, while existing `C2C_*` variables remain accepted.

## Development

```bash
corepack pnpm test
corepack pnpm typecheck
corepack pnpm build
corepack pnpm audit --prod
corepack pnpm release:smoke
```

CI runs on Windows and Ubuntu with Node.js 20 and 22.

## Project status

`v0.1.0-alpha.1` focuses on making the existing working bridge safe to distribute: ChatX branding, transport abstraction, narrower capabilities, truthful security documentation, deterministic packaging, cross-platform CI, and release smoke tests.

**Unofficial community project. Not affiliated with or endorsed by OpenAI or Cloudflare.**

## Upstream and license

ChatX evolved from [XiaoDuoYa/codex-with-chatgpt](https://github.com/XiaoDuoYa/codex-with-chatgpt). The original Git history and MIT license are retained. See [LICENSE](LICENSE).
