import { describe, expect, it } from "vitest";
import path from "node:path";
import { gitLog, gitShow } from "../src/workspace/git-history.js";
import { Workspace } from "../src/workspace/manager.js";
import { cleanup, git, makeGitRepo, makeTmpDir, write } from "./helpers.js";

describe("structured git history", () => {
  it("lists recent commits with pagination and workspace path scoping", () => {
    const root = makeTmpDir("git-history-log");
    try {
      makeGitRepo(root);
      write(root, "docs/note.md", "docs only\n");
      git(root, "add", "docs/note.md");
      git(root, "commit", "-m", "docs update");
      write(root, "src/index.ts", "export const answer = 43;\n");
      git(root, "add", "src/index.ts");
      git(root, "commit", "-m", "source update");

      const workspace = new Workspace(root);
      const first = gitLog(workspace, { limit: 1 });
      expect(first.isRepo).toBe(true);
      expect(first.commits).toHaveLength(1);
      expect(first.commits[0]?.subject).toBe("source update");
      expect(first.hasMore).toBe(true);
      expect(first.nextSkip).toBe(1);

      const second = gitLog(workspace, { limit: 1, skip: first.nextSkip! });
      expect(second.commits[0]?.subject).toBe("docs update");

      const srcOnly = gitLog(workspace, { limit: 10 }, "src");
      const subjects = srcOnly.commits.map((entry) => entry.subject);
      expect(subjects).toContain("source update");
      expect(subjects).toContain("initial commit");
      expect(subjects).not.toContain("docs update");
    } finally {
      cleanup(root);
    }
  });

  it("shows safe commit changes while excluding sensitive rename provenance", () => {
    const root = makeTmpDir("git-history-sensitive");
    try {
      makeGitRepo(root);
      write(root, "safe-old.ts", "export const safeValue = 'before';\n");
      write(root, ".npmrc", "//registry.npmjs.org/:_authToken=history-secret-token\n");
      git(root, "add", "-f", "safe-old.ts", ".npmrc");
      git(root, "commit", "-m", "history baseline");

      git(root, "mv", "safe-old.ts", "safe-new.ts");
      write(root, "safe-new.ts", "export const safeValue = 'after-safe-change';\n");
      git(root, "mv", ".npmrc", "apparently-public.txt");
      git(root, "add", "-A");
      git(root, "commit", "-m", "rename history files");

      const result = gitShow(new Workspace(root), { ref: "HEAD" });
      expect(result.isRepo).toBe(true);
      expect(result.subject).toBe("rename history files");
      expect(result.diff).toContain("after-safe-change");
      expect(result.changedFiles.some((file) => file.path === "safe-new.ts")).toBe(true);
      expect(result.diff).not.toContain("history-secret-token");
      expect(result.diff).not.toContain(".npmrc");
      expect(result.diff).not.toContain("apparently-public.txt");
      expect(result.changedFiles.some((file) => file.path === "apparently-public.txt")).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it("uses first-parent semantics for merge commits", () => {
    const root = makeTmpDir("git-history-merge");
    try {
      makeGitRepo(root);
      git(root, "checkout", "-b", "feature");
      write(root, "feature.txt", "feature payload\n");
      git(root, "add", "feature.txt");
      git(root, "commit", "-m", "feature work");

      git(root, "checkout", "main");
      write(root, "main.txt", "main payload\n");
      git(root, "add", "main.txt");
      git(root, "commit", "-m", "main work");
      git(root, "merge", "--no-ff", "feature", "-m", "merge feature");

      const result = gitShow(new Workspace(root), { ref: "HEAD" });
      expect(result.parents).toHaveLength(2);
      expect(result.subject).toBe("merge feature");
      expect(result.diff).toContain("feature payload");
      expect(result.diff).not.toContain("main payload");
      expect(result.changedFiles.some((file) => file.path === "feature.txt")).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("paginates large commit diffs without losing byte offsets", () => {
    const root = makeTmpDir("git-history-pagination");
    try {
      makeGitRepo(root);
      const content = Array.from({ length: 6000 }, (_, i) => `history-line-${i}-${"x".repeat(40)}`).join("\n") + "\n";
      write(root, "large.txt", content);
      git(root, "add", "large.txt");
      git(root, "commit", "-m", "large history commit");

      const workspace = new Workspace(root);
      const first = gitShow(workspace, { maxBytes: 4096 });
      expect(first.hasMore).toBe(true);
      expect(first.returnedBytes).toBeLessThanOrEqual(4096);
      expect(first.diff.endsWith("\n")).toBe(true);

      const second = gitShow(workspace, { offset: first.nextOffset!, maxBytes: 4096 });
      expect(second.commit).toBe(first.commit);
      expect(second.offset).toBe(first.nextOffset);
      expect(second.diff.length).toBeGreaterThan(0);
    } finally {
      cleanup(root);
    }
  });

  it("rejects invalid refs and handles non-repositories", () => {
    const root = makeTmpDir("git-history-invalid");
    const plain = makeTmpDir("git-history-plain");
    const oldCeiling = process.env.GIT_CEILING_DIRECTORIES;
    try {
      makeGitRepo(root);
      expect(() => gitShow(new Workspace(root), { ref: "definitely-not-a-ref" }))
        .toThrow(/does not resolve to a commit/);

      process.env.GIT_CEILING_DIRECTORIES = path.dirname(plain);
      const plainWorkspace = new Workspace(plain);
      expect(gitLog(plainWorkspace).isRepo).toBe(false);
      expect(gitShow(plainWorkspace).isRepo).toBe(false);
    } finally {
      if (oldCeiling === undefined) delete process.env.GIT_CEILING_DIRECTORIES;
      else process.env.GIT_CEILING_DIRECTORIES = oldCeiling;
      cleanup(root);
      cleanup(plain);
    }
  });
});
