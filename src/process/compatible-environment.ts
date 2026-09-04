export type CompatibleEnvironment = Readonly<Record<string, string>>;

export interface CompatibleEnvironmentInput {
  hostEnvironment?: Readonly<NodeJS.ProcessEnv>;
  platform?: NodeJS.Platform;
}

const COMMON_ALLOWLIST = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMP",
  "TEMP",
  "TMPDIR",
  "LANG",
  "LANGUAGE",
  "TZ",
  "TERM",
  "COLORTERM",
  "NO_COLOR",
  "FORCE_COLOR",
  "JAVA_HOME",
  "JDK_HOME",
  "GOROOT",
  "GOPATH",
  "GOMODCACHE",
  "GOCACHE",
  "CARGO_HOME",
  "RUSTUP_HOME",
  "ANDROID_HOME",
  "ANDROID_SDK_ROOT",
  "GRADLE_USER_HOME",
  "MAVEN_HOME",
  "M2_HOME",
  "DOTNET_ROOT",
  "NUGET_PACKAGES",
  "VCPKG_ROOT",
  "CMAKE_PREFIX_PATH",
  "PKG_CONFIG_PATH",
  "CC",
  "CXX",
  "AR",
  "LD",
  "MAKE",
  "NINJA",
  "SDKROOT",
  "DEVELOPER_DIR",
  "PNPM_HOME",
  "COREPACK_HOME",
  "NPM_CONFIG_CACHE",
  "NPM_CONFIG_PREFIX",
] as const;

const WINDOWS_ALLOWLIST = [
  "PATHEXT",
  "COMSPEC",
  "SYSTEMROOT",
  "WINDIR",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "APPDATA",
  "LOCALAPPDATA",
  "PROGRAMDATA",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "PROGRAMW6432",
  "PUBLIC",
  "SYSTEMDRIVE",
  "OS",
  "PROCESSOR_ARCHITECTURE",
  "PROCESSOR_IDENTIFIER",
  "PROCESSOR_LEVEL",
  "PROCESSOR_REVISION",
  "NUMBER_OF_PROCESSORS",
  "VSINSTALLDIR",
  "VCINSTALLDIR",
  "VCTOOLSINSTALLDIR",
  "WINDOWSSDKDIR",
  "WINDOWSSDKVERSION",
  "UNIVERSALCRTSDKDIR",
  "UCRTVERSION",
  "INCLUDE",
  "LIB",
  "LIBPATH",
] as const;

const FORBIDDEN_EXACT = new Set([
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "SSH_AUTH_SOCK",
  "SSH_AGENT_PID",
  "SSH_ASKPASS",
  "GIT_ASKPASS",
  "GIT_SSH",
  "GIT_SSH_COMMAND",
  "NPM_TOKEN",
  "NODE_AUTH_TOKEN",
  "NODE_OPTIONS",
  "NODE_PATH",
  "PYTHONPATH",
  "PYTHONHOME",
  "RUBYOPT",
  "PERL5OPT",
  "PERL5LIB",
  "BASH_ENV",
  "ENV",
  "LD_PRELOAD",
  "LD_LIBRARY_PATH",
  "CHATX_TEST_SECRET",
]);

const FORBIDDEN_PREFIXES = [
  "OPENAI_",
  "ANTHROPIC_",
  "AWS_",
  "AZURE_",
  "GOOGLE_",
  "CLOUDFLARE_",
  "CHATX_",
  "C2C_",
  "DYLD_",
] as const;

function normalizedName(name: string): string {
  return name.toUpperCase();
}

function isForbidden(name: string): boolean {
  const normalized = normalizedName(name);
  return FORBIDDEN_EXACT.has(normalized)
    || FORBIDDEN_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function readHostValue(
  hostEnvironment: Readonly<NodeJS.ProcessEnv>,
  name: string,
  platform: NodeJS.Platform
): string | undefined {
  if (platform !== "win32") return hostEnvironment[name];
  const entry = Object.entries(hostEnvironment).find(
    ([candidate]) => normalizedName(candidate) === name
  );
  return entry?.[1];
}

function copyAllowed(
  target: Record<string, string>,
  hostEnvironment: Readonly<NodeJS.ProcessEnv>,
  names: readonly string[],
  platform: NodeJS.Platform
): void {
  for (const name of names) {
    if (isForbidden(name)) continue;
    const value = readHostValue(hostEnvironment, name, platform);
    if (value !== undefined) target[name] = value;
  }
}

/**
 * Build the explicit environment used by compatible/trusted-host process execution.
 *
 * Compatible mode still runs with the host user's filesystem authority. This policy
 * only reduces environment-secret leakage and environment-based runtime injection;
 * it is not a filesystem sandbox. Unknown variables are intentionally omitted until
 * they are reviewed and added to the allowlist.
 */
export function buildCompatibleProcessEnvironment(
  input: CompatibleEnvironmentInput = {}
): CompatibleEnvironment {
  const platform = input.platform ?? process.platform;
  const hostEnvironment = input.hostEnvironment ?? process.env;
  const environment = Object.create(null) as Record<string, string>;

  copyAllowed(environment, hostEnvironment, COMMON_ALLOWLIST, platform);
  if (platform === "win32") {
    copyAllowed(environment, hostEnvironment, WINDOWS_ALLOWLIST, platform);
  }

  for (const [name, value] of Object.entries(hostEnvironment)) {
    if (value === undefined || isForbidden(name)) continue;
    const normalized = normalizedName(name);
    if (normalized.startsWith("LC_")) environment[normalized] = value;
    if (platform === "win32" && normalized.startsWith("VSCMD_")) {
      environment[normalized] = value;
    }
  }

  return Object.freeze(environment);
}
