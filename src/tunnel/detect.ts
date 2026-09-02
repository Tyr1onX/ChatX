import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const COMMON_DIRS = [
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
  path.join(process.env.HOME ?? "", ".local", "bin"),
  "C:\\Program Files\\cloudflared",
  "C:\\Program Files (x86)\\cloudflared",
];

const BINARY_ENV: Record<string, string> = {
  "tunnel-client": "TUNNEL_CLIENT_BIN",
};

function explicitBinary(name: string): string | null {
  const envName = BINARY_ENV[name];
  if (!envName) return null;
  const candidate = process.env[envName]?.trim();
  if (!candidate) return null;
  try {
    if (!fs.existsSync(candidate)) return null;
    fs.accessSync(candidate, fs.constants.X_OK);
    return candidate;
  } catch {
    return null;
  }
}

/** Locate a binary from an explicit environment override, PATH, or common install locations. */
export function findBinary(name: string): string | null {
  const explicit = explicitBinary(name);
  if (explicit) return explicit;
  const exe = process.platform === "win32" ? `${name}.exe` : name;
  try {
    const probe = spawnSync(exe, ["--version"], { stdio: "ignore", timeout: 5000, windowsHide: true });
    if (probe.status === 0 || probe.status === 1) return exe; // on PATH
  } catch {
    // not on PATH
  }
  for (const dir of COMMON_DIRS) {
    const full = path.join(dir, exe);
    try {
      if (fs.existsSync(full)) {
        fs.accessSync(full, fs.constants.X_OK);
        return full;
      }
    } catch {
      // try next
    }
  }
  return null;
}

export interface TunnelBinaries {
  cloudflared: string | null;
  wrangler: string | null;
  tunnelClient: string | null;
}

export function detectTunnelBinaries(): TunnelBinaries {
  return {
    cloudflared: findBinary("cloudflared"),
    wrangler: findBinary("wrangler"),
    tunnelClient: findBinary("tunnel-client"),
  };
}
