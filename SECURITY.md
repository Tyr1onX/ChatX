# Security Policy

ChatX can write workspace files, run local processes, and control a dedicated browser when those capabilities are authorized. Security reports are therefore treated as high priority.

## Supported versions

`v0.1.0-alpha.1` is the first public test line. Alpha builds receive security fixes on a best-effort basis until a stable support policy is published.

## Reporting a vulnerability

Prefer GitHub Private Vulnerability Reporting / Security Advisories for this repository when available. Do not post API keys, OAuth tokens, private keys, browser cookies, or working exploit details in a public issue.

If private reporting is unavailable, contact the maintainer through the GitHub repository/profile first and provide only enough public information to establish contact.

Useful report details include:

- affected ChatX version/commit
- OS and Node.js version
- transport (`cloudflare`, `openai`, or `local`)
- capability/scope involved
- minimal reproduction steps with secrets removed
- expected vs actual security boundary

See [docs/security.md](docs/security.md) for the threat model and known alpha limitations.
