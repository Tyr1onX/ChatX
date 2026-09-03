import { IgnoreRules } from "./ignore.js";
import { runGit, type GitTarget } from "./git.js";

const DEFAULT_LOG_LIMIT = 20;
const MAX_LOG_LIMIT = 100;
const DEFAULT_SHOW_BYTES = 64 * 1024;
const MAX_SHOW_BYTES = 256 * 1024;
const MAX_SHOW_BODY_BYTES = 16 * 1024;
const MAX_AGGREGATE_DIFF_BYTES = 64 * 1024 * 1024;

export type GitHistoryErrorCode = "INVALID_GIT_REF" | "GIT_HISTORY_FAILED";

export class GitHistoryError extends Error {
  constructor(
    public readonly code: GitHistoryErrorCode,
    message: string
  ) {
    super(message);
    this.name = "GitHistoryError";
  }
}

export interface GitLogOptions {
  ref?: string;
  limit?: number;
  skip?: number;
}

export interface GitLogEntry {
  commit: string;
  shortCommit: string;
  author: string;
  authoredAt: string;
  subject: string;
}

export interface GitLogResult {
  isRepo: boolean;
  ref: string | null;
  path: string | null;
  skip: number;
  limit: number;
  hasMore: boolean;
  nextSkip: number | null;
  commits: GitLogEntry[];
}

export interface GitShowOptions {
  ref?: string;
  offset?: number;
  maxBytes?: number;
}

export interface GitChangedFile {
  status: string;
  path: string;
  oldPath?: string;
}

export interface GitShowResult {
  isRepo: boolean;
  commit: string | null;
  shortCommit: string | null;
  parents: string[];
  author: string | null;
  authoredAt: string | null;
  committer: string | null;
  committedAt: string | null;
  subject: string | null;
  body: string;
  bodyTruncated: boolean;
  path: string | null;
  changedFiles: GitChangedFile[];
  totalBytes: number;
  offset: number;
  returnedBytes: number;
  hasMore: boolean;
  nextOffset: number | null;
  diff: string;
}

interface NameStatusInventory {
  safePaths: string[];
  changedFiles: GitChangedFile[];
}

function rootOf(target: GitTarget): string {
  return typeof target === "string" ? target : target.root;
}

function ignoreRulesOf(target: GitTarget): IgnoreRules {
  if (typeof target === "object" && target.ignoreRules) return target.ignoreRules;
  return new IgnoreRules(rootOf(target));
}

function isRepo(root: string): boolean {
  const check = runGit(root, ["rev-parse", "--is-inside-work-tree"]);
  return check.ok && check.stdout.trim() === "true";
}

