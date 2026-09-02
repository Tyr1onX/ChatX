import { afterEach, describe, expect, it } from "vitest";
import {
  buildOpenAIConnectArgs,
  normalizeTunnelProxyUrl,
  OpenAISecureMcpTunnel,
  parseOpenAIRuntimeStatus,
  type TunnelCommandRunner,
} from "../src/tunnel/openai-secure.js";
import {
  chooseOpenAITunnel,
  isOpenAITunnelReady,
  openAITunnelBinding,
  readTunnelState,
} from "../src/tunnel/state.js";
import { cleanup, isolateStateDir } from "./helpers.js";

const stateDirs: string[] = [];
const previousStateDir = process.env.C2C_STATE_DIR;
const previousRuntimeKey = process.env.TEST_CHATX_TUNNEL_KEY;

afterEach(() => {
  while (stateDirs.length) cleanup(stateDirs.pop()!);
  if (previousStateDir === undefined) delete process.env.C2C_STATE_DIR;
  else process.env.C2C_STATE_DIR = previousStateDir;
  if (previousRuntimeKey === undefined) delete process.env.TEST_CHATX_TUNNEL_KEY;
  else process.env.TEST_CHATX_TUNNEL_KEY = previousRuntimeKey;
});

describe("OpenAI Secure MCP Tunnel helpers", () => {
  it("builds the official managed-runtime connect command without embedding the secret", () => {
    const args = buildOpenAIConnectArgs({
      alias: "chatx-demo",
      tunnelId: "tunnel_0123456789abcdef0123456789abcdef",
      runtimeKeyEnv: "CONTROL_PLANE_API_KEY",
      localPort: 3456,
    });
    expect(args).toEqual([
      "runtimes",
      "connect",
      "--alias",
      "chatx-demo",
      "--tunnel-id",
      "tunnel_0123456789abcdef0123456789abcdef",
      "--runtime-api-key",
      "env:CONTROL_PLANE_API_KEY",
      "--mcp-server-url",
      "http://127.0.0.1:3456/mcp",
      "--json",
    ]);
  });

  it("parses runtime readiness JSON", () => {
    expect(
      parseOpenAIRuntimeStatus(
        JSON.stringify({ process_running: true, healthy: true, ready: true, ui_url: "http://127.0.0.1:8080/ui" })
      )
    ).toMatchObject({ process_running: true, healthy: true, ready: true });
    expect(parseOpenAIRuntimeStatus("not json")).toEqual({});
  });

  it("accepts credential-free HTTP proxies and rejects proxy credentials", () => {
    expect(normalizeTunnelProxyUrl("http://127.0.0.1:7897")).toBe("http://127.0.0.1:7897");
    expect(() => normalizeTunnelProxyUrl("socks5://127.0.0.1:7897")).toThrow(/http/i);
    expect(() => normalizeTunnelProxyUrl("http://user:pass@127.0.0.1:7897")).toThrow(/credentials/i);
  });
});

describe("OpenAI tunnel state", () => {
  it("stores only tunnel metadata, proxy metadata, and an environment-variable reference", () => {
    stateDirs.push(isolateStateDir());
    const state = chooseOpenAITunnel({
      workspaceId: "abcdef1234567890",
      tunnelId: "tunnel_0123456789abcdef0123456789abcdef",
      runtimeKeyEnv: "CHATX_RUNTIME_KEY",
      proxyUrl: "http://127.0.0.1:7897",
    });
    expect(state.preference).toBe("openai");
    expect(state.runtimeKeyEnv).toBe("CHATX_RUNTIME_KEY");
    expect(state.openaiProxyUrl).toBe("http://127.0.0.1:7897");
    expect(JSON.stringify(state)).not.toMatch(/sk-/i);
    expect(isOpenAITunnelReady(state)).toBe(true);
    expect(openAITunnelBinding(readTunnelState("abcdef1234567890"))).toEqual({
      tunnelId: "tunnel_0123456789abcdef0123456789abcdef",
      alias: "chatx-abcdef123456",
      runtimeKeyEnv: "CHATX_RUNTIME_KEY",
      proxyUrl: "http://127.0.0.1:7897",
    });
  });

  it("rejects malformed tunnel ids", () => {
    stateDirs.push(isolateStateDir());
    expect(() =>
      chooseOpenAITunnel({ workspaceId: "ws", tunnelId: "tunnel_NOT_VALID" })
    ).toThrow(/32 lowercase hexadecimal/i);
  });
});

