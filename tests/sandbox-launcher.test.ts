import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  createSandboxLauncher,
  ProcessSandboxError,
  type SandboxBackendAdapter,
  type SandboxBackendSpawnInput,
  type SandboxProcessExit,
  type SandboxedProcess,
} from "../src/process/sandbox-launcher.js";

function makeDisposableRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "chatx-sandbox-launcher-"));
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

class ControlledBackend implements SandboxBackendAdapter {
  readonly platform: NodeJS.Platform = process.platform;
  readonly requested = deferred<void>();
  readonly established = deferred<void>();
  readonly exited = deferred<SandboxProcessExit>();
  request: SandboxBackendSpawnInput | undefined;
  terminateCalls = 0;

  async spawn(input: SandboxBackendSpawnInput): Promise<SandboxedProcess> {
    this.request = input;
    this.requested.resolve();
    await this.established.promise;
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    return {
      pid: 42,
      stdin,
      stdout,
      stderr,
      wait: () => this.exited.promise,
      terminateTree: async () => {
        this.terminateCalls += 1;
        this.exited.resolve({ exitCode: null, signal: "SIGTERM" });
      },
    };
  }
}

describe("createSandboxLauncher", () => {
  it("fails closed when no backend is configured", async () => {
    const root = makeDisposableRoot();
    try {
      const sandboxBaseDirectory = path.join(root, "sandboxes");
      const launcher = createSandboxLauncher({ sandboxBaseDirectory });

      await expect(launcher.spawn({
        command: "never-run",
        cwd: root,
        workspaceRoot: root,
      })).rejects.toMatchObject({
        name: "ProcessSandboxError",
        code: "PROCESS_SANDBOX_UNAVAILABLE",
      });
      expect(fs.existsSync(sandboxBaseDirectory)).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("waits for the backend handshake and passes private policy inputs", async () => {
    const root = makeDisposableRoot();
    try {
      const backend = new ControlledBackend();
      const launcher = createSandboxLauncher({
        sandboxBaseDirectory: path.join(root, "sandboxes"),
        backend,
        hostEnvironment: {
          PATH: "tool-path",
          CHATX_SANDBOX_TEST_SECRET: "super-secret",
        },
      });
      let returned = false;
      const spawning = launcher.spawn({
        command: "prepared-command",
        args: ["one", "two"],
        cwd: root,
        workspaceRoot: root,
      }).then((process) => {
        returned = true;
        return process;
      });

      await backend.requested.promise;
      expect(returned).toBe(false);
      expect(backend.request).toBeDefined();
      expect(fs.existsSync(backend.request!.privateDirectories.home)).toBe(true);
      expect(fs.existsSync(backend.request!.privateDirectories.temp)).toBe(true);
      expect(backend.request!.environment.PATH).toBe("tool-path");
      expect(backend.request!.environment.CHATX_SANDBOX_TEST_SECRET).toBeUndefined();
      expect(backend.request!.environment.HOME).toBe(backend.request!.privateDirectories.home);
      expect(backend.request!.environment.TMPDIR).toBe(backend.request!.privateDirectories.temp);

      backend.established.resolve();
      const process = await spawning;
      expect(process.pid).toBe(42);
      expect(returned).toBe(true);

      const runRoot = backend.request!.privateDirectories.root;
      backend.exited.resolve({ exitCode: 0, signal: null });
      await expect(process.wait()).resolves.toEqual({ exitCode: 0, signal: null });
      expect(fs.existsSync(runRoot)).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("cleans private directories when sandbox establishment fails", async () => {
    const root = makeDisposableRoot();
    let request: SandboxBackendSpawnInput | undefined;
    const backend: SandboxBackendAdapter = {
      platform: process.platform,
      async spawn(input) {
        request = input;
        throw new Error("handshake failed");
      },
    };
    try {
      const launcher = createSandboxLauncher({
        sandboxBaseDirectory: path.join(root, "sandboxes"),
        backend,
        hostEnvironment: {},
      });

      await expect(launcher.spawn({
        command: "never-run",
        cwd: root,
        workspaceRoot: root,
      })).rejects.toBeInstanceOf(ProcessSandboxError);
      expect(request).toBeDefined();
      expect(fs.existsSync(request!.privateDirectories.root)).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("terminates the contained tree once and cleans after exit", async () => {
    const root = makeDisposableRoot();
    try {
      const backend = new ControlledBackend();
      const launcher = createSandboxLauncher({
        sandboxBaseDirectory: path.join(root, "sandboxes"),
        backend,
        hostEnvironment: {},
      });
      const spawning = launcher.spawn({
        command: "prepared-command",
        cwd: root,
        workspaceRoot: root,
      });
      backend.established.resolve();
      const process = await spawning;
      const runRoot = backend.request!.privateDirectories.root;

      await Promise.all([process.terminateTree(), process.terminateTree()]);
      expect(backend.terminateCalls).toBe(1);
      expect(fs.existsSync(runRoot)).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
