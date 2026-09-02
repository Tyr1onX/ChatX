import { spawnSync } from "node:child_process";
import type { Logger } from "../logger/index.js";
import { nullLogger } from "../logger/index.js";
import { findBinary } from "./detect.js";
import type { TunnelDoctorReport, TunnelProvider, TunnelStatus } from "./provider.js";
import { openAITransport, type TransportDescriptor } from "./transport.js";

export interface TunnelCommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export type TunnelCommandRunner = (args: string[], timeoutMs: number) => TunnelCommandResult;

export interface OpenAISecureMcpTunnelOptions {
  tunnelId: string;
  alias: string;
  runtimeKeyEnv?: string;
  logger?: Logger;
  binaryOverride?: string;
  startTimeoutMs?: number;
  commandRunner?: TunnelCommandRunner;
}

export interface OpenAIRuntimeStatusPayload {
  alias?: string;
  tunnel_id?: string;
  process_running?: boolean;
  healthy?: boolean;
  ready?: boolean;
  runtime_state?: string;
  ui_url?: string;
  error?: string;
}

export function buildOpenAIConnectArgs(opts: {
  alias: string;
  tunnelId: string;
  runtimeKeyEnv: string;
  localPort: number;
}): string[] {
  return [
    "runtimes",
    "connect",
    "--alias",
    opts.alias,
    "--tunnel-id",
    opts.tunnelId,
    "--runtime-api-key",
    `env:${opts.runtimeKeyEnv}`,
    "--mcp-server-url",
    `http://127.0.0.1:${opts.localPort}/mcp`,
    "--json",
  ];
}

export function parseOpenAIRuntimeStatus(text: string): OpenAIRuntimeStatusPayload {
  const trimmed = text.trim();
  if (!trimmed) return {};
  try {
    const value = JSON.parse(trimmed) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as OpenAIRuntimeStatusPayload)
      : {};
  } catch {
    return {};
  }
}

function normalizeAlias(alias: string): string {
  const normalized = alias.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(normalized)) {
    throw new Error("OpenAI tunnel alias must be 1-80 characters using letters, digits, dot, underscore, or dash.");
  }
  return normalized;
}

function normalizeEnvName(name: string): string {
  const normalized = name.trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(normalized)) {
    throw new Error("Runtime API key environment variable name is invalid.");
  }
  return normalized;
}

/**
 * OpenAI Secure MCP Tunnel provider backed by the official tunnel-client.
 *
 * The tunnel itself has no public ChatX URL. tunnel-client owns the managed
 * local runtime while ChatGPT addresses it by an opaque tunnel id.
 */
export class OpenAISecureMcpTunnel implements TunnelProvider {
  readonly name = "openai-secure-mcp";
  private readonly tunnel: TransportDescriptor;
  private readonly alias: string;
  private readonly runtimeKeyEnv: string;
  private readonly logger: Logger;
  private readonly binaryOverride?: string;
  private readonly startTimeoutMs: number;
  private readonly commandRunner?: TunnelCommandRunner;
  private connected = false;
  private ready = false;
  private lastError: string | null = null;
  private uiUrl: string | null = null;

  constructor(opts: OpenAISecureMcpTunnelOptions) {
    this.tunnel = openAITransport(opts.tunnelId);
    this.alias = normalizeAlias(opts.alias);
    this.runtimeKeyEnv = normalizeEnvName(opts.runtimeKeyEnv ?? "CONTROL_PLANE_API_KEY");
    this.logger = opts.logger ?? nullLogger;
    this.binaryOverride = opts.binaryOverride;
    this.startTimeoutMs = opts.startTimeoutMs ?? 60_000;
    this.commandRunner = opts.commandRunner;
  }

  private binary(): string | null {
    if (this.commandRunner) return this.binaryOverride ?? "tunnel-client";
    return this.binaryOverride ?? findBinary("tunnel-client");
  }

