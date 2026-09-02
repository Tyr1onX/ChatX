import { afterAll, beforeAll, describe, expect, it } from "vitest";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startBridge, type Bridge } from "../src/bridge/server.js";
import type { TunnelProvider } from "../src/tunnel/provider.js";
import { cleanup, makeGitRepo, makeTmpDir } from "./helpers.js";

let root: string;
let bridge: Bridge;
let client: Client;

const openAIProvider: TunnelProvider = {
  name: "openai-secure-mcp",
  async start() {
    return null;
  },
  async stop() {},
  async restart() {
    return null;
  },
  status() {
    return {
      running: false,
      ready: false,
      url: null,
      provider: "openai-secure-mcp",
      tunnelId: "tunnel_0123456789abcdef0123456789abcdef",
    };
  },
  getPublicUrl() {
    return null;
  },
  async doctor() {
    return {
      provider: "openai-secure-mcp",
      binaryFound: true,
      binaryPath: "tunnel-client",
      running: false,
      ready: false,
      url: null,
      tunnelId: "tunnel_0123456789abcdef0123456789abcdef",
      problems: [],
    };
  },
};

beforeAll(async () => {
  root = makeTmpDir("openai-bridge");
  makeGitRepo(root);
  bridge = await startBridge({
    workspaceRoot: root,
    port: 0,
    persistRuntime: false,
    authStoreFile: path.join(makeTmpDir("openai-auth"), "store.json"),
    tunnelProvider: openAIProvider,
  });
  client = new Client({ name: "openai-private-transport-test", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${bridge.localBaseUrl()}/mcp`)));
});

afterAll(async () => {
  await client.close();
  await bridge.close();
  cleanup(root);
});

describe("OpenAI Tunnel bridge auth mode", () => {
  it("allows the loopback tunnel target to initialize without ChatX OAuth", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toContain("workspace_info");
  });

  it("does not expose the ChatX OAuth authorization route in private-tunnel mode", async () => {
    const response = await fetch(`${bridge.localBaseUrl()}/authorize`);
    expect(response.status).toBe(404);
  });
});
