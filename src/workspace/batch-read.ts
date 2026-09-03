import { Workspace, WorkspaceError, type ReadFileResult } from "./manager.js";

const MAX_BATCH_FILES = 20;
const MAX_PER_FILE_BYTES = 128 * 1024;
const MAX_BATCH_CONTENT_BYTES = 512 * 1024;

export interface BatchReadRequest {
  path: string;
  startLine?: number;
  endLine?: number;
}

export type BatchReadItem =
  | ({ ok: true; batchTruncated: boolean } & ReadFileResult)
  | { ok: false; path: string; error: string; message: string };

export interface BatchReadResult {
  requested: number;
  processed: number;
  omitted: number;
  totalContentBytes: number;
  maxTotalContentBytes: number;
  truncated: boolean;
  files: BatchReadItem[];
}

function truncateUtf8(text: string, maxBytes: number): string {
  const buffer = Buffer.from(text, "utf8");
  if (buffer.length <= maxBytes) return text;
  let end = maxBytes;
  while (end > 0 && (buffer[end] & 0xc0) === 0x80) end--;
  return buffer.subarray(0, end).toString("utf8");
}

export async function readWorkspaceFiles(
  workspace: Workspace,
  requests: BatchReadRequest[]
): Promise<BatchReadResult> {
  const limitedRequests = requests.slice(0, MAX_BATCH_FILES);
  const files: BatchReadItem[] = [];
  let totalContentBytes = 0;
  let omitted = Math.max(0, requests.length - limitedRequests.length);
  let truncated = omitted > 0;

  for (let index = 0; index < limitedRequests.length; index++) {
    const request = limitedRequests[index];
    const remaining = MAX_BATCH_CONTENT_BYTES - totalContentBytes;
    if (remaining < 1024) {
      omitted += limitedRequests.length - index;
      truncated = true;
      break;
    }

    try {
      const result = await workspace.readFile(request.path, {
        startLine: request.startLine,
        endLine: request.endLine,
        maxBytes: Math.min(MAX_PER_FILE_BYTES, remaining),
      });
      const allowedBytes = Math.min(MAX_PER_FILE_BYTES, remaining);
      const originalContentBytes = Buffer.byteLength(result.content, "utf8");
      const content = truncateUtf8(result.content, allowedBytes);
      const contentBytes = Buffer.byteLength(content, "utf8");
      const batchTruncated = contentBytes < originalContentBytes;
      totalContentBytes += contentBytes;
      truncated ||= result.truncated || batchTruncated;
      files.push({
        ok: true,
        ...result,
        content,
        truncated: result.truncated || batchTruncated,
        batchTruncated,
      });
    } catch (error) {
      if (error instanceof WorkspaceError) {
        files.push({
          ok: false,
          path: request.path,
          error: error.code,
          message: error.message,
        });
        continue;
      }
      throw error;
    }
  }

  return {
    requested: requests.length,
    processed: files.length,
    omitted,
    totalContentBytes,
    maxTotalContentBytes: MAX_BATCH_CONTENT_BYTES,
    truncated,
    files,
  };
}
