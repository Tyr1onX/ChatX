# Workspace glob contract

ChatX owns the glob semantics used by `search_workspace` and `find_files`. Results must not depend on whether ripgrep is installed or on the ripgrep version present on the host.

## Supported syntax

- `*` — zero or more non-`/` characters
- `**` — zero or more characters, including `/`
- `**/` — zero or more directory levels
- `?` — exactly one non-`/` character
- `{a,b}` — non-nested alternatives

Multiple non-nested brace groups are allowed, but expansion is capped at 32 alternatives. Glob input is capped at 512 characters. Backslashes are normalized to `/` so the contract is identical across Windows, macOS and Linux.

Examples:

```text
*.ts
src/**/*.tsx
**/*.{ts,tsx}
src/file?.{js,mjs}
```

## Deliberately unsupported

Character classes such as `[abc]` or `[!a]`, nested brace alternatives, empty brace alternatives and malformed braces are rejected instead of being interpreted differently by different search engines.

Characters that are special only to ripgrep are not special to ChatX. For example, `!special.ts` matches a file literally named `!special.ts`; it is not a ripgrep exclusion rule.

## Engine rule

The ChatX matcher is authoritative. ripgrep may accelerate content discovery, but user glob syntax is not delegated to ripgrep for interpretation. The Node fallback and ripgrep path therefore use the same filename matcher and the same Workspace ignore/sensitive-file policy.
