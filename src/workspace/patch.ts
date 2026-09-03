import fs from "node:fs";
import { Workspace, WorkspaceError } from "./manager.js";

const MAX_PATCH_FILE_BYTES = 2 * 1024 * 1024;

export type WorkspacePatchErrorCode =
  | "INVALID_PATCH"
  | "PATCH_CONFLICT"
  | "PATCH_WRITE_FAILED";

export class WorkspacePatchError extends Error {
  constructor(
    public readonly code: WorkspacePatchErrorCode,
    message: string
  ) {
    super(message);
    this.name = "WorkspacePatchError";
  }
}

export interface WorkspacePatchEdit {
  path: string;
  oldText: string;
  newText: string;
  expectedOccurrences?: number;
}

export interface WorkspacePatchResult {
  editCount: number;
  files: Array<{
    path: string;
    replacements: number;
    beforeBytes: number;
    afterBytes: number;
  }>;
}

interface PendingFile {
  abs: string;
  rel: string;
  before: string;
  after: string;
  replacements: number;
}

function countOccurrences(text: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let offset = 0;
  while (offset <= text.length - needle.length) {
    const index = text.indexOf(needle, offset);
    if (index === -1) break;
    count++;
    offset = index + needle.length;
  }
  return count;
}

function replaceExact(text: string, needle: string, replacement: string): string {
  return text.split(needle).join(replacement);
}

async function loadPendingFile(workspace: Workspace, requestedPath: string): Promise<PendingFile> {
  const target = workspace.resolve(requestedPath);
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(target.abs);
  } catch {
    throw new WorkspaceError("FILE_NOT_FOUND", `File not found: ${target.rel}`);
  }
  if (!stat.isFile()) {
    throw new WorkspaceError("NOT_A_FILE", `Not a regular file: ${target.rel}`);
  }
  if (stat.size > MAX_PATCH_FILE_BYTES) {
    throw new WorkspaceError(
      "FILE_TOO_LARGE",
      `File is too large to patch safely (${stat.size} bytes): ${target.rel}`
    );
  }

  const before = await fs.promises.readFile(target.abs, "utf8");
  if (before.includes("\0")) {
    throw new WorkspaceError("BINARY_FILE", `Binary file (${stat.size} bytes): ${target.rel}`);
  }
  return { abs: target.abs, rel: target.rel, before, after: before, replacements: 0 };
}

/**
 * Apply exact-text edits to workspace files.
 *
 * All edits are validated in memory before the first write. Each oldText must
 * match exactly expectedOccurrences times (default: once), so stale or
 * ambiguous model context fails closed instead of modifying the wrong region.
 * If a disk write fails after validation, already-written files are restored
 * from their in-memory originals on a best-effort basis.
 */
export async function applyWorkspacePatch(
  workspace: Workspace,
  edits: WorkspacePatchEdit[]
): Promise<WorkspacePatchResult> {
  if (edits.length === 0) {
    throw new WorkspacePatchError("INVALID_PATCH", "At least one edit is required.");
  }

  const pending = new Map<string, PendingFile>();

  for (const [index, edit] of edits.entries()) {
    if (edit.oldText.length === 0) {
      throw new WorkspacePatchError(
        "INVALID_PATCH",
        `Edit ${index + 1} has empty old_text. Use write_file to create or fully replace a file.`
      );
    }

    const expected = edit.expectedOccurrences ?? 1;
    if (!Number.isInteger(expected) || expected < 1 || expected > 20) {
      throw new WorkspacePatchError(
        "INVALID_PATCH",
        `Edit ${index + 1} has invalid expected_occurrences; use an integer from 1 to 20.`
      );
    }

    const target = workspace.resolve(edit.path);
    let file = pending.get(target.abs);
    if (!file) {
      file = await loadPendingFile(workspace, edit.path);
      pending.set(target.abs, file);
    }

    const actual = countOccurrences(file.after, edit.oldText);
    if (actual !== expected) {
      throw new WorkspacePatchError(
        "PATCH_CONFLICT",
        `Edit ${index + 1} for '${file.rel}' expected ${expected} exact occurrence(s), found ${actual}. Re-read the relevant lines and retry.`
      );
    }

    file.after = replaceExact(file.after, edit.oldText, edit.newText);
    file.replacements += actual;

    const afterBytes = Buffer.byteLength(file.after, "utf8");
    if (afterBytes > MAX_PATCH_FILE_BYTES) {
      throw new WorkspaceError(
        "FILE_TOO_LARGE",
        `Patched file would exceed ${MAX_PATCH_FILE_BYTES} bytes: ${file.rel}`
      );
    }
  }

  const changed = [...pending.values()].filter((file) => file.after !== file.before);
  const written: PendingFile[] = [];
  try {
    for (const file of changed) {
      await fs.promises.writeFile(file.abs, file.after, { encoding: "utf8", flag: "w" });
      written.push(file);
    }
  } catch (error) {
    await Promise.allSettled(
      written.map((file) => fs.promises.writeFile(file.abs, file.before, { encoding: "utf8", flag: "w" }))
    );
    throw new WorkspacePatchError(
      "PATCH_WRITE_FAILED",
      error instanceof Error ? error.message : String(error)
    );
  }

  return {
    editCount: edits.length,
    files: [...pending.values()].map((file) => ({
      path: file.rel,
      replacements: file.replacements,
      beforeBytes: Buffer.byteLength(file.before, "utf8"),
      afterBytes: Buffer.byteLength(file.after, "utf8"),
    })),
  };
}
