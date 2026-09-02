# Release Checklist

For `v0.1.0-alpha.1` and later tagged releases:

1. `git fetch origin --tags`; confirm release branch is based on current `origin/main` and worktree is clean.
2. `corepack pnpm install --frozen-lockfile`.
3. `corepack pnpm test`.
4. `corepack pnpm typecheck`.
5. `corepack pnpm build`.
6. `corepack pnpm audit --prod`.
7. `corepack pnpm release:smoke` — must pack, install into a clean temp directory, and execute the packaged CLI.
8. `git diff --check`.
9. Run the repository secret-pattern scan; do not print matched secret contents.
10. Confirm README, security docs and version constants match the tag.
11. Verify Cloudflare automated regression remains green. OpenAI Tunnel is experimental unless a real ChatGPT-side Tunnel connector smoke has been completed for the release.
12. Merge the release branch into `main` without rewriting history.
13. Tag the exact release commit, e.g. `v0.1.0-alpha.1`, and push the tag.
14. GitHub Actions `Release` must publish `.tgz` and `SHA256SUMS.txt` successfully.

Do not tag a release if the clean package install smoke fails even when source-tree tests pass.
