import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { Workspace } from "./manager.js";

export interface SearchOptions {
  query: string;
  path?: string;
  glob?: string;
  limit?: number;
  regex?: boolean;
  contextBefore?: number;
  contextAfter?: number;
}

export interface SearchContextLine {
  line: number;
  text: string;
}

export interface SearchMatch {
  path: string;
  line: number;
  text: string;
  before?: SearchContextLine[];
  after?: SearchContextLine[];
}

export interface SearchResult {
  matches: SearchMatch[];
  matchCount: number;
  truncated: boolean;
  engine: "ripgrep" | "node";
  contextBefore?: number;
  contextAfter?: number;
  contextBytes?: number;
  maxContextBytes?: number;
  contextSourceBytes?: number;
  maxContextSourceBytes?: number;
  contextTruncated?: boolean;
}

const MAX_CONTEXT_LINES = 3;
const MAX_CONTEXT_BYTES = 128 * 1024;
const MAX_CONTEXT_SOURCE_BYTES = 16 * 1024 * 1024;
const MAX_CONTEXT_LINE_CHARS = 500;

const RG_CANDIDATES = [
  "rg",
  "/opt/homebrew/bin/rg",
  "/usr/local/bin/rg",
  "/usr/bin/rg",
  "/Applications/Cursor.app/Contents/Resources/app/node_modules/@vscode/ripgrep/bin/rg",
  "/Applications/Visual Studio Code.app/Contents/Resources/app/node_modules/@vscode/ripgrep/bin/rg",
];

let cachedRg: string | null | undefined;

export function findRipgrep(): string | null {
  if ((process.env.CHATX_DISABLE_RG ?? process.env.C2C_DISABLE_RG) === "1") return null;
  if (cachedRg !== undefined) return cachedRg;
  const rgOverride = process.env.CHATX_RG_PATH ?? process.env.C2C_RG_PATH;
  if (rgOverride) {
    cachedRg = rgOverride;
    return cachedRg;
  }
  for (const candidate of RG_CANDIDATES) {
    try {
      const result = spawnSync(candidate, ["--version"], { stdio: "ignore", timeout: 3000, windowsHide: true });
      if (result.status === 0) {
        cachedRg = candidate;
        return candidate;
      }
    } catch {
      // try next candidate
    }
  }
  cachedRg = null;
  return null;
}

/** For tests. */
export function resetRipgrepCache(): void {
  cachedRg = undefined;
}

async function searchWithRipgrep(
  ws: Workspace,
  rgBin: string,
  searchAbs: string,
  opts: SearchOptions,
  limit: number
): Promise<SearchResult> {
  const args = ["--json", "--max-filesize", "2M", "--max-count", "20"];
  if (!opts.regex) args.push("-F");
  args.push("--smart-case");
  if (opts.glob) args.push("-g", opts.glob);
  args.push("--", opts.query, searchAbs);

  return new Promise((resolvePromise, reject) => {
    const child = spawn(rgBin, args, { cwd: ws.root, windowsHide: true });
    const matches: SearchMatch[] = [];
    let truncated = false;
    const rl = readline.createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      try {
        const event = JSON.parse(line) as {
          type: string;
          data?: { path?: { text?: string }; line_number?: number; lines?: { text?: string } };
        };
        if (event.type !== "match" || !event.data?.path?.text) return;
        const rel = path.relative(ws.root, event.data.path.text).split(path.sep).join("/");
        if (rel.startsWith("..") || ws.ignoreRules.isHidden(rel)) return;
        if (matches.length >= limit) {
          truncated = true;
          child.kill("SIGTERM");
          return;
        }
        matches.push({
          path: rel,
          line: event.data.line_number ?? 0,
          text: (event.data.lines?.text ?? "").trimEnd().slice(0, 500),
        });
      } catch {
        // ignore malformed json lines
      }
    });
    child.on("error", reject);
    child.on("close", () => {
      resolvePromise({ matches, matchCount: matches.length, truncated, engine: "ripgrep" });
    });
  });
}

async function searchWithNode(
  ws: Workspace,
  searchAbs: string,
  opts: SearchOptions,
  limit: number
): Promise<SearchResult> {
  const matcher = opts.regex ? new RegExp(opts.query, "i") : null;
  const needle = opts.query.toLowerCase();
  const globRegex = opts.glob ? globToRegex(opts.glob) : null;
  const matches: SearchMatch[] = [];
  let truncated = false;

  const walk = async (dirAbs: string, dirRel: string): Promise<void> => {
    if (truncated) return;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (truncated) return;
      const childRel = dirRel ? `${dirRel}/${entry.name}` : entry.name;
      if (ws.ignoreRules.isHidden(childRel) || ws.ignoreRules.isHidden(childRel + "/")) continue;
      const childAbs = path.join(dirAbs, entry.name);
      if (entry.isDirectory()) {
        await walk(childAbs, childRel);
      } else if (entry.isFile()) {
        if (globRegex && !globRegex.test(childRel)) continue;
        let stat: fs.Stats;
        try {
          stat = await fs.promises.stat(childAbs);
        } catch {
          continue;
        }
        if (stat.size > 2 * 1024 * 1024) continue;
        let content: string;
        try {
          content = await fs.promises.readFile(childAbs, "utf8");
        } catch {
          continue;
        }
        if (content.includes("\0")) continue;
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const hit = matcher ? matcher.test(line) : line.toLowerCase().includes(needle);
          if (hit) {
            if (matches.length >= limit) {
              truncated = true;
              return;
            }
            matches.push({ path: childRel, line: i + 1, text: line.trimEnd().slice(0, 500) });
          }
        }
      }
    }
  };

  const startRel = path.relative(ws.root, searchAbs).split(path.sep).join("/");
  await walk(searchAbs, startRel === "" ? "" : startRel);
  return { matches, matchCount: matches.length, truncated, engine: "node" };
}

