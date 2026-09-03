import { afterAll, beforeAll, describe, expect, it } from "vitest";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startBridge, type Bridge } from "../src/bridge/server.js";
import { cleanup, isolateStateDir, makeGitRepo, makeTmpDir, write } from "./helpers.js";

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
  root = makeTmpDir("mcp-read-batching");
  makeGitRepo(root);
  write(root, "src/a.ts", "export const a = 'safe-a';\n");
  write(root, "src/deep/b.ts", "export const b = 'safe-b';\n");
  write(root, ".env", "SECRET=mcp-batch-secret\n");

  bridge = await startBridge({
    workspaceRoot: root,
    port: 0,
    persistRuntime: false,
    authStoreFile: path.join(makeTmpDir("auth-read-batching"), "store.json"),
  });
  reader = await connectClient("workspace-reader", ["workspace.read"]);
  limited = await connectClient("workspace-read-limited", ["git.read"]);
});

afterAll(async () => {
  await reader.close();
  await limited.close();
  await bridge.close();
  cleanup(root);
});

describe("workspace discovery and batch reads over MCP", () => {
  it("finds safe files recursively with workspace.read", async () => {
    const result = jsonOf<{ files: { path: string }[] }>(
      await reader.callTool({ name: "find_files", arguments: { pattern: "*.ts", limit: 20 } })
    );
    const paths = result.files.map((file) => file.path);
    expect(paths).toContain("src/a.ts");
    expect(paths).toContain("src/deep/b.ts");
    expect(paths).not.toContain(".env");
  });

  it("returns safe batch content and isolated per-file errors without leaking secrets", async () => {
    const result = await reader.callTool({
      name: "read_files",
      arguments: {
        files: [
          { path: "src/a.ts" },
          { path: "missing.ts" },
          { path: ".env" },
          { path: "src/deep/b.ts" },
        ],
      },
    });
    expect(result.isError ?? false).toBe(false);
    const parsed = jsonOf<{ files: Array<{ ok: boolean; path: string; content?: string; error?: string }> }>(result);
    expect(parsed.files[0]?.content).toContain("safe-a");
    expect(parsed.files[1]?.error).toBe("FILE_NOT_FOUND");
    expect(parsed.files[2]?.error).toBe("ACCESS_DENIED_SENSITIVE_FILE");
    expect(parsed.files[3]?.content).toContain("safe-b");
    expect(textOf(result)).not.toContain("mcp-batch-secret");
  });

  it("requires workspace.read for both tools", async () => {
    for (const [name, args] of [
      ["find_files", { pattern: "*.ts" }],
      ["read_files", { files: [{ path: "src/a.ts" }] }],
    ] as const) {
      const result = await limited.callTool({ name, arguments: args });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain("INSUFFICIENT_SCOPE");
      expect(textOf(result)).toContain("workspace.read");
    }
  });
});
