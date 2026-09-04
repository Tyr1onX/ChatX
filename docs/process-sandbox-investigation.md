# Process sandbox investigation

Date: 2026-09-04  
Investigated revision: `main` / `origin/main` / `HEAD` at `eeeee0a5acdf7eb639d872548cb6a1c90e79f2cc`

This is a design investigation, not an implementation. It intentionally does not
add an unsafe compatibility path or claim a platform is supported before a real
parent/child/grandchild isolation test passes on that platform.

## Root cause

`run_command` and `process_start` validate their requested working directory with
`Workspace.resolve()`, but both eventually call Node's `spawn()` with the ChatX
user's token and with no explicit environment. The child therefore inherits the
host user's filesystem authority and environment, and its descendants inherit
that same authority. `Workspace.resolve()` is a correct parameter-level cwd
boundary; it is not and cannot be the runtime filesystem boundary.

The two paths also do not share a lifecycle primitive capable of killing an
entire process tree. `child.kill()` targets the immediate child, so timeout,
`process_stop`, and bridge shutdown are not sufficient descendant cleanup.

## Current call chain

Bridge construction:

```text
CLI / daemon
  -> startBridge(...)
  -> new Workspace(workspaceRoot)
  -> new ProcessSessionManager(workspace)
  -> createMcpServer(...)
```

One-shot command:

```text
MCP run_command
  -> process.run scope check
  -> Workspace.resolve(cwd)
  -> prepareSpawnCommand(command, args)
  -> Node spawn(..., { cwd, shell: false, windowsHide: true })
  -> direct-child timeout / output collection
```

Managed command:

```text
MCP process_start
  -> process.run scope check
  -> ProcessSessionManager.start(...)
  -> Workspace.resolve(cwd)
  -> prepareSpawnCommand(command, args)
  -> Node spawn(..., { cwd, shell: false, windowsHide: true, stdio: pipe })
  -> session buffer / process_read / process_write / direct-child process_stop
```

`prepareSpawnCommand()` is needed independently of sandboxing: on Windows it
resolves executables and intentionally maps `.cmd`/`.bat` shims through
`cmd.exe`. The sandbox launcher should consume its structured result rather than
replace this logic.

## Runtime and CI facts

- `package.json` supports Node `>=20` and pins pnpm `10.17.1`.
- CI covers Node 20 and 22 on `ubuntu-latest`, `windows-latest`, and
  `macos-latest`.
- The investigation host is Windows x64, OS build 22631 (Windows 11 23H2),
  running Node `v24.15.0`.
- Existing process tests exercise command behavior and Windows command shims,
  but none establishes a real OS filesystem boundary or descendant boundary.
- The release workflow currently runs only on Ubuntu/Node 22, so packaging a
  native helper requires a cross-platform build/sign/package verification path.

## OS capability findings

### Linux

