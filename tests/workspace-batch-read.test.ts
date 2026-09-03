import { describe, expect, it } from "vitest";
import { Workspace } from "../src/workspace/manager.js";
import { readWorkspaceFiles } from "../src/workspace/batch-read.js";
import { cleanup, makeTmpDir, write } from "./helpers.js";

describe("workspace batch reads", () => {
  it("reads multiple files and keeps per-file errors isolated", async () => {
    const root = makeTmpDir("batch-read");
    try {
      write(root, "a.txt", "a1\na2\na3\n");
      write(root, "b.txt", "b1\nb2\n");
      write(root, ".env", "SECRET=batch-secret\n");
      const workspace = new Workspace(root);

      const result = await readWorkspaceFiles(workspace, [
        { path: "a.txt", startLine: 2, endLine: 3 },
        { path: "missing.txt" },
        { path: ".env" },
        { path: "b.txt" },
      ]);

      expect(result.requested).toBe(4);
      expect(result.processed).toBe(4);
      expect(result.omitted).toBe(0);
      const first = result.files[0];
      expect(first?.ok).toBe(true);
      if (first?.ok) expect(first.content).toBe("a2\na3");

      const missing = result.files[1];
      expect(missing?.ok).toBe(false);
      if (missing && !missing.ok) expect(missing.error).toBe("FILE_NOT_FOUND");

      const sensitive = result.files[2];
      expect(sensitive?.ok).toBe(false);
      if (sensitive && !sensitive.ok) expect(sensitive.error).toBe("ACCESS_DENIED_SENSITIVE_FILE");
      expect(JSON.stringify(result)).not.toContain("batch-secret");

      const last = result.files[3];
      expect(last?.ok).toBe(true);
      if (last?.ok) expect(last.content).toContain("b1");
    } finally {
      cleanup(root);
    }
  });

  it("enforces per-file and aggregate content budgets", async () => {
    const root = makeTmpDir("batch-read-budget");
    try {
      const line = "x".repeat(100) + "\n";
      const content = line.repeat(1500);
      for (let i = 0; i < 6; i++) write(root, `large-${i}.txt`, content);
      const workspace = new Workspace(root);

      const result = await readWorkspaceFiles(
        workspace,
        Array.from({ length: 6 }, (_, i) => ({ path: `large-${i}.txt` }))
      );

      expect(result.totalContentBytes).toBeLessThanOrEqual(result.maxTotalContentBytes);
      expect(result.maxTotalContentBytes).toBe(512 * 1024);
      expect(result.truncated).toBe(true);
      expect(result.files.some((file) => file.ok && file.truncated)).toBe(true);
      expect(result.omitted).toBeGreaterThan(0);
      for (const file of result.files) {
        if (file.ok) {
          expect(Buffer.byteLength(file.content, "utf8")).toBeLessThanOrEqual(128 * 1024);
        }
      }
    } finally {
      cleanup(root);
    }
  });

  it("hard-caps a pathological first line that exceeds the underlying read budget", async () => {
    const root = makeTmpDir("batch-read-single-line");
    try {
      write(root, "single-line.txt", "🙂".repeat(100_000));
      const workspace = new Workspace(root);

      const result = await readWorkspaceFiles(workspace, [{ path: "single-line.txt" }]);
      const file = result.files[0];
      expect(file?.ok).toBe(true);
      if (file?.ok) {
        expect(file.batchTruncated).toBe(true);
        expect(file.truncated).toBe(true);
        expect(Buffer.byteLength(file.content, "utf8")).toBeLessThanOrEqual(128 * 1024);
        expect(file.content.endsWith("�")).toBe(false);
      }
      expect(result.totalContentBytes).toBeLessThanOrEqual(128 * 1024);
    } finally {
      cleanup(root);
    }
  });
});
