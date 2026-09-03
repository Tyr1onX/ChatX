import { afterAll, beforeAll, describe, expect, it } from "vitest";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startBridge, type Bridge } from "../src/bridge/server.js";
import { cleanup, isolateStateDir, makeGitRepo, makeTmpDir, write } from "./helpers.js";

let root: string;
let bridge: Bridge;
let searcher: Client;
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
  root = makeTmpDir("mcp-search-context");
  makeGitRepo(root);
  write(
    root,
    "src/context.ts",
    "before-one\nbefore-two\nexport const target = 'mcp-context-needle';\nafter-one\nafter-two\n"
  );
  write(root, ".env", "SECRET=mcp-context-secret\nmcp-context-needle\n");

  bridge = await startBridge({
    workspaceRoot: root,
    port: 0,
    persistRuntime: false,
    authStoreFile: path.join(makeTmpDir("auth-search-context"), "store.json"),
  });
  searcher = await connectClient("search-context-reader", ["workspace.search"]);
  limited = await connectClient("search-context-limited", ["workspace.read"]);
});

afterAll(async () => {
  await searcher.close();
  await limited.close();
  await bridge.close();
  cleanup(root);
});

describe("search context over MCP", () => {
  it("returns requested context without exposing sensitive files", async () => {
    const result = await searcher.callTool({
      name: "search_workspace",
      arguments: {
        query: "mcp-context-needle",
        context_before: 2,
        context_after: 2,
      },
    });
    expect(result.isError ?? false).toBe(false);

    const payload = jsonOf<{
      matches: { path: string; line: number; before?: { line: number; text: string }[]; after?: { line: number; text: string }[] }[];
      contextBefore: number;
      contextAfter: number;
      contextTruncated: boolean;
    }>(result);
    const match = payload.matches.find((entry) => entry.path === "src/context.ts");
    expect(match?.line).toBe(3);
    expect(match?.before).toEqual([
      { line: 1, text: "before-one" },
      { line: 2, text: "before-two" },
    ]);
    expect(match?.after).toEqual([
      { line: 4, text: "after-one" },
      { line: 5, text: "after-two" },
    ]);
    expect(payload.contextBefore).toBe(2);
    expect(payload.contextAfter).toBe(2);
    expect(payload.contextTruncated).toBe(false);
    expect(payload.matches.some((entry) => entry.path === ".env")).toBe(false);
    expect(textOf(result)).not.toContain("mcp-context-secret");
  });

  it("still requires workspace.search", async () => {
    const denied = await limited.callTool({
      name: "search_workspace",
      arguments: { query: "mcp-context-needle", context_before: 1, context_after: 1 },
    });
    expect(denied.isError).toBe(true);
    expect(textOf(denied)).toContain("INSUFFICIENT_SCOPE");
    expect(textOf(denied)).toContain("workspace.search");
  });
});
