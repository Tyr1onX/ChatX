import fs from "node:fs";
import path from "node:path";
import { ensureDir, getStateDir, readJsonIfExists, writeSecureJson } from "../config/paths.js";
import { SERVICE_NAME, VERSION } from "../version.js";

/**
 * Runtime state file: how the CLI/Skill finds a running bridge for a
 * workspace. Contains the admin token, so it is 0600 and lives in the user
 * state dir, never in the project.
 */
export interface RuntimeState {
  service: string;
  version: string;
  workspaceId: string;
  workspaceRoot: string;
  pid: number;
  port: number;
  adminToken: string;
  publicUrl: string | null;
  startedAt: string;
  instanceId?: string;
}

export function runtimeFile(workspaceId: string): string {
  return path.join(ensureDir(path.join(getStateDir(), "runtime")), `${workspaceId}.json`);
}

export function writeRuntimeState(state: RuntimeState): void {
  writeSecureJson(runtimeFile(state.workspaceId), state);
}

export function readRuntimeState(workspaceId: string): RuntimeState | null {
  return readJsonIfExists<RuntimeState>(runtimeFile(workspaceId));
}

export function clearRuntimeState(workspaceId: string): void {
  try {
    fs.rmSync(runtimeFile(workspaceId), { force: true });
  } catch {
    // ignore
  }
}

export interface HealthPayload {
  service: string;
  version: string;
  workspaceId: string;
  status: string;
  instanceId?: string;
}

export function isBridgeHealthPayload(
  value: unknown,
  workspaceId?: string,
  instanceId?: string
): value is HealthPayload {
  if (!value || typeof value !== "object") return false;
  const body = value as Partial<HealthPayload>;
  return (
    body.service === SERVICE_NAME &&
    body.status === "ok" &&
    typeof body.version === "string" &&
    typeof body.workspaceId === "string" &&
    (body.instanceId === undefined || typeof body.instanceId === "string") &&
    (workspaceId === undefined || body.workspaceId === workspaceId) &&
    (instanceId === undefined || body.instanceId === instanceId)
  );
}

export async function probeBridgeHealth(
  baseUrl: string,
  workspaceId?: string,
  timeoutMs = 2000,
  instanceId?: string
): Promise<HealthPayload | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/health`, { signal: controller.signal });
      if (!response.ok) return null;
      const body = (await response.json()) as unknown;
      const expectedInstanceId = instanceId ?? (workspaceId ? readRuntimeState(workspaceId)?.instanceId : undefined);
      return isBridgeHealthPayload(body, workspaceId, expectedInstanceId) ? body : null;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

/** Probe a port and check whether a healthy ChatX bridge answers. */
export async function probeBridge(
  port: number,
  timeoutMs = 2000
): Promise<HealthPayload | null> {
  return probeBridgeHealth(`http://127.0.0.1:${port}`, undefined, timeoutMs);
}

export async function findLiveBridge(workspaceId: string): Promise<RuntimeState | null> {
  const state = readRuntimeState(workspaceId);
  if (!state) return null;
  const health = await probeBridge(state.port);
  if (health && health.workspaceId === workspaceId) return state;
  return null;
}

export { SERVICE_NAME, VERSION };
