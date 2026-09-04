import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthStore } from "../src/auth/store.js";
import { confirmConnectorEndpoint, endpointFile, readLastEndpoint, writeLastEndpoint } from "../src/config/endpoint.js";
import { appendExecutionRecord, readExecutionRecords } from "../src/execution/records.js";
import { readSession, sessionFile, writeSession } from "../src/session/state.js";
import { readTunnelState, tunnelStateFile, writeTunnelState } from "../src/tunnel/state.js";
import { TOOLSET_VERSION } from "../src/version.js";
import { Workspace, workspaceIdForCanonicalRoot } from "../src/workspace/manager.js";
import { migrateWorkspaceDirectory, WorkspaceMigrationError } from "../src/workspace/migration.js";
import { cleanup, makeTmpDir, write } from "./helpers.js";

const roots: string[] = [];
const previousChatxState = process.env.CHATX_STATE_DIR;
const previousLegacyState = process.env.C2C_STATE_DIR;

afterEach(() => {
  vi.restoreAllMocks();
  while (roots.length) cleanup(roots.pop()!);
  if (previousChatxState === undefined) delete process.env.CHATX_STATE_DIR;
  else process.env.CHATX_STATE_DIR = previousChatxState;
  if (previousLegacyState === undefined) delete process.env.C2C_STATE_DIR;
  else process.env.C2C_STATE_DIR = previousLegacyState;
});

function setupWorkspace(): { parent: string; source: string; state: string; workspace: Workspace } {
  const parent = makeTmpDir("workspace-migration");
  roots.push(parent);
  const source = path.join(parent, "Old-Workspace");
  fs.mkdirSync(source, { recursive: true });
  write(source, "hello.txt", "hello\n");
  const state = path.join(parent, "state");
  process.env.CHATX_STATE_DIR = state;
  delete process.env.C2C_STATE_DIR;
  return { parent, source, state, workspace: new Workspace(source) };
}

