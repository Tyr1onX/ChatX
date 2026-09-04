import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import type { Readable } from "node:stream";
import {
  ProcessSandboxError,
  type SandboxBackendAdapter,
  type SandboxBackendSpawnInput,
  type SandboxProcessExit,
  type SandboxedProcess,
} from "./sandbox-launcher.js";

const READY_PATTERN = /^READY ABI=(\d+)\n$/;
const DEFAULT_ESTABLISHMENT_TIMEOUT_MS = 5_000;
const DEFAULT_TERMINATION_GRACE_MS = 750;
const GROUP_POLL_MS = 25;

export interface LinuxSandboxBackendOptions {
  helperPath: string;
  runtimeReadOnlyPaths?: readonly string[];
  establishmentTimeoutMs?: number;
  terminationGraceMs?: number;
}

function requireAbsolutePath(name: string, value: string): void {
  if (!path.posix.isAbsolute(value) || value.includes("\0")) {
    throw new TypeError(`${name} must be an absolute Linux path.`);
  }
}

function helperArguments(
  input: SandboxBackendSpawnInput,
  runtimeReadOnlyPaths: readonly string[]
): string[] {
  requireAbsolutePath("command", input.command);
  requireAbsolutePath("cwd", input.cwd);
  requireAbsolutePath("workspaceRoot", input.workspaceRoot);
  requireAbsolutePath("private home", input.privateDirectories.home);
  requireAbsolutePath("private temp", input.privateDirectories.temp);

  const args = [
    "--ready-fd", "3",
    "--workspace", input.workspaceRoot,
    "--home", input.privateDirectories.home,
    "--temp", input.privateDirectories.temp,
  ];
  for (const runtimePath of runtimeReadOnlyPaths) {
    requireAbsolutePath("runtime read-only path", runtimePath);
    args.push("--ro", runtimePath);
  }
  args.push("--cwd", input.cwd, "--", input.command, ...input.args);
  return args;
}

function waitForExit(child: ChildProcess): Promise<SandboxProcessExit> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (exitCode, signal) => resolve({
      exitCode,
      signal: signal as NodeJS.Signals | null,
    }));
  });
}

function processGroupExists(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return false;
    if (code === "EPERM") return true;
    throw error;
  }
}

async function waitForProcessGroupGone(pgid: number, timeoutMs?: number): Promise<boolean> {
  const deadline = timeoutMs === undefined ? undefined : Date.now() + timeoutMs;
  while (processGroupExists(pgid)) {
    if (deadline !== undefined && Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, GROUP_POLL_MS));
  }
  return true;
}

function signalProcessGroup(pgid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pgid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

function readReadyHandshake(
  stream: Readable,
  exit: Promise<SandboxProcessExit>,
  timeoutMs: number
): Promise<number> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    let settled = false;
    let timer: NodeJS.Timeout;

    const cleanup = (): void => {
      clearTimeout(timer);
      stream.off("data", onData);
      stream.off("end", onEnd);
      stream.off("error", finishReject);
    };
    const finishResolve = (abi: number): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(abi);
    };
    const finishReject = (error: unknown): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const parse = (): void => {
      if (!buffer.endsWith("\n")) return;
      const match = READY_PATTERN.exec(buffer);
      if (!match) {
        finishReject(new ProcessSandboxError("Linux sandbox helper returned an invalid ready handshake."));
        return;
      }
      finishResolve(Number(match[1]));
    };
    const onData = (chunk: Buffer | string): void => {
      buffer += chunk.toString();
      if (buffer.length > 128) {
        finishReject(new ProcessSandboxError("Linux sandbox helper returned an oversized ready handshake."));
        return;
      }
      parse();
    };
    const onEnd = (): void => {
      parse();
      if (!settled) {
        finishReject(new ProcessSandboxError("Linux sandbox helper closed its ready pipe before establishing Landlock."));
      }
    };

    timer = setTimeout(() => finishReject(
      new ProcessSandboxError("Linux sandbox helper did not establish Landlock in time.")
    ), timeoutMs);
    stream.on("data", onData);
    stream.once("end", onEnd);
    stream.once("error", finishReject);
    void exit.then((result) => {
      if (!settled) {
        finishReject(new ProcessSandboxError(
          `Linux sandbox helper exited before the ready handshake (exit=${String(result.exitCode)}, signal=${String(result.signal)}).`
        ));
      }
    }, finishReject);
  });
}

export function createLinuxSandboxBackend(
  options: LinuxSandboxBackendOptions
): SandboxBackendAdapter {
  requireAbsolutePath("helperPath", options.helperPath);
  const runtimeReadOnlyPaths = [...(options.runtimeReadOnlyPaths ?? [])];
  const establishmentTimeoutMs =
    options.establishmentTimeoutMs ?? DEFAULT_ESTABLISHMENT_TIMEOUT_MS;
  const terminationGraceMs =
    options.terminationGraceMs ?? DEFAULT_TERMINATION_GRACE_MS;

  if (!Number.isSafeInteger(establishmentTimeoutMs) || establishmentTimeoutMs <= 0) {
    throw new TypeError("establishmentTimeoutMs must be a positive integer.");
  }
  if (!Number.isSafeInteger(terminationGraceMs) || terminationGraceMs < 0) {
    throw new TypeError("terminationGraceMs must be a non-negative integer.");
  }

  return {
    platform: "linux",

    async spawn(input): Promise<SandboxedProcess> {
      if (process.platform !== "linux") {
        throw new ProcessSandboxError("The Linux Landlock backend can only run on Linux.");
      }

      const child = spawn(options.helperPath, helperArguments(input, runtimeReadOnlyPaths), {
        cwd: "/",
        env: { ...input.environment },
        detached: true,
        stdio: ["pipe", "pipe", "pipe", "pipe"],
      });
      const exit = waitForExit(child);
      const pgid = child.pid;
      if (pgid === undefined) {
        child.kill("SIGKILL");
        void exit.catch(() => undefined);
        throw new ProcessSandboxError("Linux sandbox helper did not receive a process id.");
      }

      const ready = child.stdio[3];
      if (!ready || typeof (ready as Readable).on !== "function") {
        signalProcessGroup(pgid, "SIGKILL");
        await exit.catch(() => undefined);
        throw new ProcessSandboxError("Linux sandbox helper ready pipe was not created.");
      }

      try {
        await readReadyHandshake(ready as Readable, exit, establishmentTimeoutMs);
      } catch (error) {
        signalProcessGroup(pgid, "SIGKILL");
        await exit.catch(() => undefined);
        throw error;
      }

      const completion = exit.then(async (result) => {
        await waitForProcessGroupGone(pgid);
        return result;
      });

      let termination: Promise<void> | undefined;
      return {
        pid: pgid,
        stdin: child.stdin!,
        stdout: child.stdout!,
        stderr: child.stderr!,
        wait: () => completion,
        terminateTree: () => {
          termination ??= (async () => {
            signalProcessGroup(pgid, "SIGTERM");
            const stopped = await waitForProcessGroupGone(pgid, terminationGraceMs);
            if (!stopped) {
              signalProcessGroup(pgid, "SIGKILL");
              await waitForProcessGroupGone(pgid);
            }
            await exit.catch(() => undefined);
          })();
          return termination;
        },
      };
    },
  };
}