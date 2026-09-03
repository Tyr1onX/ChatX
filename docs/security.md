# ChatX Security Model

ChatX deliberately exposes local capabilities to a remote AI client. Its security model is based on explicit capability boundaries, loopback-only local services, scoped OAuth authorization, path containment, and truthful documentation of what is **not** sandboxed.

## Trust boundaries

1. **Workspace boundary.** One ChatX bridge instance serves exactly one workspace. OAuth tokens are bound to that `workspace_id`.
2. **Workspace content is untrusted.** README files, source code, diffs and logs may contain prompt injection. MCP tool descriptions explicitly tell the model to treat project content as data, not instructions.
3. **Network reachability is not authorization.** Cloudflare only provides the HTTPS path to the loopback bridge. ChatX OAuth and bearer-token checks authorize MCP access.
4. **`process.run` is host-level execution.** The working directory is workspace-bounded and ChatX does not invoke an implicit shell, but an executable launched under the current OS account may access resources outside the workspace if that OS account can access them. Do not describe `process.run` as a filesystem sandbox.
5. **Browser control is isolated from the user's normal browser by profile, not by OS sandbox.** ChatX uses a dedicated Playwright profile and does not automatically attach to the normal Chrome/Edge profile.

## Capability scopes

New authorizations expose narrow scopes:

| Scope | Capability |
| --- | --- |
| `workspace.read` | Workspace metadata, directory and file reads |
| `workspace.search` | Workspace search |
| `git.read` | Git status and diff |
| `execution.read` | Local execution summaries |
| `workspace.write` | `write_file` |
| `process.run` | `run_command` |
| `browser.control` | Dedicated-browser navigate/snapshot/click/type |
| `offline_access` | Refresh-token flow |

`workspace.control` is a **deprecated compatibility scope**. Existing paired connectors may already hold it, so ChatX accepts it as an alias for `workspace.write`, `process.run`, and `browser.control`. New deployments use the narrower scopes.

## Threats and mitigations

| Threat | Mitigation / limitation |
| --- | --- |
| Public MCP URL leaks | URL knowledge is insufficient: `/mcp` requires a valid bearer token. Tokens are workspace-bound. |
| Pairing-code brute force | CSPRNG code, short TTL, one-time use, attempt limit and rate limiting. |
| OAuth interception / CSRF | PKCE S256, state round-trip, short-lived one-time authorization codes, redirect URI validation. |
| Token theft from state file | Persisted token records contain SHA-256 hashes rather than raw bearer/refresh tokens. Access tokens expire; refresh tokens rotate. |
| Workspace path traversal | Canonical realpath containment; absolute escapes, `..`, symlink escapes, backslash tricks and null bytes are rejected/tested. |
| Sensitive-file disclosure | Deny patterns cover `.env*` (except `.env.example`), private keys, SSH/cloud credential directories, `.npmrc`, service-account files and related secrets. Git diff also excludes sensitive paths. |
| Project-specific sensitive data | `.chatxignore` adds deny rules. `.c2cignore` remains supported for compatibility. |
| Oversized output / response DoS | File/diff/search limits; `write_file` max 1 MiB; command stdout/stderr capped; command timeout max 120 s. |
| Implicit shell injection | `run_command` uses `spawn(command, args, { shell:false })`. **However, callers may explicitly launch `cmd.exe`, `powershell.exe`, `bash`, etc. when authorized, which is equivalent to shell execution.** |
| Command escaping workspace | The `cwd` is workspace-contained, but the executable is not OS-sandboxed. `process.run` must be treated as high privilege. |
| Browser credential exposure | ChatX returns page text, not raw cookie/storage values. Dedicated profile is used. Pages themselves can still contain sensitive visible information, so `browser.control` is high trust. |
| Admin API exposure | Loopback-only, random admin token, proxy-header rejection, unauthenticated probes return 404. |
| Tunnel exposure | Bridge refuses non-loopback bind addresses. Public exposure exists only through Cloudflare. |
| Prompt injection | Project content cannot grant new scopes. Tool calls still execute with whatever capabilities the user already authorized, so the model/client must follow the user's intent and treat project instructions as untrusted. |
| Credential leakage in logs | Logger redacts bearer/token-like values. |

## Connection model

```text
ChatGPT
  -> HTTPS Cloudflare Quick / Named Tunnel
  -> ChatX loopback bridge
  -> ChatX OAuth / bearer scope checks
  -> MCP tools
```

- The bridge itself binds only to loopback.
- Cloudflare Quick and Named Tunnel are network transports, not authorization systems.
- OAuth discovery, authorization and token endpoints are part of ChatX.
- Public MCP requests require bearer authorization.
- Knowing the public hostname is not authorization.
- ChatGPT setup uses one verified flow: Plugins → New plugin → Server URL → OAuth.

## Local state and compatibility

State is stored with owner-oriented filesystem permissions where supported. During the current alpha line, the default directory intentionally remains the legacy `codex-with-chatgpt` state directory so existing OAuth tokens, connector metadata and sessions survive the ChatX rename. `CHATX_STATE_DIR` is the preferred override; `C2C_STATE_DIR` remains accepted.

Token prefixes (`c2c_at`, `c2c_rt`, etc.) are also retained for compatibility and should be treated as secrets regardless of their historical name.

## Direct-control rules

### `write_file`

- workspace-relative path only
- canonical containment and sensitive-file checks
- existing files require `overwrite=true`
- 1 MiB maximum content

### `run_command`

- separate `process.run` scope
- executable + argument array, `shell:false`
- workspace-contained `cwd`
- max 100 arguments
- max 120 s timeout
- stdout/stderr capped
- **not a host sandbox**; the child process inherits the permissions of the ChatX OS user

### Browser tools

- separate `browser.control` scope
- dedicated persistent Playwright profile
- text snapshot is capped
- no direct API for exporting cookies/storage
- the browser can still perform authenticated actions inside its own profile, so authorization should be treated as sensitive

## Known alpha limitations

- Raw OAuth tokens are not stored, but persisted token hashes/registrations are file-based rather than OS-keychain-backed.
- `process.run` does not provide executable allowlists or per-call human confirmations yet.
- Browser control is not an OS-level sandbox.

## Security release gate

Before a tagged release, the repository must pass tests, typecheck, build, production dependency audit, secret-pattern scan, `git diff --check`, and a clean tarball install smoke. CI covers Windows, macOS, and Linux where configured by the current workflow.
