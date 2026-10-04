import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";

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

function fakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn(() => true);
  return child;
}

const cleanupDirs: string[] = [];
const bridges: Bridge[] = [];
const previousStateDir = process.env.C2C_STATE_DIR;

afterEach(async () => {
  vi.restoreAllMocks();
  mocks.spawn.mockReset();
  mocks.findBinary.mockClear();
  mocks.probeBridgeHealth.mockClear();
  mocks.tunnelDnsProblem.mockClear();
  while (bridges.length) await bridges.pop()!.close();
  while (cleanupDirs.length) cleanup(cleanupDirs.pop()!);
  if (previousStateDir === undefined) delete process.env.C2C_STATE_DIR;
  else process.env.C2C_STATE_DIR = previousStateDir;
});

it("restarts a running quick tunnel whose public health belongs to another workspace", async () => {
  const first = fakeChild();
  const second = fakeChild();
  mocks.spawn.mockReturnValueOnce(first).mockReturnValueOnce(second);

  cleanupDirs.push(isolateStateDir());
  const root = makeTmpDir("tunnel-identity-restart");
  const authDir = makeTmpDir("tunnel-identity-restart-auth");
  cleanupDirs.push(root, authDir);
  makeGitRepo(root);

  const bridge = await startBridge({
    workspaceRoot: root,
    port: 0,
    persistRuntime: false,
    authStoreFile: path.join(authDir, "store.json"),
  });
  bridges.push(bridge);

  const firstStart = fetch(`${bridge.localBaseUrl()}/admin/tunnel/start`, {
    method: "POST",
    headers: { Authorization: `Bearer ${bridge.adminToken}` },
  });
  first.stderr.write("INF Your quick Tunnel has been created https://first-demo.trycloudflare.com\n");
  const firstResponse = await firstStart;
  expect(firstResponse.ok).toBe(true);
  await expect(firstResponse.json()).resolves.toMatchObject({
    url: "https://first-demo.trycloudflare.com",
  });

  // probeBridgeHealth returns null when the public endpoint belongs to another workspace.
  mocks.probeBridgeHealth.mockResolvedValueOnce(null).mockResolvedValueOnce({});

  const secondStart = fetch(`${bridge.localBaseUrl()}/admin/tunnel/start`, {
    method: "POST",
    headers: { Authorization: `Bearer ${bridge.adminToken}` },
  });
  second.stderr.write("INF Your quick Tunnel has been created https://second-demo.trycloudflare.com\n");
  const secondResponse = await secondStart;
  expect(secondResponse.ok).toBe(true);
  await expect(secondResponse.json()).resolves.toMatchObject({
    url: "https://second-demo.trycloudflare.com",
  });

  expect(first.kill).toHaveBeenCalledWith("SIGTERM");
  expect(mocks.spawn).toHaveBeenCalledTimes(2);
  expect(mocks.probeBridgeHealth).toHaveBeenCalledWith(
    "https://first-demo.trycloudflare.com",
    bridge.workspace.id,
    8000,
    expect.any(String)
  );

  first.emit("exit", 0);

  const info = await fetch(`${bridge.localBaseUrl()}/admin/info`, {
    headers: { Authorization: `Bearer ${bridge.adminToken}` },
  });
  expect(info.ok).toBe(true);
  await expect(info.json()).resolves.toMatchObject({
    publicUrl: "https://second-demo.trycloudflare.com",
    tunnel: {
      running: true,
      url: "https://second-demo.trycloudflare.com",
      provider: "cloudflare-quick",
    },
  });
});