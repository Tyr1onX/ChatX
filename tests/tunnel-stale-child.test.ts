import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
}));

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return { ...actual, spawn: mocks.spawn };
});

import { CloudflaredQuickTunnel } from "../src/tunnel/cloudflared.js";
import { CloudflaredNamedTunnel } from "../src/tunnel/cloudflared-named.js";

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

afterEach(() => {
  mocks.spawn.mockReset();
});

it("ignores late events from a stopped quick-tunnel child after replacement", async () => {
  const first = fakeChild();
  const second = fakeChild();
  mocks.spawn.mockReturnValueOnce(first).mockReturnValueOnce(second);

  const tunnel = new CloudflaredQuickTunnel(undefined, "cloudflared-test");
  const firstStart = tunnel.start(3210);
  first.stderr.write("INF Your quick Tunnel has been created https://first-demo.trycloudflare.com\n");
  await expect(firstStart).resolves.toBe("https://first-demo.trycloudflare.com");

  await tunnel.stop();
  expect(first.kill).toHaveBeenCalledWith("SIGTERM");

  const secondStart = tunnel.start(3210);
  second.stderr.write("INF Your quick Tunnel has been created https://second-demo.trycloudflare.com\n");
  await expect(secondStart).resolves.toBe("https://second-demo.trycloudflare.com");

  first.stderr.write("ERR stale child error after replacement\n");
  first.emit("exit", 0);

  expect(tunnel.status()).toMatchObject({
    running: true,
    url: "https://second-demo.trycloudflare.com",
    provider: "cloudflare-quick",
  });
});

it("ignores late events from a stopped named-tunnel child after replacement", async () => {
  const first = fakeChild();
  const second = fakeChild();
  mocks.spawn.mockReturnValueOnce(first).mockReturnValueOnce(second);

  const tunnel = new CloudflaredNamedTunnel({
    tunnelName: "chatx-demo",
    hostname: "chatx-demo.example.com",
    binaryOverride: "cloudflared-test",
    startTimeoutMs: 1000,
  });

  const firstStart = tunnel.start(3210);
  first.stderr.write("INF Registered tunnel connection connIndex=0\n");
  await expect(firstStart).resolves.toBe("https://chatx-demo.example.com");

  await tunnel.stop();
  expect(first.kill).toHaveBeenCalledWith("SIGTERM");

  const secondStart = tunnel.start(3210);
  second.stderr.write("INF Registered tunnel connection connIndex=0\n");
  await expect(secondStart).resolves.toBe("https://chatx-demo.example.com");

  first.stderr.write("ERR stale child fatal after replacement\n");
  first.emit("exit", 0);

  expect(tunnel.status()).toMatchObject({
    running: true,
    url: "https://chatx-demo.example.com",
    provider: "cloudflare-named",
  });
});
