import fs from "node:fs";
import path from "node:path";
import { Workspace, WorkspaceError } from "./manager.js";
import { globToRegex } from "./search.js";

const DEFAULT_FIND_LIMIT = 100;
const MAX_FIND_LIMIT = 500;
const MAX_SCANNED_ENTRIES = 100_000;

export interface FindFilesOptions {
  path?: string;
  pattern?: string;
  limit?: number;
  offset?: number;
}

export interface FoundFile {
  path: string;
  sizeBytes: number;
}

export interface FindFilesResult {
  path: string;
  pattern: string;
  offset: number;
  limit: number;
  returned: number;
  hasMore: boolean;
  nextOffset: number | null;
  scanTruncated: boolean;
  scannedEntries: number;
  files: FoundFile[];
}

export async function findWorkspaceFiles(
  workspace: Workspace,
  opts: FindFilesOptions = {}
): Promise<FindFilesResult> {
  const target = workspace.resolve(opts.path ?? ".");
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(target.abs);
  } catch {
    throw new WorkspaceError("FILE_NOT_FOUND", `Directory not found: ${target.rel || "."}`);
  }
  if (!stat.isDirectory()) {
    throw new WorkspaceError("NOT_A_DIRECTORY", `Not a directory: ${target.rel}`);
  }

  const pattern = opts.pattern?.trim() || "**/*";
  const matcher = globToRegex(pattern);
  const limit = Math.min(MAX_FIND_LIMIT, Math.max(1, Math.floor(opts.limit ?? DEFAULT_FIND_LIMIT)));
  const offset = Math.max(0, Math.floor(opts.offset ?? 0));
  const collected: FoundFile[] = [];
  let matched = 0;
  let scannedEntries = 0;
  let scanTruncated = false;
  let foundExtra = false;

  const walk = async (dirAbs: string, dirRel: string): Promise<void> => {
    if (scanTruncated || foundExtra) return;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (scanTruncated || foundExtra) return;
      scannedEntries++;
      if (scannedEntries > MAX_SCANNED_ENTRIES) {
        scanTruncated = true;
        return;
      }

      const childRel = dirRel ? `${dirRel}/${entry.name}` : entry.name;
      if (workspace.ignoreRules.isHidden(childRel) || workspace.ignoreRules.isHidden(childRel + "/")) {
        continue;
      }
      const childAbs = path.join(dirAbs, entry.name);

      if (entry.isDirectory()) {
        await walk(childAbs, childRel);
        continue;
      }
      if (!entry.isFile() || !matcher.test(childRel)) continue;

      if (matched >= offset) {
        if (collected.length >= limit) {
          foundExtra = true;
          return;
        }
        let sizeBytes = 0;
        try {
          sizeBytes = (await fs.promises.stat(childAbs)).size;
        } catch {
          continue;
        }
        collected.push({ path: childRel, sizeBytes });
      }
      matched++;
    }
  };

  await walk(target.abs, target.rel);
  return {
    path: target.rel || ".",
    pattern,
    offset,
    limit,
    returned: collected.length,
    hasMore: foundExtra,
    nextOffset: foundExtra ? offset + collected.length : null,
    scanTruncated,
    scannedEntries,
    files: collected,
  };
}
