import { afterEach, describe, expect, it } from "vitest";
import {
  actionsRefreshDecision,
  confirmConnectorEndpoint,
  connectorNameFor,
  connectorNeedsBrandMigration,
  connectorRepairDecision,
  readLastEndpoint,
  writeLastEndpoint,
} from "../src/config/endpoint.js";
import { TOOLSET_VERSION } from "../src/version.js";
import { cleanup, isolateStateDir } from "./helpers.js";

const stateDirs: string[] = [];
const previousChatxState = process.env.CHATX_STATE_DIR;
const previousLegacyState = process.env.C2C_STATE_DIR;

afterEach(() => {
  while (stateDirs.length) cleanup(stateDirs.pop()!);
  if (previousChatxState === undefined) delete process.env.CHATX_STATE_DIR;
  else process.env.CHATX_STATE_DIR = previousChatxState;
  if (previousLegacyState === undefined) delete process.env.C2C_STATE_DIR;
  else process.env.C2C_STATE_DIR = previousLegacyState;
});

describe("ChatX connector brand/toolset migration", () => {
  it("turns a same-address legacy connector into a one-time update", () => {
    expect(connectorNeedsBrandMigration({ previousName: "Codex with ChatGPT", hadEndpointBefore: true })).toBe(true);
    expect(
      connectorRepairDecision(
        "https://stable.example.com/mcp",
        "https://stable.example.com/mcp",
        true,
        true
      )
    ).toEqual({ action: "update", reason: "brand_migration" });
  });

  it("rebinds ChatX-managed connector names to the current workspace while preserving custom names", () => {
    expect(
      connectorNameFor({
        workspaceName: "ChatX-Workspace",
        workspaceId: "abc123abc123",
        previousName: "Codex with ChatGPT · Old-Workspace",
        hadEndpointBefore: true,
      })
    ).toBe("ChatX · ChatX-Workspace");
    expect(
      connectorNameFor({
        workspaceName: "ChatX-Workspace",
        workspaceId: "abc123abc123",
        previousName: "ChatX · Old-Workspace",
        hadEndpointBefore: true,
      })
    ).toBe("ChatX · ChatX-Workspace");
    expect(
      connectorNameFor({
        workspaceName: "ChatX-Workspace",
        workspaceId: "abc123abc123",
        previousName: "My custom connector",
        hadEndpointBefore: true,
      })
    ).toBe("My custom connector");
  });

  it("prompts for Actions when a saved connector predates the current toolset version", () => {
    const oldEndpoint = {
      workspaceId: "abc123abc123",
      port: 48765,
      publicUrl: "https://stable.example.com",
      mcpUrl: "https://stable.example.com/mcp",
      connectorName: "ChatX · Demo",
      savedAt: new Date().toISOString(),
    };
    const decision = actionsRefreshDecision(oldEndpoint, "ChatX · Demo");
    expect(decision.needed).toBe(true);
    expect(decision.currentVersion).toBe(TOOLSET_VERSION);
    expect(decision.userMessage).toContain("刷新 Actions");
  });

  it("records the new brand and toolset only after connector confirmation", () => {
    stateDirs.push(isolateStateDir());
    writeLastEndpoint({
      workspaceId: "abc123abc123",
      port: 48765,
      publicUrl: "https://stable.example.com",
      mcpUrl: "https://stable.example.com/mcp",
      connectorName: "Codex with ChatGPT",
    });

    const confirmed = confirmConnectorEndpoint("abc123abc123", "Demo");
    expect(confirmed).toMatchObject({
      connectorName: "ChatX · Demo",
      actionsVersion: TOOLSET_VERSION,
    });
    expect(actionsRefreshDecision(readLastEndpoint("abc123abc123"), "ChatX · Demo").needed).toBe(false);
  });
});
