# ChatX Architecture

## Overview

ChatX is a local capability bridge. ChatGPT sends structured MCP calls; a loopback-only Node.js process performs the actual local work and returns structured results.

```text
                    ChatGPT
                       |
              Server URL + OAuth
                       |
            Cloudflare Quick/Named
                public HTTPS
                       |
                127.0.0.1:<port>
                       |
                    ChatX
      +----------------+----------------+
      |                |                |
 Workspace/Git     Process runner   Browser controller
 read/search/write child_process    Playwright profile
      |                |                |
      +----------------+----------------+
                       |
                     Host OS
```

There is one supported remote connection model: Cloudflare provides HTTPS reachability, while ChatX OAuth authorizes access to `/mcp`.

## Core modules

| Area | Responsibility |
| --- | --- |
| `src/bridge/` | Express loopback server, runtime state, admin API, Cloudflare lifecycle |
| `src/mcp/` | MCP Streamable HTTP endpoint and tool registration |
| `src/auth/` | OAuth 2.1, PKCE, pairing, token storage |
| `src/workspace/` | Workspace identity, path containment, sensitive-file rules, search and Git |
| `src/tunnel/` | Cloudflare Quick/Named connection providers |
| `src/browser/` | Dedicated Playwright browser controller |
| `src/process/` | Background bridge lifecycle |
| `src/execution/` | Execution summaries used for review/status workflows |
| `src/cli/` | `chatx` CLI (`c2c` compatibility alias) |

## Local server

The bridge refuses non-loopback bind addresses. Its local HTTP surface includes:

- `/mcp` — Streamable HTTP MCP endpoint, always bearer-protected
- `/health` — minimal health response
- OAuth discovery/authorization/token endpoints
- `/admin/*` — loopback + random admin-token protected CLI control surface

The bridge is one-workspace-per-instance. Workspace IDs are stable hashes derived by the workspace manager and are used to separate token/state records.

## Connection lifecycle

A workspace chooses one Cloudflare mode:

- **Quick** — no account/domain required; public URL may change after restart.
- **Named** — stable hostname under the user's Cloudflare-managed domain.

Both providers implement the same small contract: start the connection for a local port and return one public HTTPS base URL. The rest of ChatX never needs a second remote identity model or a transport-specific opaque ID.

ChatGPT setup then follows one path:

```text
Plugins
→ New plugin
→ Server URL
→ <ChatX public /mcp URL>
→ OAuth
→ pairing / authorization
```

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

## State and compatibility

The external brand is ChatX, but the current alpha line intentionally preserves several identifiers so existing working installations are not disconnected:

- default OS state directory remains `codex-with-chatgpt`
- `c2c` CLI alias remains installed
- legacy token prefixes remain unchanged
- existing saved connector titles are retained
- `C2C_*` environment variables remain fallbacks for new `CHATX_*` variables
- `.c2cignore` remains supported alongside `.chatxignore`

These are compatibility details, not parallel product paths. A future migration should remove them only with an explicit, tested state migration.

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

The release gate runs tests, typecheck, build, dependency audit, and packaged-install smoke before a tagged release is published.
