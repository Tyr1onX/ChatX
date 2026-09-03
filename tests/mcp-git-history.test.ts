import { afterAll, beforeAll, describe, expect, it } from "vitest";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startBridge, type Bridge } from "../src/bridge/server.js";
import { cleanup, git, isolateStateDir, makeGitRepo, makeTmpDir, write } from "./helpers.js";

let root: string;
let bridge: Bridge;
let reader: Client;
let limited: Client;

function textOf(result: { content?: unknown }): string {
  const content = result.content as { type: string; text: string }[];
  return content?.[0]?.text ?? "";
}

function jsonOf<T>(result: { content?: unknown }): T {
  return JSON.parse(textOf(result)) as T;
}

async function connectClient(clientId: string, scopes: string[]): Promise<Client> {
  const tokens = bridge.authStore.issueTokens({ clientId, scopes });
  const client = new Client({ name: clientId, version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${bridge.localBaseUrl()}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${tokens.accessToken}` } },
  });
  await client.connect(transport);
  return client;
}

beforeAll(async () => {
  isolateStateDir();
  root = makeTmpDir("mcp-git-history");
  makeGitRepo(root);
  write(root, "src/history.ts", "export const history = 'visible-history';\n");
  git(root, "add", "src/history.ts");
  git(root, "commit", "-m", "add visible history");
  write(root, ".npmrc", "//registry.npmjs.org/:_authToken=mcp-history-secret\n");
  git(root, "add", "-f", ".npmrc");
  git(root, "commit", "-m", "track sensitive history fixture");

  bridge = await startBridge({
    workspaceRoot: root,
    port: 0,
    persistRuntime: false,
    authStoreFile: path.join(makeTmpDir("auth-git-history"), "store.json"),
  });
  reader = await connectClient("git-history-reader", ["git.read"]);
  limited = await connectClient("git-history-limited", ["workspace.read"]);
});

afterAll(async () => {
  await reader.close();
  await limited.close();
  await bridge.close();
  cleanup(root);
});

describe("git history tools over MCP", () => {
  it("returns structured log and path-scoped history with git.read", async () => {
    const log = jsonOf<{ commits: { subject: string }[] }>(
      await reader.callTool({ name: "git_log", arguments: { limit: 10 } })
    );
    expect(log.commits.map((entry) => entry.subject)).toContain("add visible history");

    const scoped = jsonOf<{ commits: { subject: string }[] }>(
      await reader.callTool({ name: "git_log", arguments: { path: "src", limit: 10 } })
    );
    expect(scoped.commits.map((entry) => entry.subject)).toContain("add visible history");
    expect(scoped.commits.map((entry) => entry.subject)).not.toContain("track sensitive history fixture");
  });

  it("shows safe commit patches and refuses sensitive path scopes", async () => {
    const visibleCommit = git(root, "log", "--format=%H", "--grep=add visible history", "-n", "1").trim();
    const shown = jsonOf<{ subject: string; diff: string; changedFiles: { path: string }[] }>(
      await reader.callTool({ name: "git_show", arguments: { ref: visibleCommit } })
    );
    expect(shown.subject).toBe("add visible history");
    expect(shown.diff).toContain("visible-history");
    expect(shown.changedFiles.some((file) => file.path === "src/history.ts")).toBe(true);

    const deniedSensitive = await reader.callTool({
      name: "git_show",
      arguments: { ref: "HEAD", path: ".npmrc" },
    });
    expect(deniedSensitive.isError).toBe(true);
    expect(textOf(deniedSensitive)).toContain("ACCESS_DENIED_SENSITIVE_FILE");
  });

  it("requires git.read for both history tools", async () => {
    for (const name of ["git_log", "git_show"]) {
      const result = await limited.callTool({ name, arguments: {} });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain("INSUFFICIENT_SCOPE");
      expect(textOf(result)).toContain("git.read");
    }
  });
});
