import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface BrowserEnvironment {
  CHATX_BROWSER_BIN?: string;
  HOME?: string;
  LOCALAPPDATA?: string;
  PROGRAMFILES?: string;
  "PROGRAMFILES(X86)"?: string;
}

export function browserExecutableCandidates(
  platform: NodeJS.Platform = process.platform,
  env: BrowserEnvironment = process.env
): string[] {
  const explicit = env.CHATX_BROWSER_BIN?.trim();
  const home = env.HOME?.trim() || os.homedir();
  const candidates: string[] = [];

  if (explicit) {
    const resolver = platform === "win32" ? path.win32 : path.posix;
    candidates.push(resolver.resolve(explicit));
  }

  if (platform === "win32") {
    const join = path.win32.join;
    const programFiles = env.PROGRAMFILES?.trim() || "C:\\Program Files";
    const programFilesX86 = env["PROGRAMFILES(X86)"]?.trim() || "C:\\Program Files (x86)";
    const localAppData = env.LOCALAPPDATA?.trim();
    candidates.push(
      join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
      join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
      join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe")
    );
    if (localAppData) {
      candidates.push(
        join(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
        join(localAppData, "Microsoft", "Edge", "Application", "msedge.exe")
      );
    }
  } else if (platform === "darwin") {
    const join = path.posix.join;
    const appRoots = ["/Applications", join(home, "Applications")];
    for (const root of appRoots) {
      candidates.push(
        join(root, "Google Chrome.app", "Contents", "MacOS", "Google Chrome"),
        join(root, "Microsoft Edge.app", "Contents", "MacOS", "Microsoft Edge"),
        join(root, "Chromium.app", "Contents", "MacOS", "Chromium"),
        join(root, "Google Chrome Canary.app", "Contents", "MacOS", "Google Chrome Canary")
      );
    }
  } else {
    candidates.push(
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/usr/bin/microsoft-edge",
      "/usr/bin/microsoft-edge-stable"
    );
  }

  return [...new Set(candidates.filter(Boolean))];
}

export function findBrowserExecutable(
  platform: NodeJS.Platform = process.platform,
  env: BrowserEnvironment = process.env
): string {
  const found = browserExecutableCandidates(platform, env).find((candidate) => {
    try {
      return fs.statSync(candidate).isFile();
    } catch {
      return false;
    }
  });

  if (found) return found;

  throw new Error(
    `No supported Chrome, Chromium, or Edge installation was found for ${platform}. ` +
      "Install a supported browser or set CHATX_BROWSER_BIN to its executable path."
  );
}
