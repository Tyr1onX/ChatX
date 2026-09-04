import path from "node:path";
import { getStateDir, readJsonIfExists, writeSecureJson } from "./paths.js";
import { TOOLSET_VERSION } from "../version.js";

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
  /** Last MCP URL confirmed on the ChatGPT connector. */
  connectorMcpUrl?: string | null;
  connectorName?: string;
  actionsVersion?: number;
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

/** What the Skill should do to THIS workspace's ChatGPT connector. */
export function connectorAction(
  previousMcpUrl: string | null | undefined,
  nextMcpUrl: string | null | undefined
): "none" | "create" | "update" {
  if (!nextMcpUrl) return "none";
  if (!previousMcpUrl) return "create";
  return normalizePublicUrl(previousMcpUrl) === normalizePublicUrl(nextMcpUrl) ? "none" : "update";
}

export type ConnectorRepairReason = "address_reclaimed" | "authorization_lost" | "brand_migration";

export interface ConnectorRepairDecision {
  action: "none" | "create" | "update";
  reason?: ConnectorRepairReason;
}

/**
 * URL changes take precedence. A legacy-branded connector is replaced at the
 * same URL, and a connector with lost local authorization is re-created last.
 */
export function connectorRepairDecision(
  previousMcpUrl: string | null | undefined,
  nextMcpUrl: string | null | undefined,
  hasAuthorization: boolean,
  needsBrandMigration = false
): ConnectorRepairDecision {
  const action = connectorAction(previousMcpUrl, nextMcpUrl);
  if (action === "update") return { action, reason: "address_reclaimed" };
  if (action === "none" && previousMcpUrl && nextMcpUrl && needsBrandMigration) {
    return { action: "update", reason: "brand_migration" };
  }
  if (action === "none" && previousMcpUrl && nextMcpUrl && !hasAuthorization) {
    return { action: "update", reason: "authorization_lost" };
  }
  return { action };
}

export function sanitizeConnectorLabel(name: string, workspaceId: string): string {
  const cleaned = name.replace(/[^\p{L}\p{N}._\- ]+/gu, "").replace(/\s+/g, " ").trim();
  return cleaned.slice(0, 40) || workspaceId.slice(0, 6);
}

export function isLegacyConnectorName(name: string | null | undefined): boolean {
  const value = name?.trim();
  return Boolean(value && (value === LEGACY_CONNECTOR_NAME || value.startsWith(`${LEGACY_CONNECTOR_NAME} · `)));
}

/** Remove legacy branding from anything that may be shown to a user. */
export function connectorDisplayName(name: string | null | undefined): string | null {
  const value = name?.trim();
  if (!value) return null;
  if (value === LEGACY_CONNECTOR_NAME) return DEFAULT_CONNECTOR_NAME;
  if (value.startsWith(`${LEGACY_CONNECTOR_NAME} · `)) {
    return `${DEFAULT_CONNECTOR_NAME} · ${value.slice(`${LEGACY_CONNECTOR_NAME} · `.length)}`;
  }
  return value;
}

/** Desired current connector title. Legacy titles are never returned. */
export function connectorNameFor(opts: {
  workspaceName: string;
  workspaceId: string;
  previousName?: string | null;
  hadEndpointBefore: boolean;
}): string {
  const previous = opts.previousName?.trim();
  if (previous && !isLegacyConnectorName(previous)) return previous;
  if (previous?.startsWith(`${LEGACY_CONNECTOR_NAME} · `)) {
    return `${DEFAULT_CONNECTOR_NAME} · ${previous.slice(`${LEGACY_CONNECTOR_NAME} · `.length)}`;
  }
  return `${DEFAULT_CONNECTOR_NAME} · ${sanitizeConnectorLabel(opts.workspaceName, opts.workspaceId)}`;
}

export function connectorNeedsBrandMigration(opts: {
  previousName?: string | null;
  hadEndpointBefore: boolean;
}): boolean {
  return opts.hadEndpointBefore && (!opts.previousName?.trim() || isLegacyConnectorName(opts.previousName));
}

export interface ActionsRefreshDecision {
  needed: boolean;
  currentVersion: number;
  recordedVersion: number | null;
  connectorName: string;
  userMessage?: string;
}

export function actionsRefreshDecision(
  endpoint: LastEndpoint | null,
  connectorName: string
): ActionsRefreshDecision {
  const recordedVersion = endpoint?.actionsVersion ?? null;
  const needed = Boolean(endpoint?.mcpUrl) && recordedVersion !== TOOLSET_VERSION;
  return {
    needed,
    currentVersion: TOOLSET_VERSION,
    recordedVersion,
    connectorName,
    userMessage: needed
      ? `ChatX 的工具集已更新。请在「${connectorName}」连接器中刷新 Actions，完成后告诉我「好了」。`
      : undefined,
  };
}

/** Mark the ChatGPT-side connector as synchronized only after that UI work succeeded. */
export function confirmConnectorEndpoint(workspaceId: string, workspaceName: string): LastEndpoint | null {
  const previous = readLastEndpoint(workspaceId);
  if (!previous) return null;
  const connectorName = connectorNameFor({
    workspaceName,
    workspaceId,
    previousName: previous.connectorName,
    hadEndpointBefore: true,
  });
  const { savedAt: _savedAt, ...rest } = previous;
  return writeLastEndpoint({
    ...rest,
    connectorMcpUrl: previous.mcpUrl,
    connectorName,
    actionsVersion: TOOLSET_VERSION,
  });
}

export function reclaimUserMessage(connectorName: string): string {
  const visibleName = connectorDisplayName(connectorName) ?? DEFAULT_CONNECTOR_NAME;
  return `当前项目的安全连接地址已经失效。我会删除「${visibleName}」再按新地址加回去，其它项目的连接不动。请稍等。`;
}

export function reauthorizeUserMessage(connectorName: string): string {
  const visibleName = connectorDisplayName(connectorName) ?? DEFAULT_CONNECTOR_NAME;
  return `当前项目的 ChatGPT 授权已经失效，但连接地址仍然正常。我会删除「${visibleName}」再按原地址加回去，只重新完成这一个项目的授权，其它项目的连接不动。`;
}

export function brandMigrationUserMessage(connectorName: string): string {
  return `ChatX 已完成品牌升级。我会把当前项目的旧连接替换为「${connectorName}」，连接地址和其它项目的连接都不变。`;
}
