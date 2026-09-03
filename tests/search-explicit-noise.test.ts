import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Workspace } from "../src/workspace/manager.js";
import { resetRipgrepCache, searchWorkspace } from "../src/workspace/search.js";
import { cleanup, makeTmpDir, write } from "./helpers.js";

let root: string;
let ws: Workspace;

beforeAll(() => {
  root = makeTmpDir("search-explicit-noise");
  write(root, "node_modules/pkg/index.js", "needle-explicit-noise\n");
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
  resetRipgrepCache();
});

function configureFailingRipgrep(): void {
  process.env.CHATX_RG_PATH = process.execPath;
  resetRipgrepCache();
}

describe("explicit noise paths", () => {
  it("does not spawn ripgrep for an explicitly targeted noise file", async () => {
    configureFailingRipgrep();

    const result = await searchWorkspace(ws, {
      query: "needle-explicit-noise",
      path: "node_modules/pkg/index.js",
    });

    expect(result).toEqual({
      matches: [],
      matchCount: 0,
      truncated: false,
      engine: "ripgrep",
    });
  });

  it("does not spawn ripgrep for an explicitly targeted noise directory", async () => {
    configureFailingRipgrep();

    const result = await searchWorkspace(ws, {
      query: "needle-explicit-noise",
      path: "node_modules",
    });

    expect(result).toEqual({
      matches: [],
      matchCount: 0,
      truncated: false,
      engine: "ripgrep",
    });
  });
});
