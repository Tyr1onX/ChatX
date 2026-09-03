# Workspace regex contract

`search_workspace` has two content-query modes with deliberately different execution rules.

## Literal search

Literal search is the default (`regex` omitted or `false`). ChatX may use ripgrep for acceleration and falls back to the Node search engine when ripgrep is unavailable or fails. Existing smart-case behavior is preserved.

## Regex search

Regex search (`regex: true`) uses one ChatX-owned semantic everywhere: JavaScript `RegExp` as provided by the supported Node runtime.

ChatX does not delegate user regex syntax to ripgrep. Rust regex and JavaScript `RegExp` are different languages, so delegating regex parsing to ripgrep would make accepted syntax and results depend on whether ripgrep is installed on the host.

The regex contract is therefore:

- the `query` value is a JavaScript `RegExp` source string
- no caller-supplied flags are accepted separately
- smart-case is automatic: a query containing uppercase characters is case-sensitive; otherwise ChatX adds the `i` flag
- matching is line-by-line, not multiline across the whole file
- `^` and `$` refer to the start and end of each logical line
- both LF and CRLF files are split into the same logical lines before matching
- JavaScript constructs such as lookahead and backreferences follow the supported Node runtime's `RegExp` behavior
- invalid JavaScript regex source is rejected by the `RegExp` constructor
- regex search reports `engine: "node"` even when ripgrep is installed

The existing Workspace path containment, sensitive-file policy, custom-ignore policy, file-size cap, result limit, context budget and binary-file checks continue to apply.

This single-engine choice is intentional. Regex mode gives up ripgrep acceleration in exchange for deterministic syntax and behavior across Windows, macOS and Linux. Literal search remains the optimized path for normal Workspace search.
