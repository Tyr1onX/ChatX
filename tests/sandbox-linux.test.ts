import { describe, expect, it } from "vitest";
import { createLinuxSandboxBackend } from "../src/process/sandbox-linux.js";
import { ProcessSandboxError } from "../src/process/sandbox-launcher.js";

describe("createLinuxSandboxBackend", () => {
  it("declares Linux explicitly and rejects invalid helper paths", () => {
    expect(() => createLinuxSandboxBackend({ helperPath: "relative-helper" }))
      .toThrow(/absolute Linux path/);

    const backend = createLinuxSandboxBackend({ helperPath: "/opt/chatx/sandbox-helper" });
    expect(backend.platform).toBe("linux");
  });

  it("fails closed before spawning when invoked on a non-Linux host", async () => {
    if (process.platform === "linux") return;

    const backend = createLinuxSandboxBackend({ helperPath: "/never-executed/helper" });
    await expect(backend.spawn({
      command: "/never-executed/target",
      args: [],
      cwd: "/workspace",
      workspaceRoot: "/workspace",
      environment: Object.freeze({ HOME: "/sandbox/home", TMPDIR: "/sandbox/temp" }),
      privateDirectories: {
        root: "/sandbox",
        home: "/sandbox/home",
        temp: "/sandbox/temp",
      },
    })).rejects.toBeInstanceOf(ProcessSandboxError);
  });
});