import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { Workspace } from "../src/workspace/manager.js";
import {
  createWorkspaceDirectory,
  deleteWorkspacePath,
  moveWorkspacePath,
} from "../src/workspace/mutate.js";
import { cleanup, makeGitRepo, makeTmpDir, write } from "./helpers.js";

describe("workspace mutation primitives", () => {
  it("creates nested directories idempotently", async () => {
    const root = makeTmpDir("mutate-mkdir");
    try {
      const workspace = new Workspace(root);
      const first = await createWorkspaceDirectory(workspace, "src/generated/types");
      const second = await createWorkspaceDirectory(workspace, "src/generated/types");

      expect(first).toEqual({ path: "src/generated/types", created: true });
      expect(second).toEqual({ path: "src/generated/types", created: false });
      expect(fs.statSync(path.join(root, "src/generated/types")).isDirectory()).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("moves files and creates destination parents", async () => {
    const root = makeTmpDir("mutate-move");
    try {
      write(root, "draft.txt", "hello\n");
      const workspace = new Workspace(root);

      const result = await moveWorkspacePath(workspace, "draft.txt", "archive/2026/final.txt");

      expect(result).toEqual({
        source: "draft.txt",
        destination: "archive/2026/final.txt",
        type: "file",
      });
      expect(fs.existsSync(path.join(root, "draft.txt"))).toBe(false);
      expect(fs.readFileSync(path.join(root, "archive/2026/final.txt"), "utf8")).toBe("hello\n");
    } finally {
      cleanup(root);
    }
  });

  it("does not overwrite an existing move destination", async () => {
    const root = makeTmpDir("mutate-no-overwrite");
    try {
      write(root, "source.txt", "source\n");
      write(root, "destination.txt", "destination\n");
      const workspace = new Workspace(root);

      await expect(moveWorkspacePath(workspace, "source.txt", "destination.txt"))
        .rejects.toMatchObject({ code: "PATH_EXISTS" });
      expect(fs.readFileSync(path.join(root, "source.txt"), "utf8")).toBe("source\n");
      expect(fs.readFileSync(path.join(root, "destination.txt"), "utf8")).toBe("destination\n");
    } finally {
      cleanup(root);
    }
  });

  it("deletes files and requires explicit recursive deletion for non-empty directories", async () => {
    const root = makeTmpDir("mutate-delete");
    try {
      write(root, "cache/item.txt", "temporary\n");
      write(root, "single.txt", "temporary\n");
      const workspace = new Workspace(root);

      await deleteWorkspacePath(workspace, "single.txt");
      expect(fs.existsSync(path.join(root, "single.txt"))).toBe(false);

      await expect(deleteWorkspacePath(workspace, "cache"))
        .rejects.toMatchObject({ code: "DIRECTORY_NOT_EMPTY" });
      expect(fs.existsSync(path.join(root, "cache/item.txt"))).toBe(true);

      await deleteWorkspacePath(workspace, "cache", { recursive: true });
      expect(fs.existsSync(path.join(root, "cache"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it("protects workspace root and .git from move/delete", async () => {
    const root = makeTmpDir("mutate-protected");
    try {
      makeGitRepo(root);
      const workspace = new Workspace(root);

      await expect(deleteWorkspacePath(workspace, ".", { recursive: true }))
        .rejects.toMatchObject({ code: "PROTECTED_PATH" });
      await expect(deleteWorkspacePath(workspace, ".git", { recursive: true }))
        .rejects.toMatchObject({ code: "PROTECTED_PATH" });
      await expect(moveWorkspacePath(workspace, ".git", "git-backup"))
        .rejects.toMatchObject({ code: "PROTECTED_PATH" });

      expect(fs.existsSync(path.join(root, ".git"))).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("preserves sensitive-file and workspace containment rules", async () => {
    const root = makeTmpDir("mutate-boundaries");
    try {
      write(root, ".env", "TOKEN=secret\n");
      write(root, "safe.txt", "safe\n");
      const workspace = new Workspace(root);

      await expect(deleteWorkspacePath(workspace, ".env"))
        .rejects.toMatchObject({ code: "ACCESS_DENIED_SENSITIVE_FILE" });
      await expect(moveWorkspacePath(workspace, ".env", "visible.txt"))
        .rejects.toMatchObject({ code: "ACCESS_DENIED_SENSITIVE_FILE" });
      await expect(moveWorkspacePath(workspace, "safe.txt", "../outside.txt"))
        .rejects.toMatchObject({ code: "PATH_OUTSIDE_WORKSPACE" });
      await expect(createWorkspaceDirectory(workspace, ".aws/cache"))
        .rejects.toMatchObject({ code: "ACCESS_DENIED_SENSITIVE_FILE" });

      expect(fs.readFileSync(path.join(root, ".env"), "utf8")).toContain("secret");
      expect(fs.existsSync(path.join(root, "safe.txt"))).toBe(true);
    } finally {
      cleanup(root);
    }
  });
});
