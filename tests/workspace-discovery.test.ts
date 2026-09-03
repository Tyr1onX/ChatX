import { describe, expect, it } from "vitest";
import { Workspace } from "../src/workspace/manager.js";
import { findWorkspaceFiles } from "../src/workspace/discovery.js";
import { cleanup, makeTmpDir, write } from "./helpers.js";

describe("workspace file discovery", () => {
  it("finds recursive glob matches while hiding noise and sensitive paths", async () => {
    const root = makeTmpDir("find-files");
    try {
      write(root, ".c2cignore", "private/\n");
      write(root, "src/a.ts", "a\n");
      write(root, "src/deep/b.ts", "b\n");
      write(root, "src/deep/readme.md", "docs\n");
      write(root, "node_modules/pkg/index.ts", "noise\n");
      write(root, "private/hidden.ts", "hidden\n");
      write(root, ".env", "SECRET=hidden\n");
      const workspace = new Workspace(root);

      const first = await findWorkspaceFiles(workspace, { pattern: "*.ts", limit: 1 });
      expect(first.files).toHaveLength(1);
      expect(first.hasMore).toBe(true);
      expect(first.nextOffset).toBe(1);
      expect(first.scanTruncated).toBe(false);

      const second = await findWorkspaceFiles(workspace, {
        pattern: "*.ts",
        limit: 10,
        offset: first.nextOffset!,
      });
      const all = [...first.files, ...second.files].map((file) => file.path).sort();
      expect(all).toEqual(["src/a.ts", "src/deep/b.ts"]);
      expect(all).not.toContain("node_modules/pkg/index.ts");
      expect(all).not.toContain("private/hidden.ts");

      const scoped = await findWorkspaceFiles(workspace, { path: "src/deep", pattern: "*.md" });
      expect(scoped.files.map((file) => file.path)).toEqual(["src/deep/readme.md"]);

      const secretPattern = await findWorkspaceFiles(workspace, { pattern: ".env*" });
      expect(secretPattern.files).toHaveLength(0);
    } finally {
      cleanup(root);
    }
  });

  it("requires a directory search root", async () => {
    const root = makeTmpDir("find-files-not-dir");
    try {
      write(root, "single.txt", "x\n");
      const workspace = new Workspace(root);
      await expect(findWorkspaceFiles(workspace, { path: "single.txt" }))
        .rejects.toMatchObject({ code: "NOT_A_DIRECTORY" });
    } finally {
      cleanup(root);
    }
  });
});