async function attachSearchContext(
  ws: Workspace,
  result: SearchResult,
  contextBefore: number,
  contextAfter: number
): Promise<SearchResult> {
  if (contextBefore === 0 && contextAfter === 0) return result;

  const cache = new Map<string, string[] | null>();
  let contextBytes = 0;
  let contextSourceBytes = 0;
  let contextTruncated = false;
  let budgetExhausted = false;

  const readLines = async (relPath: string): Promise<string[] | null> => {
    if (cache.has(relPath)) return cache.get(relPath) ?? null;
    try {
      const target = ws.resolve(relPath);
      const stat = await fs.promises.stat(target.abs);
      if (!stat.isFile() || stat.size > 2 * 1024 * 1024) {
        cache.set(relPath, null);
        return null;
      }
      if (contextSourceBytes + stat.size > MAX_CONTEXT_SOURCE_BYTES) {
        contextTruncated = true;
        budgetExhausted = true;
        cache.set(relPath, null);
        return null;
      }
      const content = await fs.promises.readFile(target.abs, "utf8");
      contextSourceBytes += stat.size;
      if (content.includes("\0")) {
        cache.set(relPath, null);
        return null;
      }
      const lines = content.split(/\r?\n/);
      cache.set(relPath, lines);
      return lines;
    } catch {
      cache.set(relPath, null);
      return null;
    }
  };

  const appendLines = (
    target: SearchContextLine[],
    source: string[],
    startIndex: number,
    endIndexExclusive: number
  ): void => {
    for (let i = startIndex; i < endIndexExclusive; i++) {
      if (budgetExhausted) return;
      const text = (source[i] ?? "").trimEnd().slice(0, MAX_CONTEXT_LINE_CHARS);
      const cost = Buffer.byteLength(text, "utf8") + 1;
      if (contextBytes + cost > MAX_CONTEXT_BYTES) {
        contextTruncated = true;
        budgetExhausted = true;
        return;
      }
      target.push({ line: i + 1, text });
      contextBytes += cost;
    }
  };

  for (const match of result.matches) {
    if (budgetExhausted) break;
    const lines = await readLines(match.path);
    if (!lines || match.line < 1) continue;
    const matchIndex = match.line - 1;

    if (contextBefore > 0) {
      const before: SearchContextLine[] = [];
      appendLines(before, lines, Math.max(0, matchIndex - contextBefore), matchIndex);
      if (before.length > 0) match.before = before;
    }
    if (contextAfter > 0 && !budgetExhausted) {
      const after: SearchContextLine[] = [];
      appendLines(after, lines, matchIndex + 1, Math.min(lines.length, matchIndex + 1 + contextAfter));
      if (after.length > 0) match.after = after;
    }
  }

  return {
    ...result,
    contextBefore,
    contextAfter,
    contextBytes,
    maxContextBytes: MAX_CONTEXT_BYTES,
    contextSourceBytes,
    maxContextSourceBytes: MAX_CONTEXT_SOURCE_BYTES,
    contextTruncated,
  };
}

export function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]]/g, "\\$&")
    .replace(/\*\*\//g, "\u0000")
    .replace(/\*\*/g, "\u0001")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/\u0000/g, "(?:.*/)?")
    .replace(/\u0001/g, ".*");
  return new RegExp(`(^|/)${escaped}$`, "i");
}

export async function searchWorkspace(ws: Workspace, opts: SearchOptions): Promise<SearchResult> {
  const contextBefore = Math.min(MAX_CONTEXT_LINES, Math.max(0, Math.floor(opts.contextBefore ?? 0)));
  const contextAfter = Math.min(MAX_CONTEXT_LINES, Math.max(0, Math.floor(opts.contextAfter ?? 0)));
  if (!opts.query || opts.query.length < 2) {
    return attachSearchContext(
      ws,
      { matches: [], matchCount: 0, truncated: false, engine: "node" },
      contextBefore,
      contextAfter
    );
  }
  const limit = Math.min(200, Math.max(1, Math.floor(opts.limit ?? 50)));
  const { abs } = ws.resolve(opts.path ?? ".");
  const rg = findRipgrep();
  if (rg) {
    try {
      const result = await searchWithRipgrep(ws, rg, abs, opts, limit);
      return attachSearchContext(ws, result, contextBefore, contextAfter);
    } catch {
      // fall through to node engine
    }
  }
  const result = await searchWithNode(ws, abs, opts, limit);
  return attachSearchContext(ws, result, contextBefore, contextAfter);
}