describe("OpenAISecureMcpTunnel", () => {
  it("connects asynchronously, verifies readiness, injects only the configured proxy, and stops", async () => {
    process.env.TEST_CHATX_TUNNEL_KEY = "test-only-placeholder";
    const calls: Array<{ args: string[]; env: NodeJS.ProcessEnv }> = [];
    const runner: TunnelCommandRunner = async (args, _timeoutMs, env) => {
      calls.push({ args, env });
      if (args[1] === "connect") return { status: 0, stdout: JSON.stringify({ alias: "chatx-demo" }), stderr: "" };
      if (args[1] === "status") {
        return {
          status: 0,
          stdout: JSON.stringify({
            alias: "chatx-demo",
            tunnel_id: "tunnel_0123456789abcdef0123456789abcdef",
            process_running: true,
            healthy: true,
            ready: true,
            ui_url: "http://127.0.0.1:8080/ui",
          }),
          stderr: "",
        };
      }
      if (args[1] === "stop") return { status: 0, stdout: JSON.stringify({ stopped: true }), stderr: "" };
      return { status: 1, stdout: "", stderr: "unexpected command" };
    };
    const provider = new OpenAISecureMcpTunnel({
      tunnelId: "tunnel_0123456789abcdef0123456789abcdef",
      alias: "chatx-demo",
      runtimeKeyEnv: "TEST_CHATX_TUNNEL_KEY",
      proxyUrl: "http://127.0.0.1:7897",
      commandRunner: runner,
    });

    await expect(provider.start(3456)).resolves.toBeNull();
    expect(provider.status()).toMatchObject({
      running: true,
      ready: true,
      url: null,
      tunnelId: "tunnel_0123456789abcdef0123456789abcdef",
    });
    expect(calls[0].args).toContain("env:TEST_CHATX_TUNNEL_KEY");
    expect(calls.flatMap((call) => call.args).join(" ")).not.toContain("test-only-placeholder");
    expect(calls[0].env.HTTPS_PROXY).toBe("http://127.0.0.1:7897");
    expect(calls[0].env.NO_PROXY).toContain("127.0.0.1");

    await provider.stop();
    expect(provider.status().running).toBe(false);
  });

  it("treats a connect command timeout as recoverable when status reports ready", async () => {
    process.env.TEST_CHATX_TUNNEL_KEY = "test-only-placeholder";
    const runner: TunnelCommandRunner = async (args) => {
      if (args[1] === "connect") return { status: null, stdout: "", stderr: "", timedOut: true };
      if (args[1] === "status") {
        return {
          status: 0,
          stdout: JSON.stringify({
            tunnel_id: "tunnel_0123456789abcdef0123456789abcdef",
            process_running: true,
            healthy: true,
            ready: true,
          }),
          stderr: "",
        };
      }
      return { status: 0, stdout: "{}", stderr: "" };
    };
    const provider = new OpenAISecureMcpTunnel({
      tunnelId: "tunnel_0123456789abcdef0123456789abcdef",
      alias: "chatx-demo",
      runtimeKeyEnv: "TEST_CHATX_TUNNEL_KEY",
      commandRunner: runner,
    });
    await expect(provider.start(3456)).resolves.toBeNull();
    expect(provider.status().ready).toBe(true);
  });

  it("refuses to start without the runtime-key environment variable", async () => {
    delete process.env.TEST_CHATX_TUNNEL_KEY;
    const provider = new OpenAISecureMcpTunnel({
      tunnelId: "tunnel_0123456789abcdef0123456789abcdef",
      alias: "chatx-demo",
      runtimeKeyEnv: "TEST_CHATX_TUNNEL_KEY",
      commandRunner: async () => ({ status: 0, stdout: "{}", stderr: "" }),
    });
    await expect(provider.start(3456)).rejects.toThrow(/TEST_CHATX_TUNNEL_KEY/);
  });
});