  private run(args: string[], timeoutMs = 20_000): TunnelCommandResult {
    if (this.commandRunner) return this.commandRunner(args, timeoutMs);
    const bin = this.binary();
    if (!bin) throw new Error("tunnel-client binary not found");
    const result = spawnSync(bin, args, {
      encoding: "utf8",
      timeout: timeoutMs,
      windowsHide: true,
      env: process.env,
      maxBuffer: 1024 * 1024,
    });
    if (result.error) throw result.error;
    return {
      status: result.status,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  }

  private readStatus(): OpenAIRuntimeStatusPayload {
    const result = this.run(["runtimes", "status", this.alias, "--json"]);
    const payload = parseOpenAIRuntimeStatus(result.stdout);
    if (result.status !== 0) {
      const detail = payload.error || result.stderr.trim() || result.stdout.trim() || `exit ${result.status}`;
      throw new Error(`tunnel-client status failed: ${detail}`);
    }
    return payload;
  }

  private applyStatus(payload: OpenAIRuntimeStatusPayload): void {
    this.connected = payload.process_running === true;
    this.ready = payload.ready === true;
    this.uiUrl = typeof payload.ui_url === "string" && payload.ui_url.trim() ? payload.ui_url.trim() : null;
    if (payload.error) this.lastError = payload.error;
  }

  async start(localPort: number): Promise<string | null> {
    if (!Number.isInteger(localPort) || localPort <= 0 || localPort > 65535) {
      throw new Error("Invalid local MCP port");
    }
    const bin = this.binary();
    if (!bin) throw new Error("tunnel-client is not installed or is not on PATH");
    if (!process.env[this.runtimeKeyEnv]) {
      throw new Error(`Missing runtime API key environment variable: ${this.runtimeKeyEnv}`);
    }

    this.lastError = null;
    const connect = this.run(
      buildOpenAIConnectArgs({
        alias: this.alias,
        tunnelId: this.tunnel.tunnelId!,
        runtimeKeyEnv: this.runtimeKeyEnv,
        localPort,
      }),
      this.startTimeoutMs
    );
    const connectPayload = parseOpenAIRuntimeStatus(connect.stdout);
    if (connect.status !== 0) {
      const detail = connectPayload.error || connect.stderr.trim() || connect.stdout.trim() || `exit ${connect.status}`;
      this.lastError = detail.slice(0, 600);
      throw new Error(`tunnel-client connect failed: ${detail}`);
    }

    const status = this.readStatus();
    this.applyStatus(status);
    if (!this.connected || !this.ready) {
      const state = status.runtime_state ? ` (${status.runtime_state})` : "";
      throw new Error(`OpenAI tunnel runtime started but is not ready${state}`);
    }
    if (status.tunnel_id && status.tunnel_id !== this.tunnel.tunnelId) {
      throw new Error("OpenAI tunnel runtime alias resolved to a different tunnel id");
    }
    this.logger.info(`OpenAI Secure MCP Tunnel ready: ${this.tunnel.tunnelId}`);
    return null;
  }

  async stop(): Promise<void> {
    const bin = this.binary();
    if (!bin) {
      this.connected = false;
      this.ready = false;
      return;
    }
    const result = this.run(["runtimes", "stop", this.alias, "--json"]);
    if (result.status !== 0) {
      const payload = parseOpenAIRuntimeStatus(result.stdout);
      const detail = payload.error || result.stderr.trim() || result.stdout.trim() || `exit ${result.status}`;
      this.lastError = detail.slice(0, 600);
      throw new Error(`tunnel-client stop failed: ${detail}`);
    }
    this.connected = false;
    this.ready = false;
    this.uiUrl = null;
  }

  async restart(localPort: number): Promise<string | null> {
    await this.stop().catch(() => undefined);
    return this.start(localPort);
  }

  status(): TunnelStatus {
    return {
      running: this.connected,
      url: null,
      provider: this.name,
      tunnelId: this.tunnel.tunnelId,
      ready: this.ready,
      detail: this.lastError ?? undefined,
      uiUrl: this.uiUrl ?? undefined,
    };
  }

  getPublicUrl(): string | null {
    return null;
  }

  async doctor(): Promise<TunnelDoctorReport> {
    const bin = this.binary();
    const problems: string[] = [];
    if (!bin) problems.push("tunnel-client binary not found");
    if (!process.env[this.runtimeKeyEnv]) problems.push(`${this.runtimeKeyEnv} is not set`);
    if (bin) {
      try {
        const payload = this.readStatus();
        this.applyStatus(payload);
        if (!this.connected) problems.push("managed tunnel runtime is not running");
        if (this.connected && !this.ready) problems.push("managed tunnel runtime is not ready");
      } catch (error) {
        problems.push((error as Error).message);
      }
    }
    return {
      provider: this.name,
      binaryFound: bin !== null,
      binaryPath: bin,
      running: this.connected,
      url: null,
      tunnelId: this.tunnel.tunnelId,
      ready: this.ready,
      problems,
    };
  }
}
