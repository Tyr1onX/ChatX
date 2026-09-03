import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { Workspace } from "../src/workspace/manager.js";
import { findRipgrep, resetRipgrepCache, searchWorkspace } from "../src/workspace/search.js";
import { cleanup, makeTmpDir, write } from "./helpers.js";

let root: string;
let ws: Workspace;

beforeAll(() => {
  root = makeTmpDir("search-ignore-policy");
  write(root, ".gitignore", "gitignored-search.txt\n");
  write(root, ".ignore", "generic-ignored-search.txt\n");
  write(root, ".rgignore", "rgignored-search.txt\n");
  write(root, ".chatxignore", "chatx-private/\n");
  write(root, ".c2cignore", "legacy-private/\n");

  write(root, "gitignored-search.txt", "needle-policy\n");
  write(root, "generic-ignored-search.txt", "needle-policy\n");
  write(root, "rgignored-search.txt", "needle-policy\n");
  write(root, ".hidden-search.txt", "needle-policy\n");
  write(root, ".env.example", "needle-policy\n");

  write(root, "chatx-private/secret.txt", "needle-denied-policy\n");
  write(root, "legacy-private/secret.txt", "needle-denied-policy\n");
  write(root, "node_modules/pkg/secret.txt", "needle-denied-policy\n");
  write(root, ".env", "needle-denied-policy\n");

  write(root, "config-proof.txt", "needle-config-proof\n");
  write(root, "ripgrep-config", "--glob=!config-proof.txt\n");

  ws = new Workspace(root);
});

afterAll(() => {
  cleanup(root);
});

afterEach(() => {
  delete process.env.CHATX_DISABLE_RG;
  delete process.env.C2C_DISABLE_RG;
  delete process.env.CHATX_RG_PATH;
  delete process.env.C2C_RG_PATH;
  delete process.env.RIPGREP_CONFIG_PATH;
  resetRipgrepCache();
});

function engines(): ("ripgrep" | "node")[] {
  return findRipgrep() ? ["ripgrep", "node"] : ["node"];
}

describe.each(engines())("search ignore policy: %s", (engine) => {
  const configure = (): void => {
    if (engine === "node") process.env.C2C_DISABLE_RG = "1";
    resetRipgrepCache();
  };

  it("searches ChatX-allowed files regardless of ambient ignore files", async () => {
    configure();
    const result = await searchWorkspace(ws, { query: "needle-policy" });

    expect(result.engine).toBe(engine);
    expect(result.matches.map((match) => match.path).sort()).toEqual([
      ".env.example",
      ".hidden-search.txt",
      "generic-ignored-search.txt",
      "gitignored-search.txt",
      "rgignored-search.txt",
    ]);
  });

  it("keeps ChatX custom, sensitive, and noise filtering authoritative", async () => {
    configure();
    const result = await searchWorkspace(ws, { query: "needle-denied-policy" });

    expect(result.engine).toBe(engine);
    expect(result.matches).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  it("does not inherit RIPGREP_CONFIG_PATH filtering", async () => {
    process.env.RIPGREP_CONFIG_PATH = path.join(root, "ripgrep-config");
    configure();
    const result = await searchWorkspace(ws, { query: "needle-config-proof" });

    expect(result.engine).toBe(engine);
    expect(result.matches.map((match) => match.path)).toEqual(["config-proof.txt"]);
  });
});