function resolveCommit(root: string, requestedRef: string): string {
  const ref = requestedRef.trim() || "HEAD";
  const result = runGit(root, ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`]);
  const commit = result.stdout.trim();
  if (!result.ok || !/^[0-9a-f]{40,64}$/i.test(commit)) {
    throw new GitHistoryError("INVALID_GIT_REF", `Git ref does not resolve to a commit: ${requestedRef}`);
  }
  return commit;
}

function inScope(filePath: string, scope?: string): boolean {
  if (!scope || scope === ".") return true;
  return filePath === scope || filePath.startsWith(scope + "/");
}

function parseNameStatusZ(
  output: string,
  ignoreRules: IgnoreRules,
  scope?: string
): NameStatusInventory {
  const tokens = output.split("\0");
  const safePaths: string[] = [];
  const changedFiles: GitChangedFile[] = [];

  for (let i = 0; i < tokens.length; ) {
    const status = tokens[i++];
    if (!status) break;
    if (status.startsWith("R") || status.startsWith("C")) {
      const oldPath = tokens[i++];
      const newPath = tokens[i++];
      if (!oldPath || !newPath) continue;
      const safe = !ignoreRules.isSensitive(oldPath) && !ignoreRules.isSensitive(newPath);
      const relevant = inScope(oldPath, scope) || inScope(newPath, scope);
      if (!safe || !relevant) continue;
      safePaths.push(oldPath, newPath);
      changedFiles.push({ status, oldPath, path: newPath });
      continue;
    }

    const filePath = tokens[i++];
    if (!filePath) continue;
    if (ignoreRules.isSensitive(filePath) || !inScope(filePath, scope)) continue;
    safePaths.push(filePath);
    changedFiles.push({ status, path: filePath });
  }

  return { safePaths: [...new Set(safePaths)], changedFiles };
}

function chunkSafePaths(paths: string[], maxCount = 50, maxBytes = 32 * 1024): string[][] {
  const batches: string[][] = [];
  let current: string[] = [];
  let bytes = 0;
  for (const filePath of paths) {
    const cost = Buffer.byteLength(filePath, "utf8") + 12;
    if (current.length > 0 && (current.length >= maxCount || bytes + cost > maxBytes)) {
      batches.push(current);
      current = [];
      bytes = 0;
    }
    current.push(filePath);
    bytes += cost;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

function sliceDiff(fullText: string, offsetInput: number | undefined, maxBytesInput: number | undefined) {
  const offset = Math.max(0, Math.floor(offsetInput ?? 0));
  const maxBytes = Math.min(
    MAX_SHOW_BYTES,
    Math.max(1024, Math.floor(maxBytesInput ?? DEFAULT_SHOW_BYTES))
  );
  const full = Buffer.from(fullText, "utf8");
  const slice = full.subarray(offset, offset + maxBytes);
  let text = slice.toString("utf8");
  let returnedBytes = slice.length;
  if (offset + returnedBytes < full.length) {
    const lastNewline = text.lastIndexOf("\n");
    if (lastNewline > 0) {
      text = text.slice(0, lastNewline + 1);
      returnedBytes = Buffer.byteLength(text, "utf8");
    }
  }
  const hasMore = offset + returnedBytes < full.length;
  return {
    totalBytes: full.length,
    offset,
    returnedBytes,
    hasMore,
    nextOffset: hasMore ? offset + returnedBytes : null,
    diff: text,
  };
}

function commitParents(root: string, commit: string): string[] {
  const result = runGit(root, ["rev-list", "--parents", "-n", "1", commit]);
  if (!result.ok) {
    throw new GitHistoryError("GIT_HISTORY_FAILED", result.stderr.trim() || "Failed to read commit parents.");
  }
  return result.stdout.trim().split(/\s+/).slice(1).filter(Boolean);
}

function changedInventory(root: string, commit: string, firstParent: string | undefined): string {
  const args = firstParent
    ? [
        "diff",
        "--name-status",
        "-z",
        "--find-renames=1%",
        "--relative",
        firstParent,
        commit,
        "--",
        ".",
      ]
    : [
        "diff-tree",
        "--root",
        "--no-commit-id",
        "-r",
        "--name-status",
        "-z",
        "--find-renames=1%",
        "--relative",
        commit,
        "--",
        ".",
      ];
  const result = runGit(root, args);
  if (!result.ok) {
    throw new GitHistoryError("GIT_HISTORY_FAILED", result.stderr.trim() || "Failed to enumerate commit changes.");
  }
  return result.stdout;
}

function safeCommitDiff(
  root: string,
  commit: string,
  firstParent: string | undefined,
  safePaths: string[]
): string {
  if (safePaths.length === 0) return "";
  let combined = "";
  let totalBytes = 0;

  for (const batch of chunkSafePaths(safePaths)) {
    const pathspecs = batch.map((filePath) => `:(literal)${filePath}`);
    const args = firstParent
      ? [
          "diff",
          "--no-color",
          "--find-renames=1%",
          "--relative",
          firstParent,
          commit,
          "--",
          ...pathspecs,
        ]
      : [
          "diff-tree",
          "--root",
          "--no-commit-id",
          "-r",
          "-p",
          "--no-color",
          "--find-renames=1%",
          "--relative",
          commit,
          "--",
          ...pathspecs,
        ];
    const result = runGit(root, args);
    if (!result.ok) {
      throw new GitHistoryError("GIT_HISTORY_FAILED", result.stderr.trim() || "Failed to render commit diff.");
    }
    const bytes = Buffer.byteLength(result.stdout, "utf8");
    if (totalBytes + bytes > MAX_AGGREGATE_DIFF_BYTES) {
      throw new GitHistoryError("GIT_HISTORY_FAILED", "Commit diff exceeds the safe aggregate size limit.");
    }
    combined += result.stdout;
    totalBytes += bytes;
  }
  return combined;
}

export function gitLog(
  target: GitTarget,
  opts: GitLogOptions = {},
  relPath?: string
): GitLogResult {
  const root = rootOf(target);
  const limit = Math.min(MAX_LOG_LIMIT, Math.max(1, Math.floor(opts.limit ?? DEFAULT_LOG_LIMIT)));
  const skip = Math.max(0, Math.floor(opts.skip ?? 0));
  if (!isRepo(root)) {
    return {
      isRepo: false,
      ref: null,
      path: relPath ?? null,
      skip,
      limit,
      hasMore: false,
      nextSkip: null,
      commits: [],
    };
  }

  const commit = resolveCommit(root, opts.ref ?? "HEAD");
  const pathspec = relPath ? `:(literal)${relPath}` : ".";
  const result = runGit(root, [
    "log",
    `--max-count=${limit + 1}`,
    `--skip=${skip}`,
    "--format=%H%x1f%h%x1f%an%x1f%aI%x1f%s%x1e",
    commit,
    "--",
    pathspec,
  ]);
  if (!result.ok) {
    throw new GitHistoryError("GIT_HISTORY_FAILED", result.stderr.trim() || "Failed to read git log.");
  }

  const parsed: GitLogEntry[] = [];
  for (const rawRecord of result.stdout.split("\x1e")) {
    const record = rawRecord.replace(/^\s+|\s+$/g, "");
    if (!record) continue;
    const fields = record.split("\x1f");
    if (fields.length < 5) continue;
    parsed.push({
      commit: fields[0],
      shortCommit: fields[1],
      author: fields[2],
      authoredAt: fields[3],
      subject: fields.slice(4).join("\x1f"),
    });
  }
  const hasMore = parsed.length > limit;
  const commits = parsed.slice(0, limit);
  return {
    isRepo: true,
    ref: commit,
    path: relPath ?? null,
    skip,
    limit,
    hasMore,
    nextSkip: hasMore ? skip + commits.length : null,
    commits,
  };
}

export function gitShow(
  target: GitTarget,
  opts: GitShowOptions = {},
  relPath?: string
): GitShowResult {
  const root = rootOf(target);
  const empty = (isRepository: boolean): GitShowResult => ({
    isRepo: isRepository,
    commit: null,
    shortCommit: null,
    parents: [],
    author: null,
    authoredAt: null,
    committer: null,
    committedAt: null,
    subject: null,
    body: "",
    bodyTruncated: false,
    path: relPath ?? null,
    changedFiles: [],
    totalBytes: 0,
    offset: 0,
    returnedBytes: 0,
    hasMore: false,
    nextOffset: null,
    diff: "",
  });
  if (!isRepo(root)) return empty(false);

  const commit = resolveCommit(root, opts.ref ?? "HEAD");
  const metadata = runGit(root, [
    "show",
    "-s",
    "--format=%H%x00%h%x00%an%x00%aI%x00%cn%x00%cI%x00%s%x00%b",
    commit,
  ]);
  if (!metadata.ok) {
    throw new GitHistoryError("GIT_HISTORY_FAILED", metadata.stderr.trim() || "Failed to read commit metadata.");
  }
  const fields = metadata.stdout.split("\0");
  if (fields.length < 8) {
    throw new GitHistoryError("GIT_HISTORY_FAILED", "Git returned incomplete commit metadata.");
  }

  const parents = commitParents(root, commit);
  const firstParent = parents[0];
  const inventory = parseNameStatusZ(
    changedInventory(root, commit, firstParent),
    ignoreRulesOf(target),
    relPath
  );
  const fullDiff = safeCommitDiff(root, commit, firstParent, inventory.safePaths);
  const page = sliceDiff(fullDiff, opts.offset, opts.maxBytes);

  const rawBody = fields.slice(7).join("\0").trimEnd();
  const bodyBuffer = Buffer.from(rawBody, "utf8");
  const bodyTruncated = bodyBuffer.length > MAX_SHOW_BODY_BYTES;
  const body = bodyTruncated
    ? bodyBuffer.subarray(0, MAX_SHOW_BODY_BYTES).toString("utf8")
    : rawBody;

  return {
    isRepo: true,
    commit: fields[0],
    shortCommit: fields[1],
    parents,
    author: fields[2],
    authoredAt: fields[3],
    committer: fields[4],
    committedAt: fields[5],
    subject: fields[6],
    body,
    bodyTruncated,
    path: relPath ?? null,
    changedFiles: inventory.changedFiles,
    ...page,
  };
}
