# Contributing to ChatX

ChatX is an alpha local-capability bridge. Changes that expand host authority, public exposure, credential handling, or browser control require tests and matching security documentation.

## Development

```bash
corepack pnpm install
corepack pnpm test
corepack pnpm typecheck
corepack pnpm build
corepack pnpm audit --prod
corepack pnpm release:smoke
```

## Security-sensitive changes

- Keep the MCP HTTP listener loopback-only.
- Keep remote MCP access behind ChatX OAuth bearer authorization.
- Never persist raw OAuth, Cloudflare, browser, or other long-lived credentials in the repository.
- Treat `process.run` as host-level code execution under the current OS user.
- Keep `workspace.write`, `process.run`, and `browser.control` independently scoped.
- Add regression coverage when changing path containment, sensitive-file rules, OAuth, Cloudflare connectivity, command execution, or browser control.
- Preserve upgrade compatibility unless a migration is explicitly documented.

## Pull requests

Describe what changed, the trust boundary affected, tests run, and any compatibility impact. Do not include real tokens, pairing codes, private URLs containing credentials, `.env` contents, or browser cookies in issues or pull requests.

For vulnerabilities, use the private reporting instructions in [SECURITY.md](SECURITY.md) instead of a public issue.
