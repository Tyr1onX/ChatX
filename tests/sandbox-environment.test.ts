import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildSandboxEnvironment } from "../src/process/sandbox-environment.js";

function makeDisposableRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "chatx-sandbox-env-"));
}

describe("buildSandboxEnvironment", () => {
  it("starts empty and admits only explicit host variables", () => {
    const root = makeDisposableRoot();
    try {
      const home = path.join(root, "home");
      const temp = path.join(root, "temp");
      fs.mkdirSync(home);
      fs.mkdirSync(temp);
      const hostEnvironment: NodeJS.ProcessEnv = {
        PATH: "allowed-path",
        LANG: "en_US.UTF-8",
        CHATX_SANDBOX_TEST_SECRET: "super-secret",
        AWS_SECRET_ACCESS_KEY: "cloud-secret",
        SSH_AUTH_SOCK: "host-agent",
        NODE_OPTIONS: "--require=host-hook.js",
        UNLISTED_HOST_VALUE: "must-not-cross",
      };

      const environment = buildSandboxEnvironment({
        privateHome: home,
        privateTemp: temp,
        hostEnvironment,
        platform: "linux",
      });

      expect(environment.PATH).toBe("allowed-path");
      expect(environment.LANG).toBe("en_US.UTF-8");
      expect(environment.CHATX_SANDBOX_TEST_SECRET).toBeUndefined();
      expect(environment.AWS_SECRET_ACCESS_KEY).toBeUndefined();
      expect(environment.SSH_AUTH_SOCK).toBeUndefined();
      expect(environment.NODE_OPTIONS).toBeUndefined();
      expect(environment.UNLISTED_HOST_VALUE).toBeUndefined();
      expect(Object.getPrototypeOf(environment)).toBeNull();
      expect(Object.isFrozen(environment)).toBe(true);
      expect(hostEnvironment.HOME).toBeUndefined();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("redirects every home and temp variable to private directories", () => {
    const root = makeDisposableRoot();
    try {
      const home = path.join(root, "sandbox-home");
      const temp = path.join(root, "sandbox-temp");
      fs.mkdirSync(home);
      fs.mkdirSync(temp);
      const environment = buildSandboxEnvironment({
        privateHome: home,
        privateTemp: temp,
        hostEnvironment: {
          HOME: "host-home",
          USERPROFILE: "host-profile",
          APPDATA: "host-appdata",
          LOCALAPPDATA: "host-local-appdata",
          TMP: "host-tmp",
          TEMP: "host-temp",
          TMPDIR: "host-tmpdir",
        },
      });

      expect(environment).toMatchObject({
        HOME: home,
        USERPROFILE: home,
        APPDATA: home,
        LOCALAPPDATA: home,
        TMP: temp,
        TEMP: temp,
        TMPDIR: temp,
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("reads Windows system variables case-insensitively without admitting other values", () => {
    const root = makeDisposableRoot();
    try {
      const home = path.join(root, "home");
      const temp = path.join(root, "temp");
      fs.mkdirSync(home);
      fs.mkdirSync(temp);
      const environment = buildSandboxEnvironment({
        privateHome: home,
        privateTemp: temp,
        platform: "win32",
        hostEnvironment: {
          Path: "windows-path",
          SystemRoot: "C:\\Windows",
          ComSpec: "C:\\Windows\\System32\\cmd.exe",
          PATHEXT: ".COM;.EXE;.CMD",
          USERNAME: "must-not-cross",
        },
      });

      expect(environment.PATH).toBe("windows-path");
      expect(environment.SYSTEMROOT).toBe("C:\\Windows");
      expect(environment.COMSPEC).toBe("C:\\Windows\\System32\\cmd.exe");
      expect(environment.PATHEXT).toBe(".COM;.EXE;.CMD");
      expect(environment.USERNAME).toBeUndefined();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects non-absolute private directories", () => {
    expect(() => buildSandboxEnvironment({
      privateHome: "relative-home",
      privateTemp: path.resolve(os.tmpdir(), "sandbox-temp"),
      hostEnvironment: {},
    })).toThrow(/privateHome must be an absolute directory path/);
  });
});
