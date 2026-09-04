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
import {
  connectorRepairDecision,
  readLastEndpoint,
  writeLastEndpoint,
} from "../src/config/endpoint.js";
import { cleanup, isolateStateDir, makeGitRepo, makeTmpDir } from "./helpers.js";

interface FakeChild extends EventEmitter {
  stdout: PassThrough;
  stderr: PassThrough;
  kill: ReturnType<typeof vi.fn>;
}

const cleanupDirs: string[] = [];
const bridges: Bridge[] = [];
const previousStateDir = process.env.C2C_STATE_DIR;

function fakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn(() => true);
  return child;
}

async function makeBridge(label: string): Promise<Bridge> {
  cleanupDirs.push(isolateStateDir());
  const root = makeTmpDir(label);
  const authDir = makeTmpDir(`${label}-auth`);
  cleanupDirs.push(root, authDir);
  makeGitRepo(root);
  const bridge = await startBridge({
    workspaceRoot: root,
    port: 0,
    persistRuntime: false,
    authStoreFile: path.join(authDir, "store.json"),
  });
  bridges.push(bridge);
  return bridge;
}

async function startQuickTunnel(bridge: Bridge, child: FakeChild, url: string): Promise<void> {
  mocks.spawn.mockReturnValueOnce(child);
  const start = fetch(`${bridge.localBaseUrl()}/admin/tunnel/start`, {
    method: "POST",
    headers: { Authorization: `Bearer ${bridge.adminToken}` },
  });
  child.stderr.write(`INF Your quick Tunnel has been created ${url}\n`);
  const response = await start;
  expect(response.ok).toBe(true);
  await expect(response.json()).resolves.toMatchObject({ url });
}

async function adminInfo(bridge: Bridge): Promise<{ tokenCount: number; pairingActive: boolean }> {
  const response = await fetch(`${bridge.localBaseUrl()}/admin/info`, {
    headers: { Authorization: `Bearer ${bridge.adminToken}` },
  });
  expect(response.ok).toBe(true);
  const body = (await response.json()) as { tokenCount: number; pairingActive: boolean };
  return { tokenCount: body.tokenCount, pairingActive: body.pairingActive };
}

afterEach(async () => {
  mocks.spawn.mockReset();
  mocks.findBinary.mockClear();
  while (bridges.length) await bridges.pop()!.close();
  while (cleanupDirs.length) cleanup(cleanupDirs.pop()!);
  if (previousStateDir === undefined) delete process.env.C2C_STATE_DIR;
  else process.env.C2C_STATE_DIR = previousStateDir;
});

it("revokes old authorization before publishing a changed public endpoint", async () => {
  const bridge = await makeBridge("endpoint-auth-change");
  bridge.authStore.issueTokens({
    clientId: "old-chatgpt-connector",
    scopes: ["workspace.read", "offline_access"],
  });
  const pairing = await fetch(`${bridge.localBaseUrl()}/admin/pairing`, {
    method: "POST",
    headers: { Authorization: `Bearer ${bridge.adminToken}` },
  });
  expect(pairing.ok).toBe(true);

  const oldMcpUrl = "https://old-address.trycloudflare.com/mcp";
  const newPublicUrl = "https://new-address.trycloudflare.com";
  const newMcpUrl = `${newPublicUrl}/mcp`;
  writeLastEndpoint({
    workspaceId: bridge.workspace.id,
    port: bridge.port,
    publicUrl: "https://old-address.trycloudflare.com",
    mcpUrl: oldMcpUrl,
    connectorName: "ChatX · Demo",
  });

  expect(await adminInfo(bridge)).toEqual({ tokenCount: 2, pairingActive: true });
  await startQuickTunnel(bridge, fakeChild(), newPublicUrl);
  expect(await adminInfo(bridge)).toEqual({ tokenCount: 0, pairingActive: false });

  // Simulate the CLI persisting the discovered endpoint and the later ChatGPT
  // connector/OAuth replacement being interrupted. The next Doctor pass must
  // still see a repairable authorization loss instead of treating it as done.
  writeLastEndpoint({
    workspaceId: bridge.workspace.id,
    port: bridge.port,
    publicUrl: newPublicUrl,
    mcpUrl: newMcpUrl,
    connectorName: "ChatX · Demo",
  });
  expect(readLastEndpoint(bridge.workspace.id)?.mcpUrl).toBe(newMcpUrl);
  expect(connectorRepairDecision(newMcpUrl, newMcpUrl, false)).toEqual({
    action: "update",
    reason: "authorization_lost",
  });
});

it("keeps authorization when the public endpoint is unchanged", async () => {
  const bridge = await makeBridge("endpoint-auth-same");
  bridge.authStore.issueTokens({
    clientId: "existing-chatgpt-connector",
    scopes: ["workspace.read", "offline_access"],
  });
  const publicUrl = "https://same-address.trycloudflare.com";
  writeLastEndpoint({
    workspaceId: bridge.workspace.id,
    port: bridge.port,
    publicUrl,
    mcpUrl: `${publicUrl}/mcp`,
    connectorName: "ChatX · Demo",
  });

  await startQuickTunnel(bridge, fakeChild(), publicUrl);
  expect((await adminInfo(bridge)).tokenCount).toBe(2);
});

it("keeps authorization when no connector endpoint has been recorded yet", async () => {
  const bridge = await makeBridge("endpoint-auth-first");
  bridge.authStore.issueTokens({
    clientId: "preexisting-local-test-client",
    scopes: ["workspace.read", "offline_access"],
  });

  await startQuickTunnel(bridge, fakeChild(), "https://first-address.trycloudflare.com");
  expect((await adminInfo(bridge)).tokenCount).toBe(2);
  expect(readLastEndpoint(bridge.workspace.id)).toBeNull();
});
