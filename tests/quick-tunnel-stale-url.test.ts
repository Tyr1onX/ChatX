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
import { cleanup, isolateStateDir, makeGitRepo, makeTmpDir } from "./helpers.js";

interface FakeChild extends EventEmitter {
  stdout: PassThrough;
  stderr: PassThrough;
  kill: ReturnType<typeof vi.fn>;
}

interface AdminInfo {
  publicUrl: string | null;
  tunnel: {
    running: boolean;
    url: string | null;
    provider: string;
  };
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

async function adminInfo(bridge: Bridge): Promise<AdminInfo> {
  const response = await fetch(`${bridge.localBaseUrl()}/admin/info`, {
    headers: { Authorization: `Bearer ${bridge.adminToken}` },
  });
  expect(response.ok).toBe(true);
  return (await response.json()) as AdminInfo;
}

afterEach(() => {
  mocks.spawn.mockReset();
  mocks.findBinary.mockClear();
  while (cleanupDirs.length) cleanup(cleanupDirs.pop()!);
  if (previousStateDir === undefined) delete process.env.C2C_STATE_DIR;
  else process.env.C2C_STATE_DIR = previousStateDir;
});

describe("quick tunnel stale public URL", () => {
  it("clears admin publicUrl after the cloudflared process exits", async () => {
    const child = fakeChild();
    mocks.spawn.mockReturnValue(child);

    cleanupDirs.push(isolateStateDir());
    const root = makeTmpDir("quick-tunnel-stale-url");
    const authDir = makeTmpDir("quick-tunnel-stale-url-auth");
    cleanupDirs.push(root, authDir);
    makeGitRepo(root);

    const bridge = await startBridge({
      workspaceRoot: root,
      port: 0,
      persistRuntime: false,
      authStoreFile: path.join(authDir, "store.json"),
    });

    try {
      const startPromise = fetch(`${bridge.localBaseUrl()}/admin/tunnel/start`, {
        method: "POST",
        headers: { Authorization: `Bearer ${bridge.adminToken}` },
      });
      child.stderr.write("INF Your quick Tunnel has been created https://first-demo.trycloudflare.com\n");
      const started = await startPromise;
      expect(started.ok).toBe(true);

      expect(await adminInfo(bridge)).toMatchObject({
        publicUrl: "https://first-demo.trycloudflare.com",
        tunnel: {
          running: true,
          url: "https://first-demo.trycloudflare.com",
          provider: "cloudflare-quick",
        },
      });

      child.emit("exit", 1);

      expect(await adminInfo(bridge)).toMatchObject({
        publicUrl: null,
        tunnel: {
          running: false,
          url: null,
          provider: "cloudflare-quick",
        },
      });
    } finally {
      await bridge.close();
    }
  });
});