describe("workspace directory migration", () => {
  it("renames to ChatX-Workspace while preserving durable connection state", () => {
    const { parent, state, workspace } = setupWorkspace();
    const now = Date.now();

    write(
      path.join(state, "auth"),
      `${workspace.id}.json`,
      JSON.stringify({
        clients: [{ clientId: "client-1", redirectUris: ["https://chatgpt.com/callback"], createdAt: new Date().toISOString() }],
        tokens: [
          {
            hash: "token-hash-stays-the-same",
            kind: "access",
            clientId: "client-1",
            workspaceId: workspace.id,
            scopes: ["workspace.read"],
            issuedAt: now,
            expiresAt: now + 60_000,
            revoked: false,
          },
        ],
      })
    );
    writeLastEndpoint({
      workspaceId: workspace.id,
      port: 48765,
      publicUrl: "https://c2c-demo.example.com",
      mcpUrl: "https://c2c-demo.example.com/mcp",
      connectorName: "Codex with ChatGPT",
    });
    writeSession(workspace.id, {
      url: "https://chatgpt.com/c/demo",
      title: "C2C Old-Workspace",
      connectorName: "Codex with ChatGPT",
      savedAt: new Date().toISOString(),
    });
    writeTunnelState({
      workspaceId: workspace.id,
      preference: "named",
      provider: "cloudflare-named",
      tunnelName: `c2c-${workspace.id}`,
      tunnelId: "11111111-1111-1111-1111-111111111111",
      hostname: "c2c-demo.example.com",
      zone: "example.com",
    });
    appendExecutionRecord(workspace.id, {
      taskId: "legacy-task",
      iteration: 1,
      changedFiles: 1,
      tests: "ok",
      exitStatus: "ok",
      timestamp: new Date().toISOString(),
    });

    const result = migrateWorkspaceDirectory(workspace.root);
    const migrated = new Workspace(path.join(parent, "ChatX-Workspace"));

    expect(result.newWorkspaceId).toBe(migrated.id);
    expect(fs.existsSync(workspace.root)).toBe(false);
    expect(fs.existsSync(migrated.root)).toBe(true);

    const auth = JSON.parse(fs.readFileSync(path.join(state, "auth", `${migrated.id}.json`), "utf8"));
    expect(auth.tokens[0].hash).toBe("token-hash-stays-the-same");
    expect(auth.tokens[0].workspaceId).toBe(migrated.id);
    expect(new AuthStore(migrated.id).tokenCount()).toBe(1);

    expect(readLastEndpoint(migrated.id)).toMatchObject({
      workspaceId: migrated.id,
      publicUrl: "https://c2c-demo.example.com",
      mcpUrl: "https://c2c-demo.example.com/mcp",
      connectorName: "Codex with ChatGPT",
    });
    expect(readSession(migrated.id)).toMatchObject({
      url: "https://chatgpt.com/c/demo",
      title: "ChatX Old-Workspace",
      connectorName: "ChatX",
    });
    expect(readTunnelState(migrated.id)).toMatchObject({
      workspaceId: migrated.id,
      tunnelName: `c2c-${workspace.id}`,
      tunnelId: "11111111-1111-1111-1111-111111111111",
      hostname: "c2c-demo.example.com",
    });
    expect(readExecutionRecords(migrated.id, 10)).toHaveLength(1);

    expect(fs.existsSync(endpointFile(workspace.id))).toBe(false);
    expect(fs.existsSync(sessionFile(workspace.id))).toBe(false);
    expect(fs.existsSync(tunnelStateFile(workspace.id))).toBe(false);
  });

  it("rebinds connector confirmation to the renamed workspace without changing connection identity", () => {
    const { parent, workspace } = setupWorkspace();
    const fixedPublicUrl = "https://c2c-demo.example.com";
    const fixedMcpUrl = `${fixedPublicUrl}/mcp`;
    const tunnelId = "22222222-2222-2222-2222-222222222222";
    const tunnelName = `c2c-${workspace.id}`;
    const hostname = "c2c-demo.example.com";

    writeLastEndpoint({
      workspaceId: workspace.id,
      port: 48765,
      publicUrl: fixedPublicUrl,
      mcpUrl: fixedMcpUrl,
      connectorMcpUrl: fixedMcpUrl,
      connectorName: "ChatX · Old-Workspace",
      actionsVersion: TOOLSET_VERSION,
    });
    writeTunnelState({
      workspaceId: workspace.id,
      preference: "named",
      provider: "cloudflare-named",
      tunnelName,
      tunnelId,
      hostname,
      zone: "example.com",
    });

    const result = migrateWorkspaceDirectory(workspace.root);
    const migrated = new Workspace(path.join(parent, "ChatX-Workspace"));
    expect(result.newWorkspaceId).toBe(migrated.id);

    expect(readLastEndpoint(migrated.id)).toMatchObject({
      workspaceId: migrated.id,
      mcpUrl: fixedMcpUrl,
      connectorMcpUrl: fixedMcpUrl,
      connectorName: "ChatX · Old-Workspace",
    });

    const confirmed = confirmConnectorEndpoint(migrated.id, migrated.name);
    expect(confirmed).toMatchObject({
      workspaceId: migrated.id,
      mcpUrl: fixedMcpUrl,
      connectorMcpUrl: fixedMcpUrl,
      connectorName: "ChatX · ChatX-Workspace",
      actionsVersion: TOOLSET_VERSION,
    });
    expect(readTunnelState(migrated.id)).toMatchObject({
      workspaceId: migrated.id,
      tunnelName,
      tunnelId,
      hostname,
    });
  });

  it("does not roll back committed migration when stale-state cleanup fails", () => {
    const { parent, workspace } = setupWorkspace();
    writeLastEndpoint({
      workspaceId: workspace.id,
      port: 48765,
      publicUrl: null,
      mcpUrl: "http://127.0.0.1:48765/mcp",
      connectorName: "ChatX · Old-Workspace",
    });

    const realRmSync = fs.rmSync.bind(fs);
    vi.spyOn(fs, "rmSync").mockImplementation((target, options) => {
      if (String(target).includes(".chatx-migrate-")) throw new Error("simulated stale backup lock");
      return realRmSync(target, options);
    });

    const result = migrateWorkspaceDirectory(workspace.root);
    const target = path.join(parent, "ChatX-Workspace");

    expect(result.newRoot).toBe(fs.realpathSync.native(target));
    expect(fs.existsSync(workspace.root)).toBe(false);
    expect(fs.existsSync(endpointFile(workspace.id))).toBe(false);
    expect(readLastEndpoint(result.newWorkspaceId)).toMatchObject({
      workspaceId: result.newWorkspaceId,
      connectorName: "ChatX · Old-Workspace",
    });
  });

  it("refuses a target state collision before renaming anything", () => {
    const { parent, state, workspace } = setupWorkspace();
    const target = path.join(parent, "ChatX-Workspace");
    const newId = workspaceIdForCanonicalRoot(target);
    write(path.join(state, "endpoints"), `${newId}.json`, JSON.stringify({ workspaceId: newId }));
    writeLastEndpoint({
      workspaceId: workspace.id,
      port: 48765,
      publicUrl: null,
      mcpUrl: "http://127.0.0.1:48765/mcp",
      connectorName: "ChatX · Old-Workspace",
    });

    expect(() => migrateWorkspaceDirectory(workspace.root)).toThrowError(WorkspaceMigrationError);
    expect(fs.existsSync(workspace.root)).toBe(true);
    expect(fs.existsSync(target)).toBe(false);
    expect(fs.existsSync(endpointFile(workspace.id))).toBe(true);
  });
});
