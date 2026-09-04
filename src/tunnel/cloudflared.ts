import { spawn, type ChildProcess } from "node:child_process";
import readline from "node:readline";
import type { Logger } from "../logger/index.js";
import { nullLogger } from "../logger/index.js";
import { findBinary } from "./detect.js";
import type { TunnelProvider, TunnelStatus } from "./provider.js";

const QUICK_TUNNEL_URL_RE = /https:\/\/[a-z0-9][a-z0-9-]*\.trycloudflare\.com/i;

export function parseQuickTunnelUrl(line: string): string | null {
  return line.match(QUICK_TUNNEL_URL_RE)?.[0] ?? null;
}

export class CloudflaredQuickTunnel implements TunnelProvider {
  readonly name = "cloudflare-quick";
  private child: ChildProcess | null = null;
  private url: string | null = null;
  private lastError: string | null = null;

  constructor(
    private readonly logger: Logger = nullLogger,
    private readonly binaryOverride?: string
  ) {}

  private binary(): string | null {
    return this.binaryOverride ?? findBinary("cloudflared");
  }

  async start(localPort: number): Promise<string> {
    if (this.child && this.url) return this.url;
    const bin = this.binary();
    if (!bin) {
      throw new Error("cloudflared is not installed. Install it (e.g. `brew install cloudflared`) and retry.");
    }

    return new Promise<string>((resolve, reject) => {
      const child = spawn(
        bin,
        ["tunnel", "--url", `http://127.0.0.1:${localPort}`, "--no-autoupdate"],
        { stdio: ["ignore", "pipe", "pipe"], windowsHide: true }
      );
      this.child = child;
      this.url = null;
      this.lastError = null;
      let established = false;
      let childLastError: string | null = null;

      const timeout = setTimeout(() => {
        if (established) return;
        if (this.child === child) {
          this.logger.error("Quick tunnel did not produce a URL within 45s");
          child.kill("SIGTERM");
        }
        reject(new Error("Tunnel start timed out"));
      }, 45_000);

      const scan = (stream: NodeJS.ReadableStream): void => {
        const rl = readline.createInterface({ input: stream });
        rl.on("line", (line) => {
          const url = parseQuickTunnelUrl(line);
          if (url && this.child === child && !established) {
            established = true;
            this.url = url;
            clearTimeout(timeout);
            this.logger.info(`Quick tunnel established: ${url}`);
            resolve(url);
          }
          if (/error/i.test(line)) {
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
        clearTimeout(timeout);
        if (this.child === child) {
          this.child = null;
          this.url = null;
        }
        reject(error);
      });
      child.on("exit", (code) => {
        clearTimeout(timeout);
        const wasStarting = !established;
        this.logger.warn(`cloudflared exited with code ${code}`);
        if (this.child === child) {
          this.child = null;
          this.url = null;
        }
        if (wasStarting) {
          reject(
            new Error(
              `cloudflared exited (code ${code}) before establishing a tunnel${
                childLastError ? `: ${childLastError}` : ""
              }`
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
    this.url = null;
  }

  status(): TunnelStatus {
    return {
      running: this.child !== null && this.url !== null,
      url: this.url,
      provider: this.name,
      detail: this.lastError ?? undefined,
    };
  }
}
