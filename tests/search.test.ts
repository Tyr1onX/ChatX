import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { Workspace } from "../src/workspace/manager.js";
import { searchWorkspace, resetRipgrepCache, findRipgrep } from "../src/workspace/search.js";
import { makeTmpDir, cleanup, write } from "./helpers.js";

let root: string;
let ws: Workspace;
const globMarker = "C2C_GLOB_MARKER";

beforeAll(() => {
  root = makeTmpDir("search-ws");
  write(root, "src/auth.ts", "export function login() { return 'needle-alpha'; }\n");
  write(root, "src/deep/nested.ts", `// needle-alpha appears here too\n${globMarker}\n`);
  write(root, "src/root.ts", `${globMarker}\n`);
  write(root, "root.ts", `${globMarker}\n`);
  write(
    root,
    "src/context.ts",
    "before-a\nbefore-b\nconst target = 'needle-context';\nafter-a\nafter-b\ntail\n"
  );
  write(root, "README.md", "This project contains needle-alpha documentation.\n");
  write(root, ".env", "NEEDLE-ALPHA=secret\n");
  write(root, "node_modules/pkg/index.js", "needle-alpha in dependencies\n");
  for (let i = 0; i < 30; i++) {
    write(root, `many/file-${i}.txt`, "needle-beta\nneedle-beta\n");
  }
  const contextLine = "x".repeat(500);
  for (let i = 0; i < 50; i++) {
    write(
      root,
      `context-heavy/file-${i}.txt`,
      [contextLine, contextLine, contextLine, `needle-context-budget-${i}`, contextLine, contextLine, contextLine].join("\n") + "\n"
    );
  }
  ws = new Workspace(root);
});

afterAll(() => {
  cleanup(root);
});

afterEach(() => {
  delete process.env.C2C_DISABLE_RG;
  resetRipgrepCache();
});

function engines(): ("ripgrep" | "node")[] {
  return findRipgrep() ? ["ripgrep", "node"] : ["node"];
}

describe.each(engines())("search engine: %s", (engine) => {
  const configure = (): void => {
    if (engine === "node") process.env.C2C_DISABLE_RG = "1";
    resetRipgrepCache();
  };

  it("finds matches with paths and line numbers", async () => {
    configure();
    const result = await searchWorkspace(ws, { query: "needle-alpha" });
    expect(result.engine).toBe(engine);
    const paths = result.matches.map((match) => match.path);
    expect(paths).toContain("src/auth.ts");
    expect(paths).toContain("src/deep/nested.ts");
    expect(paths).toContain("README.md");
    const authMatch = result.matches.find((match) => match.path === "src/auth.ts");
    expect(authMatch?.line).toBe(1);
  });

  it("never returns sensitive or noise files", async () => {
    configure();
    const result = await searchWorkspace(ws, { query: "needle-alpha" });
    const paths = result.matches.map((match) => match.path);
    expect(paths.some((p) => p.includes(".env"))).toBe(false);
    expect(paths.some((p) => p.includes("node_modules"))).toBe(false);
  });

  it("respects the limit", async () => {
    configure();
    const result = await searchWorkspace(ws, { query: "needle-beta", limit: 10 });
    expect(result.matches.length).toBeLessThanOrEqual(10);
    expect(result.truncated).toBe(true);
  });

  it("supports glob filters", async () => {
    configure();
    const result = await searchWorkspace(ws, { query: "needle-alpha", glob: "*.md" });
    const paths = result.matches.map((match) => match.path);
    expect(paths).toContain("README.md");
    expect(paths.some((p) => p.endsWith(".ts"))).toBe(false);
  });

  it("matches root and nested files for recursive globs", async () => {
    configure();
    const result = await searchWorkspace(ws, { query: globMarker, glob: "**/*.ts" });
    const paths = result.matches.map((match) => match.path).sort();
    expect(paths).toEqual(["root.ts", "src/deep/nested.ts", "src/root.ts"]);
  });

  it("restricts search to a subdirectory", async () => {
    configure();
    const result = await searchWorkspace(ws, { query: "needle-alpha", path: "src" });
    const paths = result.matches.map((match) => match.path);
    expect(paths).toContain("src/auth.ts");
    expect(paths).not.toContain("README.md");
  });

  it("returns bounded context around each match when requested", async () => {
    configure();
    const result = await searchWorkspace(ws, {
      query: "needle-context",
      path: "src",
      contextBefore: 2,
      contextAfter: 2,
    });
    const match = result.matches.find((entry) => entry.path === "src/context.ts");
    expect(match?.line).toBe(3);
    expect(match?.before).toEqual([
      { line: 1, text: "before-a" },
      { line: 2, text: "before-b" },
    ]);
    expect(match?.after).toEqual([
      { line: 4, text: "after-a" },
      { line: 5, text: "after-b" },
    ]);
    expect(result.contextBefore).toBe(2);
    expect(result.contextAfter).toBe(2);
    expect(result.contextTruncated).toBe(false);
  });

  it("caps aggregate context output without dropping the primary matches", async () => {
    configure();
    const result = await searchWorkspace(ws, {
      query: "needle-context-budget",
      path: "context-heavy",
      limit: 50,
      contextBefore: 3,
      contextAfter: 3,
    });
    expect(result.matches.length).toBe(50);
    expect(result.contextTruncated).toBe(true);
    expect(result.contextBytes).toBeLessThanOrEqual(result.maxContextBytes ?? 0);
    expect(result.maxContextBytes).toBe(128 * 1024);
    expect(result.matches.every((match) => match.text.includes("needle-context-budget"))).toBe(true);
  });
});
