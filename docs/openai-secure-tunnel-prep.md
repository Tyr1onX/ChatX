# OpenAI Secure MCP Tunnel integration

This branch contains an optional OpenAI Secure MCP Tunnel transport for ChatX. It is intentionally not the default and does not change the currently deployed Cloudflare path unless the user explicitly selects OpenAI mode and restarts/applies the bridge.

## Current status

Implemented and covered by automated tests:

- Cloudflare quick and named transports remain supported.
- OpenAI Secure MCP Tunnel can be selected per workspace.
- ChatX models private transports by `tunnel_id` instead of inventing a public URL.
- The official `tunnel-client runtimes connect/status/stop` lifecycle is wrapped as a ChatX tunnel provider.
- Runtime API keys are referenced by environment-variable name and are never written to ChatX tunnel state.
- `TUNNEL_CLIENT_BIN` can point to a specific `tunnel-client` executable without modifying global `PATH`.
- OpenAI mode keeps the MCP target on loopback and does not expose ChatX's local OAuth authorization route.
- Cloudflare mode keeps the existing ChatX OAuth and bearer-token flow unchanged.
- CLI start/setup/status/doctor understand both public URL transports and private tunnel-id transports.

Not performed by this branch:

- The currently running ChatX bridge is not restarted.
- The currently running `cloudflared` process is not stopped or reconfigured.
- No OpenAI tunnel is created or connected.
- No runtime API key is requested, stored, or printed.
- The default transport remains the existing Cloudflare behavior until the user explicitly chooses OpenAI mode.

## Runtime architecture

```text
ChatGPT
  -> OpenAI Secure MCP Tunnel
  -> tunnel-client managed runtime
  -> http://127.0.0.1:<port>/mcp
  -> ChatX
  -> workspace / process / browser capabilities
```

The provider starts an existing OpenAI tunnel with a command equivalent to:

```text
tunnel-client runtimes connect
  --alias <local-alias>
  --tunnel-id tunnel_<32-hex>
  --runtime-api-key env:CONTROL_PLANE_API_KEY
  --mcp-server-url http://127.0.0.1:<port>/mcp
  --json
```

ChatX then verifies the managed runtime through `runtimes status <alias> --json` and requires it to report both `process_running` and `ready` before declaring the transport connected.

## Authentication boundary

Cloudflare/public mode and OpenAI/private mode intentionally have different remote identity boundaries.

### Cloudflare

```text
ChatGPT -> public ChatX URL -> ChatX OAuth/bearer auth -> MCP
```

The existing pairing, OAuth scopes, and bearer middleware remain unchanged.

### OpenAI Secure MCP Tunnel

```text
ChatGPT -> OpenAI tunnel authorization -> tunnel-client -> loopback MCP
```

OpenAI tunnels forward MCP traffic to a private local target, but ChatX's localhost authorization server is not made publicly reachable by that tunnel. Therefore OpenAI mode does not mount the ChatX OAuth authorization surface and accepts MCP only on the loopback listener. Remote access is controlled by the OpenAI tunnel/workspace authorization boundary; ChatX still enforces its workspace path, sensitive-file, command, and browser policies.

This also means local processes running as the same user can reach the loopback MCP endpoint in OpenAI mode. If a stricter hostile-local-process threat model is required later, add a tunnel-target shared secret or another loopback authentication mechanism supported cleanly by the tunnel client.

## Configuration prepared for later activation

After `tunnel-client` is installed and an OpenAI tunnel has been created, ChatX can store the non-secret binding with:

```text
c2c tunnel choose --mode openai --tunnel-id tunnel_<32-hex>
```

Optional configuration:

```text
--alias <runtime-alias>
--runtime-key-env <environment-variable-name>
```

The default runtime-key environment variable is `CONTROL_PLANE_API_KEY`. A custom binary can be supplied with `TUNNEL_CLIENT_BIN`.

Do not put a literal runtime key in the repository, tunnel state, CLI arguments, or documentation.

## Latency benchmark plan

Do not infer the faster transport from topology alone. When both transports can be connected on the same machine and workspace, run at least 30 equivalent end-to-end MCP calls per path and compare:

- median latency
- p95 latency
- maximum latency/outliers
- first-call latency after idle
- reconnect/recovery latency

The benchmark must measure the full ChatGPT -> transport -> ChatX -> ChatGPT round trip. Localhost timing or ICMP ping alone is not representative.

A later benchmark-only read tool may return a nonce plus server receive/send monotonic timestamps, but it should not be added until both live transports are available for A/B testing.

## Real Windows smoke findings (2026-09-02)

A real Windows test against an OpenAI tunnel exposed two implementation details that are now handled by ChatX:

1. `tunnel-client runtimes connect` must never be invoked with a synchronous child-process API from inside the bridge. Doing so blocks the Node event loop and prevents tunnel-client from probing the loopback MCP endpoint, creating a readiness deadlock. ChatX now uses asynchronous child processes for connect/status/stop.
2. A Windows WinINET/browser proxy is not automatically sufficient for tunnel-client. On the tested machine, browsers used `127.0.0.1:7897` while WinHTTP and `HTTPS_PROXY` were unset, causing direct `api.openai.com:443` timeouts. ChatX therefore supports an optional per-OpenAI-transport HTTP(S) proxy that is injected only into tunnel-client, with localhost forced into `NO_PROXY`.

The real smoke reached `process_running=true`, `healthy=true`, `ready=true`, resolved the remote tunnel metadata, and completed a local Streamable HTTP MCP initialize request with HTTP 200. The existing Cloudflare transport remained untouched during this test.
