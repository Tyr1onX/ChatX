import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { startBridge, type Bridge } from "../src/bridge/server.js";
import {
  connectorRepairDecision,
  readLastEndpoint,
  writeLastEndpoint,
} from "../src/config/endpoint.js";
import { cleanup, isolateStateDir, makeTmpDir } from "./helpers.js";

const cleanupDirs: string[] = [];
const bridges: Bridge[] = [];
const previousStateDir = process.env.C2C_STATE_DIR;

afterEach(async () => {
  while (bridges.length) await bridges.pop()!.close();
  while (cleanupDirs.length) cleanup(cleanupDirs.pop()!);
  if (previousStateDir === undefined) delete process.env.C2C_STATE_DIR;
  else process.env.C2C_STATE_DIR = previousStateDir;
});

it("keeps an interrupted address reclaim repairable after the new endpoint is persisted", async () => {
  const stateDir = isolateStateDir();
  cleanupDirs.push(stateDir);
  const workspaceRoot = makeTmpDir("doctor-reclaim-interruption");
  cleanupDirs.push(workspaceRoot);

  const bridge = await startBridge({
    workspaceRoot,
    port: 0,
    persistRuntime: false,
    authStoreFile: path.join(stateDir, "auth.json"),
  });
  bridges.push(bridge);

  bridge.authStore.issueTokens({
    clientId: "old-chatgpt-connector",
    scopes: ["workspace.read", "offline_access"],
  });
  expect(bridge.authStore.tokenCount()).toBe(2);

  const oldMcpUrl = "https://old-address.trycloudflare.com/mcp";
  const newMcpUrl = "https://new-address.trycloudflare.com/mcp";
  writeLastEndpoint({
    workspaceId: bridge.workspace.id,
    port: bridge.port,
    publicUrl: "https://old-address.trycloudflare.com",
    mcpUrl: oldMcpUrl,
    connectorName: "ChatX · Demo",
  });

  expect(connectorRepairDecision(oldMcpUrl, newMcpUrl, true)).toEqual({
    action: "update",
    reason: "address_reclaimed",
  });

  const revoke = await fetch(`${bridge.localBaseUrl()}/admin/revoke-all`, {
    method: "POST",
    headers: { authorization: `Bearer ${bridge.adminToken}` },
  });
  expect(revoke.ok).toBe(true);

  // Doctor persists the newly established public endpoint before the browser
  // connector replacement/OAuth flow finishes. If that later flow is
  // interrupted, the old authorization must no longer make this look healthy.
  writeLastEndpoint({
    workspaceId: bridge.workspace.id,
    port: bridge.port,
    publicUrl: "https://new-address.trycloudflare.com",
    mcpUrl: newMcpUrl,
    connectorName: "ChatX · Demo",
  });

  const infoResponse = await fetch(`${bridge.localBaseUrl()}/admin/info`, {
    headers: { authorization: `Bearer ${bridge.adminToken}` },
  });
  expect(infoResponse.ok).toBe(true);
  const info = (await infoResponse.json()) as { tokenCount: number };
  expect(info.tokenCount).toBe(0);
  expect(readLastEndpoint(bridge.workspace.id)?.mcpUrl).toBe(newMcpUrl);

  expect(
    connectorRepairDecision(
      readLastEndpoint(bridge.workspace.id)?.mcpUrl,
      newMcpUrl,
      info.tokenCount > 0
    )
  ).toEqual({ action: "update", reason: "authorization_lost" });
});
