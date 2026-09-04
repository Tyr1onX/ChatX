import fs from "node:fs";
import path from "node:path";
import type { Readable, Writable } from "node:stream";
import {
  buildSandboxEnvironment,
  type SandboxEnvironment,
} from "./sandbox-environment.js";

export interface SandboxProcessExit {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

export interface SandboxedProcess {
  readonly pid: number;
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr: Readable;
  wait(): Promise<SandboxProcessExit>;
  terminateTree(): Promise<void>;
}

export interface SpawnSandboxedProcessInput {
  command: string;
  args?: readonly string[];
  cwd: string;
  workspaceRoot: string;
}

export interface SandboxPrivateDirectories {
  root: string;
  home: string;
  temp: string;
}

export interface SandboxBackendSpawnInput {
  command: string;
  args: readonly string[];
  cwd: string;
  workspaceRoot: string;
  environment: SandboxEnvironment;
  privateDirectories: SandboxPrivateDirectories;
}

/**
 * Internal adapter seam for the platform implementations.
 *
 * `spawn` must not resolve until the OS sandbox is established and the target
 * is contained by it. A rejected promise must mean that the target cannot run
 * outside the sandbox. `wait` and `terminateTree` cover the whole contained
 * process tree, not only its root process.
 */
export interface SandboxBackendAdapter {
  readonly platform: NodeJS.Platform;
  spawn(input: SandboxBackendSpawnInput): Promise<SandboxedProcess>;
}

export interface SandboxLauncher {
  spawn(input: SpawnSandboxedProcessInput): Promise<SandboxedProcess>;
}

export interface SandboxLauncherOptions {
  sandboxBaseDirectory: string;
  backend?: SandboxBackendAdapter;
  hostEnvironment?: Readonly<NodeJS.ProcessEnv>;
}

export class ProcessSandboxError extends Error {
  readonly code = "PROCESS_SANDBOX_UNAVAILABLE" as const;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ProcessSandboxError";
  }
}

async function createPrivateDirectories(baseDirectory: string): Promise<{
  base: string;
  directories: SandboxPrivateDirectories;
}> {
  if (!path.isAbsolute(baseDirectory) || baseDirectory.includes("\0")) {
    throw new TypeError("sandboxBaseDirectory must be an absolute directory path.");
  }

  await fs.promises.mkdir(baseDirectory, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") await fs.promises.chmod(baseDirectory, 0o700);
  const base = await fs.promises.realpath(baseDirectory);
  const root = await fs.promises.mkdtemp(path.join(base, "run-"));
  const home = path.join(root, "home");
  const temp = path.join(root, "temp");
  await Promise.all([
    fs.promises.mkdir(home, { mode: 0o700 }),
    fs.promises.mkdir(temp, { mode: 0o700 }),
  ]);
  if (process.platform !== "win32") {
    await Promise.all([
      fs.promises.chmod(root, 0o700),
      fs.promises.chmod(home, 0o700),
      fs.promises.chmod(temp, 0o700),
    ]);
  }
  return { base, directories: { root, home, temp } };
}

function isStrictDescendant(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

async function removePrivateDirectories(
  base: string,
  directories: SandboxPrivateDirectories
): Promise<void> {
  if (!isStrictDescendant(base, directories.root)) {
    throw new Error("Refusing to clean a sandbox directory outside its configured base.");
  }
  await fs.promises.rm(directories.root, { recursive: true, force: true });
}

function unavailable(message: string, cause: unknown): ProcessSandboxError {
  return cause instanceof ProcessSandboxError
    ? cause
    : new ProcessSandboxError(message, { cause });
}

/**
 * Create the single process-launch interface shared by future command and
 * managed-process callers. No platform adapter is selected implicitly.
 */
export function createSandboxLauncher(options: SandboxLauncherOptions): SandboxLauncher {
  return {
    async spawn(input: SpawnSandboxedProcessInput): Promise<SandboxedProcess> {
      const backend = options.backend;
      if (!backend) {
        throw new ProcessSandboxError("No process sandbox backend is available.");
      }

      let allocation: Awaited<ReturnType<typeof createPrivateDirectories>> | undefined;
      try {
        allocation = await createPrivateDirectories(options.sandboxBaseDirectory);
        const environment = buildSandboxEnvironment({
          privateHome: allocation.directories.home,
          privateTemp: allocation.directories.temp,
          hostEnvironment: options.hostEnvironment,
          platform: backend.platform,
        });
        const backendProcess = await backend.spawn({
          command: input.command,
          args: [...(input.args ?? [])],
          cwd: input.cwd,
          workspaceRoot: input.workspaceRoot,
          environment,
          privateDirectories: allocation.directories,
        });

        let cleanupPromise: Promise<void> | undefined;
        const cleanup = (): Promise<void> => {
          cleanupPromise ??= removePrivateDirectories(allocation!.base, allocation!.directories);
          return cleanupPromise;
        };
        const completion = backendProcess.wait().then(
          async (result) => {
            await cleanup();
            return result;
          },
          async (error: unknown) => {
            await cleanup();
            throw error;
          }
        );
        // Lifecycle cleanup must not depend on the caller remembering to wait.
        void completion.catch(() => undefined);

        let termination: Promise<void> | undefined;
        return {
          pid: backendProcess.pid,
          stdin: backendProcess.stdin,
          stdout: backendProcess.stdout,
          stderr: backendProcess.stderr,
          wait: () => completion,
          terminateTree: () => {
            termination ??= (async () => {
              await backendProcess.terminateTree();
              await completion;
            })();
            return termination;
          },
        };
      } catch (error) {
        if (allocation) {
          try {
            await removePrivateDirectories(allocation.base, allocation.directories);
          } catch (cleanupError) {
            throw unavailable("The process sandbox failed to start and its private directory could not be cleaned.", new AggregateError([error, cleanupError]));
          }
        }
        throw unavailable("The process sandbox could not be established.", error);
      }
    },
  };
}
