import { afterAll, beforeAll, describe, expect, it } from "vitest";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startBridge, type Bridge } from "../src/bridge/server.js";
import { cleanup, isolateStateDir, makeGitRepo, makeTmpDir, withWindowsCommandShim } from "./helpers.js";

let root: string;
let bridge: Bridge;
let client: Client;

function textOf(result: { content?: unknown }): string {
  const content = result.content as { type: string; text: string }[];
  return content?.[0]?.text ?? "";
}

beforeAll(async () => {
  if (process.platform !== "win32") return;
  isolateStateDir();
  root = makeTmpDir("run-command-windows");
  makeGitRepo(root);
  bridge = await startBridge({
    workspaceRoot: root,
    port: 0,
    persistRuntime: false,
    authStoreFile: path.join(makeTmpDir("auth-run-command"), "store.json"),
  });
  const tokens = bridge.authStore.issueTokens({ clientId: "run-command-windows", scopes: ["process.run"] });
  client = new Client({ name: "run-command-windows", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${bridge.localBaseUrl()}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${tokens.accessToken}` } },
  });
  await client.connect(transport);
});

afterAll(async () => {
  if (process.platform !== "win32") return;
  await client.close();
  await bridge.close();
  cleanup(root);
});

describe("run_command Windows command shims", () => {
  it.skipIf(process.platform !== "win32")("runs the pnpm command shim through MCP", async () => {
    await withWindowsCommandShim("pnpm", "9.99.99-test", async () => {
      const result = await client.callTool({
        name: "run_command",
        arguments: { command: "pnpm", args: ["--version"] },
      });

      expect(result.isError ?? false).toBe(false);
      const parsed = JSON.parse(textOf(result)) as { exitCode: number; stdout: string };
      expect(parsed.exitCode).toBe(0);
      expect(parsed.stdout.trim()).toBe("9.99.99-test");
    });
  });
});
