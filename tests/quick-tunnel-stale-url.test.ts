import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  findBinary: vi.fn(() => "cloudflared-test"),
  probeBridgeHealth: vi.fn(async () => ({})),
  tunnelDnsProblem: vi.fn(async () => null),
}));

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return { ...actual, spawn: mocks.spawn };
});

vi.mock("../src/tunnel/detect.js", () => ({
  findBinary: mocks.findBinary,
  detectTunnelBinaries: () => ({ cloudflared: mocks.findBinary("cloudflared") }),
}));

vi.mock("../src/tunnel/readiness.js", () => ({
  cloudflareTunnelDnsProblem: mocks.tunnelDnsProblem,
}));

vi.mock("../src/bridge/runtime.js", async () => {
  const actual = await vi.importActual<typeof import("../src/bridge/runtime.js")>("../src/bridge/runtime.js");
  return { ...actual, probeBridgeHealth: mocks.probeBridgeHealth };
});

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
    ready: boolean;
    detail?: string;
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
  mocks.probeBridgeHealth.mockClear();
  mocks.tunnelDnsProblem.mockClear();
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

  it("does not publish a connected tunnel until public health is reachable", async () => {
    const child = fakeChild();
    mocks.spawn.mockReturnValue(child);
    mocks.probeBridgeHealth.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

    cleanupDirs.push(isolateStateDir());
    const root = makeTmpDir("quick-tunnel-readiness");
    const authDir = makeTmpDir("quick-tunnel-readiness-auth");
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
      child.stderr.write("INF Your quick Tunnel has been created https://health-demo.trycloudflare.com\n");
      const started = await startPromise;
      expect(started.status).toBe(500);
      await expect(started.json()).resolves.toMatchObject({
        error: "tunnel_failed",
        message: expect.stringContaining("public /health"),
      });
      expect(child.kill).not.toHaveBeenCalled();

      expect(await adminInfo(bridge)).toMatchObject({
        publicUrl: null,
        tunnel: {
          running: true,
          url: "https://health-demo.trycloudflare.com",
          provider: "cloudflare-quick",
          ready: false,
        },
      });

      expect(await adminInfo(bridge)).toMatchObject({
        publicUrl: "https://health-demo.trycloudflare.com",
        tunnel: {
          running: true,
          ready: true,
        },
      });
      expect(mocks.spawn).toHaveBeenCalledTimes(1);
      expect(child.kill).not.toHaveBeenCalled();
    } finally {
      await bridge.close();
    }
  });

  it("fails before spawning cloudflared when edge DNS is mapped to Fake-IP", async () => {
    const fakeIpMessage =
      "Cloudflare Tunnel DNS returned Fake-IP 198.18.0.40 for region1.v2.argotunnel.com (198.18.0.0/15).";
    mocks.tunnelDnsProblem.mockResolvedValueOnce(fakeIpMessage);

    cleanupDirs.push(isolateStateDir());
    const root = makeTmpDir("quick-tunnel-fake-ip");
    const authDir = makeTmpDir("quick-tunnel-fake-ip-auth");
    cleanupDirs.push(root, authDir);
    makeGitRepo(root);

    const bridge = await startBridge({
      workspaceRoot: root,
      port: 0,
      persistRuntime: false,
      authStoreFile: path.join(authDir, "store.json"),
    });

    try {
      const response = await fetch(`${bridge.localBaseUrl()}/admin/tunnel/start`, {
        method: "POST",
        headers: { Authorization: `Bearer ${bridge.adminToken}` },
      });
      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toMatchObject({
        error: "tunnel_failed",
        message: fakeIpMessage,
      });
      expect(mocks.spawn).not.toHaveBeenCalled();
    } finally {
      await bridge.close();
    }
  });
});
