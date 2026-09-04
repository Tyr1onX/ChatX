import { afterEach, describe, expect, it } from "vitest";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startBridge, type Bridge } from "../src/bridge/server.js";
import { cleanup, isolateStateDir, makeTmpDir } from "./helpers.js";

const SECRET_KEYS = [
  "CHATX_TEST_SECRET",
  "OPENAI_API_KEY",
  "GITHUB_TOKEN",
  "AWS_SECRET_ACCESS_KEY",
] as const;

const originalValues = new Map<string, string | undefined>();

for (const key of SECRET_KEYS) originalValues.set(key, process.env[key]);

afterEach(() => {
  for (const [key, value] of originalValues) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function textOf(result: { content?: unknown }): string {
  const content = result.content as { type: string; text: string }[];
  return content?.[0]?.text ?? "";
}

function jsonOf<T>(result: { content?: unknown }): T {
  return JSON.parse(textOf(result)) as T;
}

async function withRunner(
  run: (client: Client, bridge: Bridge) => Promise<void>
): Promise<void> {
  isolateStateDir();
  const root = makeTmpDir("compatible-env-workspace");
  const authRoot = makeTmpDir("compatible-env-auth");
  const bridge = await startBridge({
    workspaceRoot: root,
    port: 0,
    persistRuntime: false,
    authStoreFile: path.join(authRoot, "store.json"),
  });
  const tokens = bridge.authStore.issueTokens({
    clientId: "compatible-env-test",
    scopes: ["process.run"],
  });
  const client = new Client({ name: "compatible-env-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${bridge.localBaseUrl()}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${tokens.accessToken}` } },
  });

  try {
    await client.connect(transport);
    await run(client, bridge);
  } finally {
    await client.close();
    await bridge.close();
    cleanup(authRoot);
    cleanup(root);
  }
}

function secretProbeScript(keepAlive: boolean): string {
  return [
    `const keys = ${JSON.stringify(SECRET_KEYS)}`,
    "const result = { path: process.env.PATH ?? null, secrets: Object.fromEntries(keys.map((key) => [key, process.env[key] ?? null])) }",
    "process.stdout.write(JSON.stringify(result) + '\\n')",
    ...(keepAlive ? ["setInterval(() => {}, 1000)"] : []),
  ].join(";");
}

describe("compatible process environment integration", () => {
  it("strips host secrets from run_command while keeping PATH", async () => {
    for (const key of SECRET_KEYS) process.env[key] = `secret-${key}`;

    await withRunner(async (client) => {
      const result = await client.callTool({
        name: "run_command",
        arguments: {
          command: process.execPath,
          args: ["-e", secretProbeScript(false)],
        },
      });

      expect(result.isError ?? false).toBe(false);
      const command = jsonOf<{ exitCode: number; stdout: string }>(result);
      expect(command.exitCode).toBe(0);
      const probe = JSON.parse(command.stdout.trim()) as {
        path: string | null;
        secrets: Record<string, string | null>;
      };
      expect(probe.path).toBeTruthy();
      for (const key of SECRET_KEYS) expect(probe.secrets[key]).toBeNull();
    });
  });

  it("strips host secrets from process_start while preserving managed-process behavior", async () => {
    for (const key of SECRET_KEYS) process.env[key] = `secret-${key}`;

    await withRunner(async (client) => {
      const started = jsonOf<{ id: string; status: string }>(
        await client.callTool({
          name: "process_start",
          arguments: {
            command: process.execPath,
            args: ["-e", secretProbeScript(true)],
          },
        })
      );
      expect(started.status).toBe("running");

      let stdout = "";
      const deadline = Date.now() + 2_000;
      while (Date.now() < deadline) {
        const read = jsonOf<{ stdout: { text: string } }>(
          await client.callTool({
            name: "process_read",
            arguments: { process_id: started.id, max_chars: 65536 },
          })
        );
        stdout = read.stdout.text;
        if (stdout.includes("secrets")) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      expect(stdout).toContain("secrets");
      const probe = JSON.parse(stdout.trim().split(/\r?\n/)[0]) as {
        path: string | null;
        secrets: Record<string, string | null>;
      };
      expect(probe.path).toBeTruthy();
      for (const key of SECRET_KEYS) expect(probe.secrets[key]).toBeNull();

      const stopped = await client.callTool({
        name: "process_stop",
        arguments: { process_id: started.id },
      });
      expect(stopped.isError ?? false).toBe(false);
    });
  });
});
