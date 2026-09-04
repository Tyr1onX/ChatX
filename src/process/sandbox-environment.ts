import path from "node:path";

export type SandboxEnvironment = Readonly<Record<string, string>>;

export interface SandboxEnvironmentInput {
  privateHome: string;
  privateTemp: string;
  hostEnvironment?: Readonly<NodeJS.ProcessEnv>;
  platform?: NodeJS.Platform;
}

const COMMON_HOST_ALLOWLIST = [
  "PATH",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "COLORTERM",
  "NO_COLOR",
] as const;

const WINDOWS_HOST_ALLOWLIST = [
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "PATHEXT",
] as const;

function requireAbsoluteDirectory(name: string, value: string): void {
  if (value.trim() === "" || !path.isAbsolute(value) || value.includes("\0")) {
    throw new TypeError(`${name} must be an absolute directory path.`);
  }
}

function readHostValue(
  hostEnvironment: Readonly<NodeJS.ProcessEnv>,
  name: string,
  platform: NodeJS.Platform
): string | undefined {
  if (platform !== "win32") return hostEnvironment[name];
  const entry = Object.entries(hostEnvironment).find(
    ([candidate]) => candidate.toUpperCase() === name
  );
  return entry?.[1];
}

/**
 * Build the complete environment for a sandboxed process.
 *
 * The result starts empty. Host values enter it only through the explicit
 * allowlists above; private home/temp variables are always set by policy.
 */
export function buildSandboxEnvironment(input: SandboxEnvironmentInput): SandboxEnvironment {
  requireAbsoluteDirectory("privateHome", input.privateHome);
  requireAbsoluteDirectory("privateTemp", input.privateTemp);

  const platform = input.platform ?? process.platform;
  const hostEnvironment = input.hostEnvironment ?? process.env;
  const environment = Object.create(null) as Record<string, string>;

  for (const name of COMMON_HOST_ALLOWLIST) {
    const value = readHostValue(hostEnvironment, name, platform);
    if (value !== undefined) environment[name] = value;
  }
  if (platform === "win32") {
    for (const name of WINDOWS_HOST_ALLOWLIST) {
      const value = readHostValue(hostEnvironment, name, platform);
      if (value !== undefined) environment[name] = value;
    }
  }

  environment.HOME = input.privateHome;
  environment.USERPROFILE = input.privateHome;
  environment.APPDATA = input.privateHome;
  environment.LOCALAPPDATA = input.privateHome;
  environment.TMP = input.privateTemp;
  environment.TEMP = input.privateTemp;
  environment.TMPDIR = input.privateTemp;

  return Object.freeze(environment);
}
