# OpenAI Secure MCP Tunnel preparation

This branch prepares ChatX for an additional private transport without changing the currently deployed Cloudflare path.

## Non-goals for this preparation branch

- Do not restart the running ChatX bridge.
- Do not stop or reconfigure `cloudflared`.
- Do not require an OpenAI runtime API key yet.
- Do not change the default transport.

## Why the current abstraction needs one more layer

The existing `TunnelProvider` assumes every remote connection produces a public URL. Cloudflare satisfies that model. OpenAI Secure MCP Tunnel does not: ChatGPT selects an opaque `tunnel_id`, while `tunnel-client` reaches the local MCP server over loopback.

The neutral `TransportDescriptor` introduced in this branch can represent all three cases:

- `cloudflare`: public HTTPS MCP URL.
- `openai`: private OpenAI tunnel id, no public ChatX URL.
- `local`: loopback-only development.

The next implementation step is to migrate bridge/CLI status from `publicUrl` as the source of truth to a transport descriptor while keeping the legacy Cloudflare behavior unchanged.

## Planned OpenAI transport

Future runtime shape:

```text
ChatGPT -> OpenAI Secure MCP Tunnel -> tunnel-client -> http://127.0.0.1:<port>/mcp -> ChatX
```

`tunnel-client` should be treated as a supervised sidecar. ChatX must never persist or print the runtime API key. The key should enter through the environment or the official tunnel-client profile/secret mechanism.

## Latency benchmark plan

Do not infer the faster transport from topology alone. Measure end-to-end MCP calls from ChatGPT for both transports using the same machine and workspace. Record at least 30 calls per path and compare median, p95, and reconnect behavior.

Suggested low-cost probe: a read-only `transport_probe` MCP tool that returns server receive/send monotonic timestamps and a nonce. Add it only when both transports are ready to test.
