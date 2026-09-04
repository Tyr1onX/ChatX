import fs from "node:fs";
import path from "node:path";
import { ensureDir, getStateDir, writeSecureJson } from "../config/paths.js";
import { Workspace, workspaceIdForCanonicalRoot } from "./manager.js";

export type WorkspaceMigrationErrorCode =
  | "TARGET_OUTSIDE_PARENT"
  | "TARGET_EXISTS"
  | "STATE_CONFLICT"
  | "STATE_INVALID"
  | "MIGRATION_FAILED";

export class WorkspaceMigrationError extends Error {
  constructor(public code: WorkspaceMigrationErrorCode, message: string) {
    super(message);
    this.name = "WorkspaceMigrationError";
  }
}

export interface WorkspaceMigrationResult {
  oldRoot: string;
  newRoot: string;
  oldWorkspaceId: string;
  newWorkspaceId: string;
  migratedState: string[];
}

type PreparedState = {
  name: string;
  source: string;
  target: string;
  json?: unknown;
  raw?: Buffer;
};

function samePath(a: string, b: string): boolean {
  return process.platform === "win32" || process.platform === "darwin"
    ? a.toLowerCase() === b.toLowerCase()
    : a === b;
}

function parseJsonState(file: string, mutate: (value: Record<string, unknown>) => void): unknown {
  let value: unknown;
  try {
    value = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    throw new WorkspaceMigrationError("STATE_INVALID", `Cannot migrate invalid state file: ${file}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WorkspaceMigrationError("STATE_INVALID", `Cannot migrate invalid state file: ${file}`);
  }
  mutate(value as Record<string, unknown>);
  return value;
}

function prepareState(oldId: string, newId: string): PreparedState[] {
  const root = getStateDir();
  const prepared: PreparedState[] = [];
  const addJson = (
    name: string,
    dir: string,
    mutate: (value: Record<string, unknown>) => void = () => undefined
  ): void => {
    const source = path.join(root, dir, `${oldId}.json`);
    if (!fs.existsSync(source)) return;
    const target = path.join(root, dir, `${newId}.json`);
    if (fs.existsSync(target)) {
      throw new WorkspaceMigrationError("STATE_CONFLICT", `Target workspace state already exists: ${target}`);
    }
    prepared.push({ name, source, target, json: parseJsonState(source, mutate) });
  };

  addJson("auth", "auth", (value) => {
    const tokens = Array.isArray(value.tokens) ? value.tokens : [];
    value.tokens = tokens.map((token) =>
      token && typeof token === "object" && !Array.isArray(token)
        ? { ...(token as Record<string, unknown>), workspaceId: newId }
        : token
    );
  });
  addJson("endpoint", "endpoints", (value) => {
    value.workspaceId = newId;
  });
  addJson("session", "sessions");
  addJson("tunnel", "tunnels", (value) => {
    value.workspaceId = newId;
  });

  const executionSource = path.join(root, "executions", `${oldId}.jsonl`);
  if (fs.existsSync(executionSource)) {
    const executionTarget = path.join(root, "executions", `${newId}.jsonl`);
    if (fs.existsSync(executionTarget)) {
      throw new WorkspaceMigrationError("STATE_CONFLICT", `Target workspace state already exists: ${executionTarget}`);
    }
    prepared.push({
      name: "executions",
      source: executionSource,
      target: executionTarget,
      raw: fs.readFileSync(executionSource),
    });
  }

  return prepared;
}

/**
 * Rename one workspace within its current parent and migrate only durable
 * workspace-id keyed state. The caller must stop the bridge first; runtime
 * PID state is intentionally not migrated.
 */
export function migrateWorkspaceDirectory(
  sourceRoot: string,
  targetInput = "ChatX-Workspace"
): WorkspaceMigrationResult {
  const source = new Workspace(sourceRoot);
  const parent = path.dirname(source.root);
  const target = path.isAbsolute(targetInput)
    ? path.resolve(targetInput)
    : path.resolve(parent, targetInput);
  const targetParent = fs.realpathSync.native(path.dirname(target));

  if (!samePath(targetParent, parent)) {
    throw new WorkspaceMigrationError(
      "TARGET_OUTSIDE_PARENT",
      "Workspace rename only supports a sibling directory in the same parent."
    );
  }
  if (fs.existsSync(target)) {
    throw new WorkspaceMigrationError("TARGET_EXISTS", `Target workspace already exists: ${target}`);
  }

  const canonicalTarget = path.join(targetParent, path.basename(target));
  const newId = workspaceIdForCanonicalRoot(canonicalTarget);
  const prepared = prepareState(source.id, newId);
  const createdState: string[] = [];
  const sourceBackups: Array<{ source: string; backup: string }> = [];
  let renamed = false;

  try {
    fs.renameSync(source.root, target);
    renamed = true;

    for (const state of prepared) {
      if (state.json !== undefined) {
        writeSecureJson(state.target, state.json);
      } else if (state.raw) {
        ensureDir(path.dirname(state.target));
        fs.writeFileSync(state.target, state.raw, { mode: 0o600 });
        try { fs.chmodSync(state.target, 0o600); } catch { /* best effort */ }
      }
      createdState.push(state.target);
    }

    const migrated = new Workspace(target);
    if (migrated.id !== newId) {
      throw new Error(`Workspace id mismatch after rename (${newId} != ${migrated.id})`);
    }

    const backupTag = `${process.pid}-${Date.now()}`;
    for (const [index, state] of prepared.entries()) {
      const backup = `${state.source}.chatx-migrate-${backupTag}-${index}`;
      fs.renameSync(state.source, backup);
      sourceBackups.push({ source: state.source, backup });
    }

    // The new workspace and its new-id state are committed at this point.
    // Cleanup failure must not roll back and destroy already-moved source state.
    for (const { backup } of sourceBackups) {
      try { fs.rmSync(backup, { force: true }); } catch { /* stale backup is safer than data loss */ }
    }

    return {
      oldRoot: source.root,
      newRoot: migrated.root,
      oldWorkspaceId: source.id,
      newWorkspaceId: migrated.id,
      migratedState: prepared.map((state) => state.name),
    };
  } catch (error) {
    for (const { source: original, backup } of sourceBackups.reverse()) {
      if (fs.existsSync(backup) && !fs.existsSync(original)) {
        try { fs.renameSync(backup, original); } catch { /* best effort */ }
      }
    }
    for (const file of createdState) {
      try { fs.rmSync(file, { force: true }); } catch { /* best effort */ }
    }
    if (renamed && fs.existsSync(target) && !fs.existsSync(source.root)) {
      try { fs.renameSync(target, source.root); } catch { /* best effort */ }
    }
    if (error instanceof WorkspaceMigrationError) throw error;
    throw new WorkspaceMigrationError(
      "MIGRATION_FAILED",
      error instanceof Error ? error.message : String(error)
    );
  }
}
