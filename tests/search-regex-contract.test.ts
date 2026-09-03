import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { Workspace } from "../src/workspace/manager.js";
import { resetRipgrepCache, searchWorkspace } from "../src/workspace/search.js";
import { cleanup, makeTmpDir, write } from "./helpers.js";

let root: string;
let workspace: Workspace;

beforeAll(() => {
  root = makeTmpDir("search-regex-contract");
  write(root, "js-regex.txt", "prefix needle-regex suffix\nneedle-needle\n");
  write(root, "crlf.txt", "alpha\r\nneedle-crlf\r\nomega\r\n");
  workspace = new Workspace(root);
});

afterAll(() => cleanup(root));

afterEach(() => {
  delete process.env.CHATX_RG_PATH;
  delete process.env.C2C_RG_PATH;
  delete process.env.CHATX_DISABLE_RG;
  delete process.env.C2C_DISABLE_RG;
  resetRipgrepCache();
});

it("uses JavaScript RegExp semantics even when a ripgrep override is configured", async () => {
  // process.execPath is deliberately not ripgrep. If regex search delegates to
  // the configured rg process, this request would fail or fall through only
  // after spawning the wrong process. The regex itself also uses lookahead,
  // which Rust regex does not support.
  process.env.CHATX_RG_PATH = process.execPath;
  resetRipgrepCache();

  const result = await searchWorkspace(workspace, {
    query: "needle(?=-regex)",
    path: "js-regex.txt",
    regex: true,
  });

  expect(result.engine).toBe("node");
  expect(result.matches).toEqual([
    { path: "js-regex.txt", line: 1, text: "prefix needle-regex suffix" },
  ]);
});

it("supports JavaScript backreferences without depending on ripgrep", async () => {
  const result = await searchWorkspace(workspace, {
    query: "(needle)-\\1",
    path: "js-regex.txt",
    regex: true,
  });

  expect(result.engine).toBe("node");
  expect(result.matches).toEqual([
    { path: "js-regex.txt", line: 2, text: "needle-needle" },
  ]);
});

it("treats CRLF files as logical lines for regex anchors", async () => {
  const result = await searchWorkspace(workspace, {
    query: "^needle-crlf$",
    path: "crlf.txt",
    regex: true,
  });

  expect(result.engine).toBe("node");
  expect(result.matches).toEqual([
    { path: "crlf.txt", line: 2, text: "needle-crlf" },
  ]);
});
