import { describe, it, expect } from "vitest";
import {
  connectorAction,
  connectorNameFor,
  connectorRepairDecision,
  LEGACY_CONNECTOR_NAME,
  mcpUrlFromPublic,
  normalizePublicUrl,
  reclaimUserMessage,
  reauthorizeUserMessage,
} from "../src/config/endpoint.js";

describe("connectorAction", () => {
  it("creates on the first successful URL", () => {
    expect(connectorAction(null, "https://a.trycloudflare.com/mcp")).toBe("create");
  });

  it("is a no-op when the URL is unchanged", () => {
    expect(connectorAction("https://a.trycloudflare.com/mcp", "https://a.trycloudflare.com/mcp/")).toBe("none");
  });

  it("updates when the old address was reclaimed", () => {
    expect(connectorAction("https://old.trycloudflare.com/mcp", "https://new.trycloudflare.com/mcp")).toBe("update");
    expect(reclaimUserMessage("Codex with ChatGPT")).toContain("删除");
    expect(reclaimUserMessage("Codex with ChatGPT")).not.toContain("Reconnect");
  });

  it("does nothing without a next URL", () => {
    expect(connectorAction("https://a.trycloudflare.com/mcp", null)).toBe("none");
  });
});

describe("connectorRepairDecision", () => {
  it("keeps a healthy same-address authorization untouched", () => {
    expect(
      connectorRepairDecision(
        "https://stable.example.com/mcp",
        "https://stable.example.com/mcp/",
        true
      )
    ).toEqual({ action: "none" });
  });

  it("reauthorizes a recorded same-address connector when local authorization is gone", () => {
    expect(
      connectorRepairDecision(
        "https://stable.example.com/mcp",
        "https://stable.example.com/mcp",
        false
      )
    ).toEqual({ action: "update", reason: "authorization_lost" });
    expect(reauthorizeUserMessage("ChatX · Demo")).toContain("原地址");
    expect(reauthorizeUserMessage("ChatX · Demo")).toContain("授权");
  });

  it("prefers address reclaim when both the URL changed and authorization is gone", () => {
    expect(
      connectorRepairDecision(
        "https://old.example.com/mcp",
        "https://new.example.com/mcp",
        false
      )
    ).toEqual({ action: "update", reason: "address_reclaimed" });
  });

  it("does not invent an authorization repair before a connector has been recorded", () => {
    expect(connectorRepairDecision(null, "https://stable.example.com/mcp", false)).toEqual({ action: "create" });
  });
});

describe("connectorNameFor", () => {
  it("keeps a stored name for the same workspace", () => {
    expect(
      connectorNameFor({
        workspaceName: "EchoMind",
        workspaceId: "abc123abc123",
        previousName: "Codex with ChatGPT",
        hadEndpointBefore: true,
      })
    ).toBe(LEGACY_CONNECTOR_NAME);
  });

  it("keeps the legacy title when this workspace was used before the name field existed", () => {
    expect(
      connectorNameFor({
        workspaceName: "EchoMind",
        workspaceId: "abc123abc123",
        hadEndpointBefore: true,
      })
    ).toBe(LEGACY_CONNECTOR_NAME);
  });

  it("gives a new workspace its own connector title", () => {
    expect(
      connectorNameFor({
        workspaceName: "Landing",
        workspaceId: "def456def456",
        hadEndpointBefore: false,
      })
    ).toBe("ChatX · Landing");
  });
});

describe("mcpUrlFromPublic", () => {
  it("appends /mcp and folds case/slash variants", () => {
    expect(mcpUrlFromPublic("https://A.trycloudflare.com/")).toBe("https://a.trycloudflare.com/mcp");
    expect(mcpUrlFromPublic("https://a.trycloudflare.com/mcp")).toBe("https://a.trycloudflare.com/mcp");
    expect(normalizePublicUrl("https://A.trycloudflare.com/")).toBe("https://a.trycloudflare.com");
  });
});
