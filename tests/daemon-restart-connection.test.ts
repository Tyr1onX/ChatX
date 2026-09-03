import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  findLiveBridge: vi.fn(),
  probeBridge: vi.fn(),
  readRuntimeState: vi.fn(),
}));

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return { ...actual, spawn: mocks.spawn };
});

vi.mock("../src/bridge/runtime.js", () => ({
  findLiveBridge: mocks.findLiveBridge,
  probeBridge: mocks.probeBridge,
  readRuntimeState: mocks.readRuntimeState,
}));

import { ensureBridge, stopBridge } from "../src/process/daemon.js";
import { Workspace } from "../src/workspace/manager.js";
import { cleanup, isolateStateDir, makeTmpDir } from "./helpers.js";

const cleanupDirs: string[] = [];
const previousStateDir = process.env.C2C_STATE_DIR;

afterEach(() => {
  vi.restoreAllMocks();
  mocks.spawn.mockReset();
  mocks.findLiveBridge.mockReset();
  mocks.probeBridge.mockReset();
  mocks.readRuntimeState.mockReset();
  while (cleanupDirs.length) cleanup(cleanupDirs.pop()!);
  if (previousStateDir === undefined) delete process.env.C2C_STATE_DIR;
  else process.env.C2C_STATE_DIR = previousStateDir;
});

describe("bridge restart connection preservation", () => {
  it("restarts a previously active public tunnel without requiring --tunnel", async () => {
    cleanupDirs.push(isolateStateDir());
    const root = makeTmpDir("daemon-restart-public");
    cleanupDirs.push(root);
    const workspace = new Workspace(root);

    const oldRuntime = {
      service: "ChatX",
      version: "test",
      workspaceId: workspace.id,
      workspaceRoot: workspace.root,
      pid: 111,
      port: 1111,
      adminToken: "old-admin",
      publicUrl: "https://old.trycloudflare.com",
      startedAt: new Date().toISOString(),
    };
    const newRuntime = {
      ...oldRuntime,
      pid: 222,
      port: 2222,
      adminToken: "new-admin",
      publicUrl: null,
    };

    mocks.readRuntimeState.mockReturnValue(oldRuntime);
    mocks.probeBridge.mockResolvedValue({
      service: "ChatX",
      version: "test",
      workspaceId: workspace.id,
      status: "ok",
    });
    mocks.findLiveBridge.mockResolvedValueOnce(null).mockResolvedValueOnce(newRuntime);
    mocks.spawn.mockReturnValue({
      unref: vi.fn(),
      exitCode: null,
    });

    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "http://127.0.0.1:1111/admin/info") {
        return new Response(
          JSON.stringify({
            publicUrl: "https://old.trycloudflare.com",
            tunnel: { running: true },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (url === "http://127.0.0.1:1111/admin/shutdown") {
        return new Response(JSON.stringify({ shuttingDown: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url === "http://127.0.0.1:2222/admin/tunnel/start") {
        expect(init?.method).toBe("POST");
        return new Response(JSON.stringify({ url: "https://new.trycloudflare.com" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    expect(await stopBridge(root)).toBe(true);
    const restarted = await ensureBridge(root);

    expect(restarted.spawned).toBe(true);
    expect(restarted.runtime).toEqual(newRuntime);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:2222/admin/tunnel/start",
      expect.objectContaining({ method: "POST" })
    );
  });
});