[Landlock](https://www.kernel.org/doc/html/latest/userspace-api/landlock.html)
is an unprivileged, kernel-enforced, deny-by-default filesystem restriction that
is inherited by subsequently created children and cannot be removed after
`landlock_restrict_self()`. Combined with
[`no_new_privs`](https://www.kernel.org/doc/html/latest/userspace-api/no_new_privs.html),
it is a strong fit for a very small launcher helper. The helper must close every
inherited descriptor except its explicit stdio/control descriptors because an
already-open file descriptor can bypass pathname mediation.

Landlock alone is not a process-tree supervisor. A PID namespace can provide a
tree-wide lifetime boundary because the kernel kills the namespace's remaining
processes when its init process exits; see
[`pid_namespaces(7)`](https://man7.org/linux/man-pages/man7/pid_namespaces.7.html).
This depends on usable unprivileged namespaces on the actual runner. If either
the required Landlock ABI or namespace setup is unavailable, launch must fail
closed.

[`bubblewrap`](https://github.com/containers/bubblewrap) can compose mount and
PID namespaces, but it is not currently a ChatX dependency and is not uniformly
installed. Its security is entirely determined by the supplied bind mounts and
namespace flags. Depending on a host-installed binary would make support
non-deterministic; bundling it is a separate distribution and maintenance
decision. A minimal native Landlock/namespace helper is the smaller Linux
candidate, subject to a real CI proof.

### Windows

No single Windows primitive investigated satisfies all three required
properties by itself:

- [`CreateRestrictedToken`](https://learn.microsoft.com/windows/win32/api/securitybaseapi/nf-securitybaseapi-createrestrictedtoken)
  reduces a token and supports an additional restricting-SID access check, but
  correct filesystem behavior still depends on ACL design.
- [Job Objects](https://learn.microsoft.com/windows/win32/procthread/job-objects)
  provide default descendant membership and reliable tree termination when
  breakaway is prohibited, but they do not restrict filesystem access.
- [AppContainer](https://learn.microsoft.com/windows/win32/secauthz/appcontainer-isolation)
  is a recognized security boundary with default file/process/network
  isolation, but admitting an arbitrary workspace requires ACL/capability work;
  its network isolation also conflicts with the required localhost dev-server
  case unless that behavior is explicitly solved.
- [`CreateProcessInSandbox`](https://learn.microsoft.com/windows/win32/secauthz/createprocessinsandbox)
  exposes path allowlists, but Microsoft marks it experimental and subject to
  change. It is exported by `processmodel.dll`, which is absent on the
  investigation host (Windows 11 23H2).

A disposable native probe combined a restricted token, a restricting SID,
explicit ACLs on disposable workspace/temp directories, a clean environment,
and a Job Object. The parent passed workspace read, outside-secret denial,
junction-escape denial, environment denial, and private-temp write checks.
However, spawning the child failed with `ERROR_ACCESS_DENIED`; therefore this is
not a validated descendant solution and must not be presented as one. No ChatX
file or real user directory ACL was changed by the probe.

Microsoft's current
[`microsoft/mxc`](https://github.com/microsoft/mxc) project was also evaluated.
It is an early preview, has a Windows 11 24H2 minimum in its support table, and
its own security notice says its profiles must not currently be treated as
security boundaries. It is not an acceptable production dependency for this
requirement.

Conclusion: Windows is an unresolved implementation blocker on the current
supported OS range. The next safe step is a focused native proof that validates
workspace allow, host deny, junction denial, descendant inheritance, localhost
development, stdio, and Job Object cleanup on every supported Windows version.
Product integration must not start from the partially successful probe.

### macOS

Apple's supported public security model is the signed
[App Sandbox](https://developer.apple.com/documentation/security/app-sandbox)
with entitlements and security-scoped resources. Embedded helpers must be signed
and configured for sandbox inheritance; inherited rights are the parent's static
rights, not an arbitrary per-invocation workspace grant. Apple's temporary
absolute-path entitlement exceptions are static signing-time exceptions, not a
maintainable dynamic workspace policy.

The historically convenient Seatbelt interfaces (`sandbox-exec` /
`sandbox_init`) are deprecated, and Apple states the profile language is not a
supported API; see the
[Apple Developer Forums guidance](https://developer.apple.com/forums/thread/661939).
Using those interfaces would be a fragile implementation rather than the
requested official, maintainable solution.

Conclusion: the current npm/CLI architecture has no verified public Apple API
that provides a dynamic per-command workspace allowlist while directly running
arbitrary developer tools. Moving ChatX itself into a signed App Sandbox would
be a packaging and broker architecture change, and still requires proving how
the selected workspace authority reaches arbitrary descendant tools. macOS is
therefore also an unresolved blocker; deprecated Seatbelt must not be silently
adopted as the answer.

## Minimal architecture (once every platform backend is proven)

```text
run_command ---------+
                     +--> sandbox process launcher --> OS backend
process_start -------+
```

Keep both existing pre-launch responsibilities:

1. `Workspace.resolve()` validates the requested cwd and catches parameter-level
   traversal/symlink escapes.
2. `prepareSpawnCommand()` resolves the actual executable/arguments, including
   Windows package-manager shims.

Then call one shared launcher. A useful narrow interface is:

```ts
interface SandboxedProcess {
  readonly pid: number | null;
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr: Readable;
  wait(): Promise<{ exitCode: number | null; signal: string | null }>;
  terminateTree(): Promise<void>;
}

spawnSandboxedProcess({
  workspaceRoot,
  cwd,
  command,
  args,
}): Promise<SandboxedProcess>
```

The launcher owns only the security boundary, sanitized environment, private
run directories, sandbox-establishment handshake, and whole-tree lifecycle.
`run_command` retains timeout/output formatting; `ProcessSessionManager`
retains session IDs, buffering, reads, writes, and retention. There is no
long-lived unsandboxed execution branch.

A native helper is justified if it stays small: install the OS policy, arrange
stdio/control handles, report that the sandbox is active, and `exec`/resume the
already prepared command. It must contain no MCP authorization, cwd validation,
command parsing, session buffering, or alternate business logic.

## Required policy

### Filesystem

- Read/write: the canonical authorized workspace tree.
- Read/write: one owner-only per-process ChatX sandbox directory containing a
  private home and temp directory.
- Read/execute: only the enumerated system loader, libraries, shells, and runtime
  roots required for the already resolved executable.
- Default deny: user home, other projects, SSH/cloud/browser data, the rest of
  ChatX state, and every non-admitted host path.
- Kernel/object enforcement must follow the final target, so a symlink or
  Windows junction from the workspace to an outside secret remains denied.

### Environment, temp, and home

- Build the child environment from an allowlist; never spread `process.env`.
- Set `HOME`, `USERPROFILE`, `APPDATA`, and `LOCALAPPDATA` to the private home as
  applicable; set `TMP`, `TEMP`, and `TMPDIR` to the private temp directory.
- Construct `PATH` only from admitted tool/runtime roots. Include the minimum
  platform variables required to start the process (for example Windows system
  root and executable suffix metadata), but omit credentials and injection
  variables by default.
- In particular, omit `SSH_AUTH_SOCK`, cloud credentials, tokens, cookies,
  `NODE_OPTIONS`, `LD_*`, `DYLD_*`, and arbitrary `CHATX_*` variables. The test
  secret must be absent from parent, child, and grandchild.

### Executable and runtime dependencies

- Resolve the executable on the host before applying the sandbox and canonicalize
  it to an absolute path.
- Admit that executable plus a documented, platform-specific minimum runtime
  closure. Do not mount/read the entire user profile to make package managers
  convenient.
- Package-manager caches/config live in the private home/temp unless they are in
  the workspace. Normal project-local tools and shims remain supported.
- Preserve current network behavior only after the backend proves that localhost
  development still works; do not use filesystem isolation as a reason to grant
  broad host filesystem access.

### Descendants and handles

- The kernel boundary must be inherited by child and grandchild processes and
  must not be removable by them.
- No breakaway from the Windows Job Object; no escape from the Linux policy/PID
  namespace; the macOS design must prove equivalent inheritance before support.
- Inherit/transfer only stdin, stdout, stderr, and the minimal establishment
  control handle. Close every other descriptor/handle.

### Stdio, stop, cleanup, and failure

- Preserve the current three-pipe non-PTY contract and existing output caps.
- Timeout, `process_stop`, bridge shutdown, and launcher failure call
  `terminateTree()`, wait for the whole boundary to be empty, then remove the
  private run directory.
- Use a bounded graceful stop only where it cannot permit escape, followed by a
  hard whole-tree termination.
- Establish the boundary before the target can execute. A helper/control
  handshake must positively confirm installation; EOF, missing helper,
  unsupported kernel/OS, ACL failure, namespace failure, or policy compilation
  failure returns `PROCESS_SANDBOX_UNAVAILABLE` (or an equivalent typed error).
  The target must never run, and there is no fallback to ordinary `spawn()`.

## Expected implementation surface

Do not begin these edits until the Windows and macOS blockers above have a
proven answer:

- New shared launcher, likely `src/process/sandbox-launcher.ts`.
- A small native helper source/package and build scripts, only if the platform
  proofs establish this route.
- `src/mcp/server.ts`: replace the direct one-shot spawn with the launcher.
- `src/process/session-manager.ts`: use the launcher and `terminateTree()`; add a
  sandbox-unavailable error mapping.
- `src/bridge/server.ts`: construct/inject one launcher if lifecycle ownership
  requires it.
- Keep `src/process/spawn-command.ts` behavior; only adjust its interface/tests
  if absolute executable resolution must be exposed.
- Add real sandbox integration tests and update existing process/MCP tests.
- Update `docs/security.md` and `docs/architecture.md` only after behavior is
  implemented and verified.
- Update `package.json`, release packaging, and CI workflows for helper builds
  and per-OS execution tests.

## Acceptance test plan

Every supported OS runs the same black-box fixture against a real released-style
helper/binary, not mocked spawn arguments:

1. Parent, child, and grandchild can read/write workspace files.
2. Parent, child, and grandchild cannot read an outside test secret.
3. A workspace symlink/junction targeting that secret cannot be read.
4. `CHATX_SANDBOX_TEST_SECRET=super-secret` set on ChatX is absent at all three
   descendant levels.
5. The private temp/home is writable and readable; the real host temp/home is
   not.
6. `process_start` runs a real long-lived watcher/dev server, `process_read`
   observes it, and `process_stop` removes the entire process tree and closes
   the listening port.
7. `run_command` executes representative package install/test/build commands,
   including Windows `.cmd`/`.bat` and pnpm shim coverage.
8. Windows, macOS, and Linux jobs all run the real isolation checks. A runner
   that cannot provide the backend is a failed support claim, not a skipped
   test; use suitable dedicated runners if hosted runners are insufficient.
9. Missing/corrupt helper, unsupported OS/kernel, and deliberate policy setup
   failures return `PROCESS_SANDBOX_UNAVAILABLE`; a sentinel proves that the
   target never executed.
10. Additional regression cases cover stdin, stdout/stderr separation, output
    limits, one-shot timeout tree kill, bridge-close tree kill, crash cleanup,
    no handle leakage, and symlink/junction race resistance.

## Risks and blockers

- **Windows:** the restricted-token/ACL/Job proof is incomplete because the
  child could not start; AppContainer also creates a localhost-development
  conflict; the newer path-allowlist API is experimental and unavailable on the
  current supported host.
- **macOS:** Apple's supported App Sandbox is a signed-application model with
  static/inherited rights, while the dynamic Seatbelt API suitable for this CLI
  shape is deprecated and unsupported.
- **Linux:** a viable small-helper direction exists, but kernel ABI and
  unprivileged namespace availability must be tested on the minimum supported
  environments and CI runners.
- Runtime closure is platform- and tool-dependent. Over-broad system or user
  mounts would defeat the goal; an under-specified closure would break ordinary
  build tools.
- Native helper distribution adds architecture builds, signing/notarization,
  supply-chain verification, and release-smoke responsibilities.
- Filesystem isolation does not automatically define network, GUI, device,
  registry, IPC, or resource-limit policy. Those must remain explicitly scoped
  and must not be accidentally widened to make one test pass.

Because two supported platforms still lack a proven maintainable backend, the
correct phase-one outcome is to stop before product code changes rather than
ship a partial or fallback sandbox.

## 2026-09-04 backend follow-up

### Windows route status

- `CreateRestrictedToken` direct launch is **NOT SELECTED** for ChatX arbitrary
  unmodified executables. The API can create the restricted target, but the
  tested ordinary Node runtime could not complete Windows subsystem
  initialization without widening the host model.
- Standard Win32 AppContainer direct launch is **REJECTED** for the same ChatX
  requirement. `CreateProcessW` created a real AppContainer token with the
  expected AppContainer SID, but ordinary unmodified Node exited during early
  process initialization before JavaScript ran.
- Windows Sandbox is rejected as the daily process backend; a dedicated Hyper-V
  VM is technically viable but too heavy. Hyper-V-isolated Windows containers
  remain the preferred eventual native-Windows architecture, but the current
  Windows Home 23H2 host cannot support that backend without OS/setup changes.
- None of these Windows findings are wired into `run_command` or
  `process_start` on this branch.

### Linux Landlock follow-up

- The current WSL2 kernel is `6.18.33.2-microsoft-standard-WSL2` and reports
  Landlock ABI **7**. The distro has `/usr/bin/cc`, no Linux Node, and `/mnt/c`
  is mounted.
- Added a small native helper source at
  `src/process/native/sandbox-linux-helper.c`. It requires Landlock ABI 5+,
  handles the filesystem rights available through ABI 5, sets
  `PR_SET_NO_NEW_PRIVS`, installs workspace/private-home/private-temp RW rules,
  installs only explicitly supplied runtime RO/RX rules plus the exact target
  executable, closes unintended inherited descriptors, writes a ready
  handshake on fd 3 after enforcement, and then `execve()`s the target.
- The helper compiles on the current WSL distro as a static x86-64 ELF with
  `cc -O2 -Wall -Wextra -Werror -static`; the observed test build is about
  909 KiB. No package installation was required.
- Added `src/process/sandbox-linux.ts` as an unconnected `SandboxBackendAdapter`.
  It starts the helper in a detached Linux process group, passes the existing
  clean environment unchanged, waits for the fd-3 Landlock-ready handshake,
  and implements process-group termination. This adapter is intentionally not
  selected by any product entry point.
- Added Windows-side unit coverage proving the adapter declares Linux, validates
  its helper path, and fails closed before spawning when invoked on a non-Linux
  host.
- The real black-box Landlock fixture execution was blocked by the local command
  safety layer before the helper target ran. It was not retried through an
  equivalent wrapper or obfuscated path. Consequently filesystem deny,
  `/mnt/c` deny, descendant inheritance, symlink escape, environment checks,
  and process-group tree termination remain **NOT PROVEN** in this session.
- For runtime closure only, `ldd` on this Ubuntu reports `/bin/true` and
  `/usr/bin/env` needing `libc.so.6` under `/lib/x86_64-linux-gnu` and
  `/lib64/ld-linux-x86-64.so.2`. This is dependency evidence, not permission to
  allow all of `/usr` or proof that the dynamic runtime works under Landlock.
- Process groups are the current minimal cleanup mechanism only. A descendant
  can theoretically create a new session/process group, so whole-tree cleanup
  must not be called proven until the black-box tree test succeeds and the
  escape case is resolved (potentially with a stronger containment primitive).
