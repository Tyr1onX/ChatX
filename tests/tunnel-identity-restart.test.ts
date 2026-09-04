import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";

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

  const actualFetch = globalThis.fetch;
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === "https://first-demo.trycloudflare.com/health") {
      return new Response(
        JSON.stringify({
          service: "chatx-bridge",
          version: "test",
          workspaceId: "different-workspace",
          status: "ok",
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    return actualFetch(input, init);
  });

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
  expect(fetchSpy).toHaveBeenCalledWith(
    "https://first-demo.trycloudflare.com/health",
    expect.objectContaining({ signal: expect.any(AbortSignal) })
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
