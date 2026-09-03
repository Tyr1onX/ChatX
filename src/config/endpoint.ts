import path from "node:path";
import { getStateDir, readJsonIfExists, writeSecureJson } from "./paths.js";

export const CHATGPT_PLUGINS_URL = "https://chatgpt.com/plugins";
export const CHATGPT_CREATE_CONNECTOR_URL =
  "https://chatgpt.com/plugins#settings/Connectors?create-connector=true&redirectAfter=%2Fplugins";

export const DEFAULT_CONNECTOR_NAME = "ChatX";
export const LEGACY_CONNECTOR_NAME = "Codex with ChatGPT";

export interface LastEndpoint {
  workspaceId: string;
  port: number;
  publicUrl: string | null;
  mcpUrl: string | null;
  connectorName?: string;
  savedAt: string;
}

export function endpointFile(workspaceId: string): string {
  return path.join(getStateDir(), "endpoints", `${workspaceId}.json`);
}

export function readLastEndpoint(workspaceId: string): LastEndpoint | null {
  return readJsonIfExists<LastEndpoint>(endpointFile(workspaceId));
}

export function writeLastEndpoint(endpoint: Omit<LastEndpoint, "savedAt">): LastEndpoint {
  const saved: LastEndpoint = { ...endpoint, savedAt: new Date().toISOString() };
  writeSecureJson(endpointFile(saved.workspaceId), saved);
  return saved;
}

export function normalizePublicUrl(url: string): string {
  return url.trim().replace(/\/+$/, "").toLowerCase();
}

export function mcpUrlFromPublic(publicUrl: string | null | undefined): string | null {
  if (!publicUrl) return null;
  const base = normalizePublicUrl(publicUrl).replace(/\/mcp$/, "");
  return `${base}/mcp`;
}

/** What the Skill should do to THIS workspace's ChatGPT connector.
 *  `update` means the existing connector must be replaced via the verified
 *  Delete -> New plugin -> OAuth route. The reason can be an address change
 *  or lost local authorization state. Never click Reconnect on the old card. */
export function connectorAction(
  previousMcpUrl: string | null | undefined,
  nextMcpUrl: string | null | undefined
): "none" | "create" | "update" {
  if (!nextMcpUrl) return "none";
  if (!previousMcpUrl) return "create";
  return normalizePublicUrl(previousMcpUrl) === normalizePublicUrl(nextMcpUrl) ? "none" : "update";
}

export type ConnectorRepairReason = "address_reclaimed" | "authorization_lost";

export interface ConnectorRepairDecision {
  action: "none" | "create" | "update";
  reason?: ConnectorRepairReason;
}

/**
 * Decide whether an already-recorded connector must be replaced. URL changes
 * take precedence. If the URL is unchanged but the bridge no longer has any
 * live authorization state for a recorded connector, recreate the same
 * connector at the same URL so OAuth can be established again.
 */
export function connectorRepairDecision(
  previousMcpUrl: string | null | undefined,
  nextMcpUrl: string | null | undefined,
  hasAuthorization: boolean
): ConnectorRepairDecision {
  const action = connectorAction(previousMcpUrl, nextMcpUrl);
  if (action === "update") return { action, reason: "address_reclaimed" };
  if (action === "none" && previousMcpUrl && nextMcpUrl && !hasAuthorization) {
    return { action: "update", reason: "authorization_lost" };
  }
  return { action };
}

export function sanitizeConnectorLabel(name: string, workspaceId: string): string {
  const cleaned = name.replace(/[^\p{L}\p{N}._\- ]+/gu, "").replace(/\s+/g, " ").trim();
  return cleaned.slice(0, 40) || workspaceId.slice(0, 6);
}

/**
 * Same workspace keeps one connector title forever.
 * A workspace already recorded without a title stays on the original
 * legacy connector name. Saved connector names are never rewritten; a new workspace gets a ChatX title.
 */
export function connectorNameFor(opts: {
  workspaceName: string;
  workspaceId: string;
  previousName?: string | null;
  hadEndpointBefore: boolean;
}): string {
  if (opts.previousName?.trim()) return opts.previousName.trim();
  if (opts.hadEndpointBefore) return LEGACY_CONNECTOR_NAME;
  return `${DEFAULT_CONNECTOR_NAME} · ${sanitizeConnectorLabel(opts.workspaceName, opts.workspaceId)}`;
}

export function reclaimUserMessage(connectorName: string): string {
  return `当前项目的安全连接地址已经失效。我会删除「${connectorName}」再按新地址加回去，其它项目的连接不动。请稍等。`;
}

export function reauthorizeUserMessage(connectorName: string): string {
  return `当前项目的 ChatGPT 授权已经失效，但连接地址仍然正常。我会删除「${connectorName}」再按原地址加回去，只重新完成这一个项目的授权，其它项目的连接不动。`;
}
