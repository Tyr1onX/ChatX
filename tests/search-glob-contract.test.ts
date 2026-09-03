import { afterEach, afterAll, beforeAll, describe, expect, it } from "vitest";
import { findWorkspaceFiles } from "../src/workspace/discovery.js";
import { compileWorkspaceGlob } from "../src/workspace/glob.js";
import { Workspace } from "../src/workspace/manager.js";
import { findRipgrep, resetRipgrepCache, searchWorkspace } from "../src/workspace/search.js";
import { cleanup, makeTmpDir, write } from "./helpers.js";

let root: string;
let workspace: Workspace;
const marker = "CHATX_GLOB_CONTRACT_MARKER";

beforeAll(() => {
  root = makeTmpDir("glob-contract");
  write(root, "src/a.ts", `${marker}\n`);
  write(root, "src/b.tsx", `${marker}\n`);
  write(root, "src/c.js", `${marker}\n`);
  write(root, "src/deep/d.ts", `${marker}\n`);
  write(root, "src/upper.TS", `${marker}\n`);
  write(root, "!special.ts", `${marker}\n`);
  workspace = new Workspace(root);
});

afterAll(() => cleanup(root));

afterEach(() => {
  delete process.env.CHATX_DISABLE_RG;
  delete process.env.C2C_DISABLE_RG;
  resetRipgrepCache();
});

function engines(): ("ripgrep" | "node")[] {
  return findRipgrep() ? ["ripgrep", "node"] : ["node"];
}

describe.each(engines())("frozen workspace glob contract: %s", (engine) => {
  const configure = (): void => {
    if (engine === "node") process.env.CHATX_DISABLE_RG = "1";
    resetRipgrepCache();
  };

  it("supports non-nested brace alternatives", async () => {
    configure();
    const result = await searchWorkspace(workspace, {
      query: marker,
      glob: "**/*.{ts,tsx}",
    });

    expect(result.engine).toBe(engine);
    expect(result.matches.map((match) => match.path).sort()).toEqual([
      "!special.ts",
      "src/a.ts",
      "src/b.tsx",
      "src/deep/d.ts",
    ]);
  });

  it("keeps question-mark matching identical", async () => {
    configure();
    const result = await searchWorkspace(workspace, {
      query: marker,
      glob: "src/?.ts",
    });

    expect(result.engine).toBe(engine);
    expect(result.matches.map((match) => match.path)).toEqual(["src/a.ts"]);
  });

  it("treats ripgrep-special punctuation as literal ChatX glob text", async () => {
    configure();
    const result = await searchWorkspace(workspace, {
      query: marker,
      glob: "!special.ts",
    });

    expect(result.engine).toBe(engine);
    expect(result.matches.map((match) => match.path)).toEqual(["!special.ts"]);
  });
});

it("uses the same brace contract for find_files", async () => {
  const result = await findWorkspaceFiles(workspace, {
    pattern: "**/*.{ts,tsx}",
    limit: 20,
  });

  expect(result.files.map((file) => file.path).sort()).toEqual([
    "!special.ts",
    "src/a.ts",
    "src/b.tsx",
    "src/deep/d.ts",
  ]);
});

it("rejects syntax outside the frozen contract", () => {
  expect(() => compileWorkspaceGlob("**/*.[tj]s")).toThrow(/character classes/);
  expect(() => compileWorkspaceGlob("**/*.{ts,{tsx,js}}")).toThrow(/nested brace/);
  expect(() => compileWorkspaceGlob("**/*.{ts,}")).toThrow(/non-empty choices/);
});

it("bounds brace expansion", () => {
  expect(() => compileWorkspaceGlob("{a,b,c,d,e,f,g,h}{1,2,3,4,5}"))
    .toThrow(/exceeds 32 alternatives/);
});
