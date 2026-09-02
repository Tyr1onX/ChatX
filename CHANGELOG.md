# Changelog

## v0.1.0-alpha.1 — 2026-09-02

First ChatX public alpha preparation.

### Added

- ChatX product branding and `chatx` CLI, with `c2c` compatibility alias.
- Direct local capabilities: workspace writes, local process execution, and dedicated-browser control.
- Narrow capability scopes: `workspace.write`, `process.run`, and `browser.control`.
- Cloudflare Quick/Named and transport-neutral tunnel abstraction.
- Experimental OpenAI Secure MCP Tunnel provider using the official managed `tunnel-client` runtime.
- Windows-specific OpenAI tunnel proxy support and non-blocking runtime supervision.
- `.chatxignore` with `.c2cignore` compatibility.
- Windows/Ubuntu CI on Node.js 20 and 22.
- Deterministic npm package allow-list and clean-install release smoke test.
- Tagged GitHub Release workflow producing a tarball and SHA-256 checksums.

### Compatibility

- Existing `workspace.control` tokens remain accepted as a legacy broad control scope.
- Existing connector names remain unchanged when already persisted.
- Existing `codex-with-chatgpt` OS state directory is intentionally reused.
- Existing `C2C_*` environment variables and token prefixes remain supported.

### Security documentation

- Replaced the obsolete claim that ChatGPT has no write/exec capability.
- Explicitly documents that `process.run` is host-level execution under the current OS user and is not a filesystem/OS sandbox.
- Documents transport-specific identity boundaries for Cloudflare and OpenAI Tunnel modes.

### Verification

The release gate covers unit/integration tests, typecheck, build, production dependency audit, secret scan, diff hygiene, tarball contents, clean tarball installation, and packaged CLI version/alias execution.
