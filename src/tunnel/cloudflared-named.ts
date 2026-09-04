import { spawn, type ChildProcess } from "node:child_process";
import readline from "node:readline";
import type { Logger } from "../logger/index.js";
import { nullLogger } from "../logger/index.js";
import { findBinary } from "./detect.js";
import type { TunnelProvider, TunnelStatus } from "./provider.js";

const CONNECTED_RE = /registered tunnel connection/i;
const HOSTNAME_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

export interface CloudflaredNamedTunnelOptions {
  tunnelName: string;
  hostname: string;
  logger?: Logger;
  binaryOverride?: string;
  startTimeoutMs?: number;
}

export function normalizeNamedTunnelHostname(hostname: string): string {
  const normalized = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (!HOSTNAME_RE.test(normalized)) {
    throw new Error(`Invalid named tunnel hostname: ${hostname}`);
  }
  return normalized;
}

export class CloudflaredNamedTunnel implements TunnelProvider {
  readonly name = "cloudflare-named";
  private readonly tunnelName: string;
  private readonly hostname: string;
  private readonly logger: Logger;
  private readonly binaryOverride?: string;
  private readonly startTimeoutMs: number;
  private child: ChildProcess | null = null;
  private connected = false;
  private lastError: string | null = null;

  constructor(opts: CloudflaredNamedTunnelOptions) {
    const tunnelName = opts.tunnelName.trim();
    if (!tunnelName || tunnelName.length > 128) {
      throw new Error("Named tunnel name must be between 1 and 128 characters");
    }
    this.tunnelName = tunnelName;
    this.hostname = normalizeNamedTunnelHostname(opts.hostname);
    this.logger = opts.logger ?? nullLogger;
    this.binaryOverride = opts.binaryOverride;
    this.startTimeoutMs = opts.startTimeoutMs ?? 45_000;
  }

  private binary(): string | null {
    return this.binaryOverride ?? findBinary("cloudflared");
  }

  private publicUrl(): string {
    return `https://${this.hostname}`;
  }

  async start(localPort: number): Promise<string> {
    if (this.child && this.connected) return this.publicUrl();
    const bin = this.binary();
    if (!bin) {
      throw new Error("cloudflared is not installed. Install it (e.g. `brew install cloudflared`) and retry.");
    }

    return new Promise<string>((resolve, reject) => {
      const child = spawn(
        bin,
        [
          "tunnel",
          "--no-autoupdate",
          "--url",
          `http://127.0.0.1:${localPort}`,
          "run",
          this.tunnelName,
        ],
        { stdio: ["ignore", "pipe", "pipe"], windowsHide: true }
      );
      this.child = child;
      this.connected = false;
      this.lastError = null;
      let established = false;
      let childLastError: string | null = null;
      let settled = false;

      const finish = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        fn();
      };
      const timeout = setTimeout(() => {
        if (established) return;
        childLastError = "Named tunnel start timed out";
        if (this.child === child) {
          this.lastError = childLastError;
          child.kill("SIGTERM");
        }
        finish(() => reject(new Error(childLastError ?? "Named tunnel start timed out")));
      }, this.startTimeoutMs);

      const scan = (stream: NodeJS.ReadableStream): void => {
        const rl = readline.createInterface({ input: stream });
        rl.on("line", (line) => {
          if (CONNECTED_RE.test(line) && this.child === child && !established) {
            established = true;
            this.connected = true;
            const url = this.publicUrl();
            this.logger.info(`Named tunnel established: ${url}`);
            finish(() => resolve(url));
          }
          if (/\b(error|failed|fatal)\b/i.test(line)) {
            childLastError = line.slice(0, 400);
            if (this.child === child) {
              this.lastError = childLastError;
              this.logger.debug(`cloudflared: ${childLastError}`);
            }
          }
        });
      };
      if (child.stdout) scan(child.stdout);
      if (child.stderr) scan(child.stderr);

      child.on("error", (error) => {
        if (this.child === child) {
          this.child = null;
          this.connected = false;
        }
        finish(() => reject(error));
      });
      child.on("exit", (code) => {
        const wasStarting = !established;
        this.logger.warn(`cloudflared named tunnel exited with code ${code}`);
        if (this.child === child) {
          this.child = null;
          this.connected = false;
        }
        if (wasStarting) {
          finish(() =>
            reject(
              new Error(
                `cloudflared exited (code ${code}) before establishing the named tunnel${
                  childLastError ? `: ${childLastError}` : ""
                }`
              )
            )
          );
        }
      });
    });
  }

  async stop(): Promise<void> {
    if (this.child) {
      this.child.kill("SIGTERM");
      this.child = null;
    }
    this.connected = false;
  }

  status(): TunnelStatus {
    return {
      running: this.child !== null && this.connected,
      url: this.connected ? this.publicUrl() : null,
      provider: this.name,
      detail: this.lastError ?? undefined,
    };
  }
}
