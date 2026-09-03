import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  findBinary: vi.fn(() => "cloudflared-test"),
}));

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return { ...actual, spawn: mocks.spawn };
});

vi.mock("../src/tunnel/detect.js", () => ({
  findBinary: mocks.findBinary,
  detectTunnelBinaries: () => ({ cloudflared: mocks.findBinary("cloudflared") }),
}));

import { startBridge, type Bridge } from "../src/bridge/server.js";
import { writeTunnelState } from "../src/tunnel/state.js";
import { Workspace } from "../src/workspace/manager.js";
import { cleanup, isolateStateDir, makeGitRepo, makeTmpDir } from "./helpers.js";

interface FakeChild extends EventEmitter {
  stdout: PassThrough;
  stderr: PassThrough;
  kill: ReturnType<typeof vi.fn>;
}

const cleanupDirs: string[] = [];
const previousStateDir = process.env.C2C_STATE_DIR;

function fakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn(() => {
    queueMicrotask(() => child.emit("exit", null));
    return true;
  });
  return child;
}

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for tunnel lifecycle state");
}

async function adminInfo(bridge: Bridge): Promise<{ publicUrl: string | null }> {
  const response = await fetch(`${bridge.localBaseUrl()}/admin/info`, {
    headers: { Authorization: `Bearer ${bridge.adminToken}` },
  });
  expect(response.ok).toBe(true);
  return (await response.json()) as { publicUrl: string | null };
}

afterEach(() => {
  mocks.spawn.mockReset();
  mocks.findBinary.mockClear();
  while (cleanupDirs.length) cleanup(cleanupDirs.pop()!);
  if (previousStateDir === undefined) delete process.env.C2C_STATE_DIR;
  else process.env.C2C_STATE_DIR = previousStateDir;
});

describe("named tunnel lifecycle", () => {
  it("auto-restores on bridge start, retries failures, and reconnects after a drop", async () => {
    const children: FakeChild[] = [];
    mocks.spawn.mockImplementation(() => {
      const child = fakeChild();
      children.push(child);
      return child;
    });

    cleanupDirs.push(isolateStateDir());
    const root = makeTmpDir("tunnel-lifecycle");
    const authDir = makeTmpDir("tunnel-lifecycle-auth");
    cleanupDirs.push(root, authDir);
    makeGitRepo(root);

    const workspace = new Workspace(root);
    const now = new Date().toISOString();
    writeTunnelState({
      workspaceId: workspace.id,
      preference: "named",
      askedAt: now,
      provider: "cloudflare-named",
      tunnelName: `c2c-${workspace.id}`,
      hostname: "c2c-demo.example.com",
      zone: "example.com",
      configuredAt: now,
    });

    const bridge = await startBridge({
      workspaceRoot: root,
      port: 0,
      persistRuntime: false,
      authStoreFile: path.join(authDir, "store.json"),
    });

    try {
      await waitFor(() => children.length === 1, 1_000);
      children[0].emit("exit", 1);

      await waitFor(() => children.length === 2, 2_500);
      children[1].stderr.write("INF Registered tunnel connection connIndex=0\n");
      await waitFor(async () => (await adminInfo(bridge)).publicUrl === "https://c2c-demo.example.com", 1_000);

      children[1].emit("exit", 1);
      await waitFor(() => children.length === 3, 2_500);
      children[2].stderr.write("INF Registered tunnel connection connIndex=0\n");
      await waitFor(async () => (await adminInfo(bridge)).publicUrl === "https://c2c-demo.example.com", 1_000);

      const response = await fetch(`${bridge.localBaseUrl()}/admin/tunnel/stop`, {
        method: "POST",
        headers: { Authorization: `Bearer ${bridge.adminToken}` },
      });
      expect(response.ok).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 1_250));
      expect(children).toHaveLength(3);
    } finally {
      await bridge.close();
    }
  });
});
