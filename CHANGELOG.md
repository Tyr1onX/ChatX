# Changelog

## Unreleased — v0.1.0-alpha.2 candidate

macOS testing alpha, onboarding improvements, and connection-architecture cleanup. The source version is prepared as `0.1.0-alpha.2`, but the public prerelease has not been published yet.

### Added

- macOS browser discovery for Google Chrome, Microsoft Edge, Chromium, and Chrome Canary.
- `CHATX_BROWSER_BIN` override for non-standard browser executable locations.
- macOS GitHub Actions coverage on Node.js 20 and 22.
- macOS CI browser smoke that actually launches the ChatX dedicated browser and validates a page.
- Real-device macOS compatibility smoke checklist covering install, Bridge, Cloudflare, ChatGPT Connector, Workspace, Git, process execution, browser control, and doctor.
- First successful community real-Mac installation and ChatGPT connection result.
- Chinese-first README onboarding with Agent-first setup instructions and explicit external ChatGPT/Cloudflare prerequisites.

### Changed

- Browser discovery is now platform-aware across Windows, macOS, and common Linux desktop paths.
- README now records real Windows and macOS ChatGPT end-to-end installation validation instead of treating macOS as CI-only.
- AI Agent guidance treats ChatGPT Connector and end-to-end Workspace access as part of completion, not just local package installation.
- Remote connection architecture now has one supported path: Cloudflare Quick/Named → Server URL → ChatX OAuth → MCP.
- `TunnelProvider`, Bridge, CLI, Doctor, and tunnel state no longer carry a second private-tunnel identity model.

### Removed

- Experimental OpenAI Secure MCP Tunnel runtime and `tunnel-client` integration.
- Tunnel-ID based setup/status/doctor branches and their dedicated tests/documentation.
- Developer Mode URL from ChatX runtime setup metadata. Developer Mode remains explicitly unsupported as an onboarding prerequisite.

### Security

- Every remote `/mcp` path now uses the same ChatX OAuth bearer authorization boundary.
- Override the transitive `qs` dependency to `>=6.16.0` to pick up the patched release required by the production dependency audit.

## v0.1.0-alpha.1 — 2026-09-02

First ChatX public alpha preparation.

### Added

- ChatX product branding and `chatx` CLI.
- Direct local capabilities: workspace writes, local process execution, and dedicated-browser control.
- Narrow capability scopes: `workspace.write`, `process.run`, and `browser.control`.
- Cloudflare Quick/Named support.
- An experimental OpenAI Secure MCP Tunnel prototype, later removed from the alpha.2 candidate in favor of the verified Server URL + OAuth path.
- `.chatxignore` with the previous ignore filename retained for compatibility.
- Windows/Ubuntu CI on Node.js 20 and 22.
- Deterministic npm package allow-list and clean-install release smoke test.
- Tagged GitHub Release workflow producing a tarball and SHA-256 checksums.

### Compatibility

- Existing `workspace.control` tokens remain accepted as a legacy broad control scope.
- Persisted legacy connector titles are migrated to ChatX after the ChatGPT-side replacement is confirmed.
- The previous OS state directory is intentionally reused so existing local state survives upgrades.
- Legacy environment-variable aliases and token prefixes remain supported internally.

### Security documentation

- Replaced the obsolete claim that ChatGPT has no write/exec capability.
- Explicitly documents that `process.run` is host-level execution under the current OS user and is not a filesystem/OS sandbox.

### Verification

The release gate covers unit/integration tests, typecheck, build, production dependency audit, secret scan, diff hygiene, tarball contents, clean tarball installation, and packaged CLI version/alias execution.
