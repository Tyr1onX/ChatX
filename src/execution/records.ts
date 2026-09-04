import fs from "node:fs";
import path from "node:path";
import { ensureDir, getStateDir } from "../config/paths.js";

/**
 * Lightweight execution records written by the Codex harness after each
 * iteration (via `chatx record`). ChatGPT reads them through the
 * `execution_summary` and `test_status` MCP tools.
 */
export interface ExecutionRecord {
  taskId: string;
  iteration: number;
  changedFiles: string[] | number;
  tests: string | null;
  exitStatus: "ok" | "failed" | "blocked" | string;
  timestamp: string;
  notes?: string;
}

function recordsFile(workspaceId: string): string {
  const dir = ensureDir(path.join(getStateDir(), "executions"));
  return path.join(dir, `${workspaceId}.jsonl`);
}

export function appendExecutionRecord(workspaceId: string, record: ExecutionRecord): void {
  const file = recordsFile(workspaceId);
  fs.appendFileSync(file, JSON.stringify(record) + "\n", { mode: 0o600 });
}

export function readExecutionRecords(workspaceId: string, limit = 10): ExecutionRecord[] {
  const file = recordsFile(workspaceId);
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean);
  const records: ExecutionRecord[] = [];
  for (const line of lines.slice(-limit)) {
    try {
      records.push(JSON.parse(line) as ExecutionRecord);
    } catch {
      // skip corrupt lines
    }
  }
  return records;
}

export function latestExecutionRecord(workspaceId: string): ExecutionRecord | null {
  const records = readExecutionRecords(workspaceId, 1);
  return records[records.length - 1] ?? null;
}
