# ChatX Architecture

## Overview

ChatX is a local capability bridge. The model/client sends structured MCP calls; a loopback-only Node.js process performs the actual local work and returns structured results.

```text
                   Remote AI client
                  (ChatGPT / MCP)
                         |
                  selected transport
                         |
          +--------------+--------------+
          |                             |
 Cloudflare Quick/Named        OpenAI Secure MCP Tunnel
 public HTTPS endpoint             tunnel-client sidecar
 ChatX OAuth + pairing             outbound HTTPS only
          |                             |
          +--------------+--------------+
                         |
                   127.0.0.1:<port>
                         |
                      ChatX
      +------------------+------------------+
      |                  |                  |
  Workspace/Git       Process runner     Browser controller
  read/search/write   child_process      Playwright profile
      |                  |                  |
      +------------------+------------------+
                         |
                       Host OS
```

## Core modules

| Area | Responsibility |
| --- | --- |
| `src/bridge/` | Express loopback server, runtime state, admin API, transport lifecycle |
| `src/mcp/` | MCP Streamable HTTP endpoint and tool registration |
| `src/auth/` | Cloudflare/public-mode OAuth 2.1, PKCE, pairing, token storage |
| `src/workspace/` | Workspace identity, path containment, sensitive-file rules, search and Git |
| `src/tunnel/` | Vendor-neutral provider interface; Cloudflare and OpenAI implementations |
| `src/browser/` | Dedicated Playwright browser controller |
| `src/process/` | Background bridge lifecycle |
| `src/execution/` | Execution summaries used for review/status workflows |
| `src/cli/` | `chatx` CLI (`c2c` compatibility alias) |

## Local server

The bridge refuses non-loopback bind addresses. Its local HTTP surface includes:

- `/mcp` — Streamable HTTP MCP endpoint
- `/health` — minimal health response
- OAuth discovery/authorization/token endpoints in Cloudflare/public mode
- `/admin/*` — loopback + random admin-token protected CLI control surface

The bridge is one-workspace-per-instance. Workspace IDs are stable hashes derived by the workspace manager and are used to separate token/state records.

## MCP capability layers

Read-oriented capabilities:

```text
workspace_info
list_directory
read_file
search_workspace
git_status
git_diff
test_status
execution_summary
```

Direct-control capabilities:

```text
write_file        -> workspace.write
run_command       -> process.run
browser_*         -> browser.control
```

`workspace.control` remains accepted only as a compatibility alias for existing paired installations.

## Process execution

`run_command` invokes:

```text
child_process.spawn(executable, args, {
  cwd: workspaceContainedPath,
  shell: false,
  windowsHide: true
})
```

ChatX caps stdout/stderr and enforces a timeout. The process is not an OS sandbox: an explicitly launched executable can access resources permitted to the ChatX OS user.

## Browser execution

`BrowserController` uses `playwright-core` and a dedicated persistent profile. It discovers a supported Chromium browser from common OS locations, controls only that profile, and exposes text-oriented observation plus navigate/click/type actions.

The controller does not automatically attach to the user's normal Chrome/Edge profile.

## Transport abstraction

`TunnelProvider` no longer assumes every transport yields a public URL.

### Cloudflare

Cloudflare Quick and Named providers return a public HTTPS base URL. ChatX uses its own OAuth server and one-time pairing flow to authorize the remote client.

### OpenAI Secure MCP Tunnel

The OpenAI provider returns an opaque `tunnel_id`, not a public ChatX URL. It supervises the official `tunnel-client` managed runtime using asynchronous child-process calls and verifies runtime state using `runtimes status`.

Runtime API keys are referenced as `env:NAME`; ChatX does not persist the key. An optional HTTP(S) proxy may be injected into only the tunnel-client child process. This is required on systems where browser proxy settings do not apply to command-line programs.

### Local

Local mode uses only the loopback MCP endpoint for development/testing.

## State and compatibility

The external brand is ChatX, but `v0.1.0-alpha.1` intentionally preserves several legacy identifiers so existing users are not disconnected:

- default OS state directory remains `codex-with-chatgpt`
- `c2c` CLI alias remains installed
- legacy token prefixes remain unchanged
- existing saved connector titles are retained
- `C2C_*` environment variables remain fallbacks for new `CHATX_*` variables
- `.c2cignore` remains supported alongside `.chatxignore`

A future stable release can migrate these identifiers only with explicit, tested state migration.

## Release architecture

Source development and user installation are deliberately separated:

```text
source tree
  -> tsc build
  -> dist/
  -> npm pack allow-list
  -> clean temp install
  -> execute packaged CLI
  -> GitHub Release .tgz + SHA256SUMS.txt
```

CI runs Windows and Ubuntu on Node 20 and 22. Tagged release creation is blocked unless the package-install smoke passes.
