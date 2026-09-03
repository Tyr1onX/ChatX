import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  RIPGREP_PREPRUNE_SENSITIVE_PATTERNS,
  SENSITIVE_PATTERNS,
} from "../src/workspace/ignore.js";
import { Workspace, WorkspaceError } from "../src/workspace/manager.js";
import { findRipgrep, resetRipgrepCache, searchWorkspace } from "../src/workspace/search.js";
import { cleanup, makeTmpDir, write } from "./helpers.js";

let root: string;
let workspace: Workspace;
const marker = "CHATX_SENSITIVE_PREPRUNE_MARKER";

beforeAll(() => {
  root = makeTmpDir("search-sensitive-preprune");
  write(root, "safe.txt", `${marker}\n`);
  write(root, ".env.example", `${marker}\n`);
  write(root, ".env.local", `${marker}\n`);
  write(root, "secret.pem", `${marker}\n`);
  write(root, "credentials.json", `${marker}\n`);
  write(root, "service-account-prod.json", `${marker}\n`);
  write(root, ".ssh/config", `${marker}\n`);
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

describe.each(engines())("sensitive search policy: %s", (engine) => {
  const configure = (): void => {
    if (engine === "node") process.env.CHATX_DISABLE_RG = "1";
    resetRipgrepCache();
  };

  it("keeps sensitive files hidden while preserving the .env.example exception", async () => {
    configure();
    const result = await searchWorkspace(workspace, { query: marker, limit: 20 });

    expect(result.engine).toBe(engine);
    expect(result.matches.map((match) => match.path).sort()).toEqual([
      ".env.example",
      "safe.txt",
    ]);
  });

  it("allows the explicit .env.example exception", async () => {
    configure();
    const result = await searchWorkspace(workspace, {
      query: marker,
      path: ".env.example",
    });

    expect(result.engine).toBe(engine);
    expect(result.matches.map((match) => match.path)).toEqual([".env.example"]);
  });
});

it("keeps allow-exception rules out of ripgrep pre-pruning", () => {
  expect(RIPGREP_PREPRUNE_SENSITIVE_PATTERNS).toContain(".env");
  expect(RIPGREP_PREPRUNE_SENSITIVE_PATTERNS).toContain("*.pem");
  expect(RIPGREP_PREPRUNE_SENSITIVE_PATTERNS).toContain(".ssh/");
  expect(RIPGREP_PREPRUNE_SENSITIVE_PATTERNS).toContain("credentials.json");
  expect(RIPGREP_PREPRUNE_SENSITIVE_PATTERNS).not.toContain(".env.*");
  expect(RIPGREP_PREPRUNE_SENSITIVE_PATTERNS.every((pattern) => !pattern.startsWith("!"))).toBe(true);
  for (const pattern of RIPGREP_PREPRUNE_SENSITIVE_PATTERNS) {
    expect(SENSITIVE_PATTERNS).toContain(pattern);
  }
  expect(SENSITIVE_PATTERNS).toContain(".env.*");
  expect(SENSITIVE_PATTERNS).toContain("!.env.example");
});

it("still rejects an explicit sensitive path before searching", async () => {
  await expect(searchWorkspace(workspace, {
    query: marker,
    path: ".env.local",
  })).rejects.toMatchObject<Partial<WorkspaceError>>({
    code: "ACCESS_DENIED_SENSITIVE_FILE",
  });
});
