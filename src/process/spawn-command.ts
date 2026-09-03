import fs from "node:fs";
import path from "node:path";

export interface SpawnCommand {
  command: string;
  args: string[];
  resolvedCommand: string;
  viaWindowsCommandShim: boolean;
}

function windowsPathValue(): string {
  const key = Object.keys(process.env).find((name) => name.toLowerCase() === "path");
  return key ? process.env[key] ?? "" : "";
}

function windowsPathExt(): string[] {
  const raw = process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD";
  const extensions = raw
    .split(";")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  // Prefer native executables over command scripts even if PATHEXT has a
  // surprising order. This keeps the shell-free path whenever possible.
  return [...new Set([".exe", ".com", ...extensions, ".cmd", ".bat"])];
}

function existingFile(candidate: string): string | null {
  try {
    return fs.statSync(candidate).isFile() ? candidate : null;
  } catch {
    return null;
  }
}

function resolveWindowsCommand(command: string): string | null {
  const hasSeparator = command.includes("/") || command.includes("\\");
  const extension = path.extname(command).toLowerCase();
  // On Windows, an extensionless sibling can be a POSIX shim (Corepack ships
  // `pnpm` beside `pnpm.cmd`). Follow PATHEXT-style executable candidates
  // first; only consider the literal extensionless file as a last fallback.
  const candidates = extension
    ? [command]
    : [...windowsPathExt().map((ext) => command + ext), command];

  if (path.isAbsolute(command) || hasSeparator) {
    for (const candidate of candidates) {
      const resolved = existingFile(path.resolve(candidate));
      if (resolved) return resolved;
    }
    return null;
  }

  for (const directory of windowsPathValue().split(path.delimiter).filter(Boolean)) {
    const cleanDirectory = directory.replace(/^"|"$/g, "");
    for (const candidate of candidates) {
      const resolved = existingFile(path.join(cleanDirectory, candidate));
      if (resolved) return resolved;
    }
  }
  return null;
}

/**
 * Resolve a command without enabling `shell: true` globally.
 *
 * Windows .cmd/.bat launchers (npm/pnpm/npx and many node_modules/.bin shims)
 * are not native executables. Node documents that they must be invoked through
 * cmd.exe. Native .exe/.com commands keep the direct shell-free spawn path.
 */
export function prepareSpawnCommand(command: string, args: string[]): SpawnCommand {
  if (process.platform !== "win32") {
    return { command, args: [...args], resolvedCommand: command, viaWindowsCommandShim: false };
  }

  const resolved = resolveWindowsCommand(command);
  if (!resolved) {
    return { command, args: [...args], resolvedCommand: command, viaWindowsCommandShim: false };
  }

  const extension = path.extname(resolved).toLowerCase();
  if (extension === ".cmd" || extension === ".bat") {
    return {
      command: process.env.ComSpec || process.env.COMSPEC || "cmd.exe",
      args: ["/d", "/s", "/c", resolved, ...args],
      resolvedCommand: resolved,
      viaWindowsCommandShim: true,
    };
  }

  return {
    command: resolved,
    args: [...args],
    resolvedCommand: resolved,
    viaWindowsCommandShim: false,
  };
}
