import { describe, expect, it } from "vitest";
import { Workspace } from "../src/workspace/manager.js";
import { ProcessSessionManager } from "../src/process/session-manager.js";
import { cleanup, makeTmpDir } from "./helpers.js";

async function waitFor(
  check: () => boolean,
  timeoutMs = 2_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for process state");
}

describe("ProcessSessionManager", () => {
  it("keeps a process alive across read/write calls and tracks incremental output", async () => {
    const root = makeTmpDir("process-session");
    const manager = new ProcessSessionManager(new Workspace(root));
    try {
      const script = [
        "process.stdout.write('ready\\n')",
        "process.stdin.setEncoding('utf8')",
        "process.stdin.on('data', (data) => { process.stdout.write('echo:' + data); })",
        "setInterval(() => {}, 1000)",
      ].join(";");

      const started = await manager.start({
        command: process.execPath,
        args: ["-e", script],
      });
      expect(started.status).toBe("running");
      expect(started.pid).toBeTypeOf("number");

      await waitFor(() => manager.read(started.id).stdout.text.includes("ready"));
      const first = manager.read(started.id);
      expect(first.stdout.text).toContain("ready");

      manager.write(started.id, "hello\\n");
      await waitFor(() => manager.read(started.id, {
        stdoutOffset: first.stdout.nextOffset,
      }).stdout.text.includes("echo:hello"));

      const second = manager.read(started.id, {
        stdoutOffset: first.stdout.nextOffset,
        stderrOffset: first.stderr.nextOffset,
      });
      expect(second.stdout.text).toContain("echo:hello");
      expect(second.stdout.requestedOffset).toBe(first.stdout.nextOffset);

      manager.stop(started.id);
      await waitFor(() => manager.read(started.id).process.status !== "running");
      expect(manager.read(started.id).process.status).toBe("exited");
    } finally {
      await manager.closeAll();
      cleanup(root);
    }
  });

  it("can close stdin for commands that finish after input", async () => {
    const root = makeTmpDir("process-stdin");
    const manager = new ProcessSessionManager(new Workspace(root));
    try {
      const started = await manager.start({
        command: process.execPath,
        args: ["-e", "process.stdin.pipe(process.stdout)"],
      });
      manager.write(started.id, "payload", true);
      await waitFor(() => manager.read(started.id).process.status !== "running");

      const result = manager.read(started.id);
      expect(result.process.exitCode).toBe(0);
      expect(result.stdout.text).toBe("payload");
    } finally {
      await manager.closeAll();
      cleanup(root);
    }
  });

  it("rejects a working directory outside the workspace", async () => {
    const root = makeTmpDir("process-cwd");
    const manager = new ProcessSessionManager(new Workspace(root));
    try {
      await expect(manager.start({
        command: process.execPath,
        args: ["-e", "process.exit(0)"],
        cwd: "..",
      })).rejects.toMatchObject({ code: "PATH_OUTSIDE_WORKSPACE" });
    } finally {
      await manager.closeAll();
      cleanup(root);
    }
  });

  it("reports a missing executable as a start failure", async () => {
    const root = makeTmpDir("process-missing");
    const manager = new ProcessSessionManager(new Workspace(root));
    try {
      await expect(manager.start({ command: "__chatx_missing_executable__" }))
        .rejects.toMatchObject({ code: "PROCESS_START_FAILED" });
    } finally {
      await manager.closeAll();
      cleanup(root);
    }
  });

  it("closeAll terminates running sessions and forgets them", async () => {
    const root = makeTmpDir("process-close");
    const manager = new ProcessSessionManager(new Workspace(root));
    try {
      await manager.start({
        command: process.execPath,
        args: ["-e", "setInterval(() => {}, 1000)"],
      });
      expect(manager.list()).toHaveLength(1);
      await manager.closeAll();
      expect(manager.list()).toHaveLength(0);
    } finally {
      await manager.closeAll();
      cleanup(root);
    }
  });
});
