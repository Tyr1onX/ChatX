import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { Workspace } from "../src/workspace/manager.js";
import { applyWorkspacePatch, WorkspacePatchError } from "../src/workspace/patch.js";
import { cleanup, makeTmpDir, write } from "./helpers.js";

describe("workspace patch engine", () => {
  it("applies small exact replacements without rewriting unrelated text", async () => {
    const root = makeTmpDir("patch-exact");
    try {
      write(root, "src/app.ts", "const keep = 1;\nconst timeout = 30000;\nconst tail = 2;\n");
      const workspace = new Workspace(root);

      const result = await applyWorkspacePatch(workspace, [{
        path: "src/app.ts",
        oldText: "const timeout = 30000;",
        newText: "const timeout = 60000;",
      }]);

      expect(result.editCount).toBe(1);
      expect(result.files).toHaveLength(1);
      expect(result.files[0]?.replacements).toBe(1);
      expect(fs.readFileSync(path.join(root, "src/app.ts"), "utf8")).toBe(
        "const keep = 1;\nconst timeout = 60000;\nconst tail = 2;\n"
      );
    } finally {
      cleanup(root);
    }
  });

  it("fails closed when old text is ambiguous", async () => {
    const root = makeTmpDir("patch-ambiguous");
    try {
      write(root, "dup.txt", "same\nsame\n");
      const workspace = new Workspace(root);

      await expect(applyWorkspacePatch(workspace, [{
        path: "dup.txt",
        oldText: "same",
        newText: "changed",
      }])).rejects.toMatchObject<Partial<WorkspacePatchError>>({ code: "PATCH_CONFLICT" });

      expect(fs.readFileSync(path.join(root, "dup.txt"), "utf8")).toBe("same\nsame\n");
    } finally {
      cleanup(root);
    }
  });

  it("validates every file before writing any of them", async () => {
    const root = makeTmpDir("patch-atomic-validation");
    try {
      write(root, "a.txt", "alpha\n");
      write(root, "b.txt", "beta\n");
      const workspace = new Workspace(root);

      await expect(applyWorkspacePatch(workspace, [
        { path: "a.txt", oldText: "alpha", newText: "changed-alpha" },
        { path: "b.txt", oldText: "missing", newText: "changed-beta" },
      ])).rejects.toMatchObject<Partial<WorkspacePatchError>>({ code: "PATCH_CONFLICT" });

      expect(fs.readFileSync(path.join(root, "a.txt"), "utf8")).toBe("alpha\n");
      expect(fs.readFileSync(path.join(root, "b.txt"), "utf8")).toBe("beta\n");
    } finally {
      cleanup(root);
    }
  });

  it("supports deliberate repeated replacement only when explicitly requested", async () => {
    const root = makeTmpDir("patch-repeated");
    try {
      write(root, "repeat.txt", "x x x\n");
      const workspace = new Workspace(root);

      await applyWorkspacePatch(workspace, [{
        path: "repeat.txt",
        oldText: "x",
        newText: "y",
        expectedOccurrences: 3,
      }]);

      expect(fs.readFileSync(path.join(root, "repeat.txt"), "utf8")).toBe("y y y\n");
    } finally {
      cleanup(root);
    }
  });

  it("keeps workspace sensitive-file rules", async () => {
    const root = makeTmpDir("patch-sensitive");
    try {
      write(root, ".env", "TOKEN=secret\n");
      const workspace = new Workspace(root);

      await expect(applyWorkspacePatch(workspace, [{
        path: ".env",
        oldText: "secret",
        newText: "changed",
      }])).rejects.toMatchObject({ code: "ACCESS_DENIED_SENSITIVE_FILE" });

      expect(fs.readFileSync(path.join(root, ".env"), "utf8")).toBe("TOKEN=secret\n");
    } finally {
      cleanup(root);
    }
  });
});
