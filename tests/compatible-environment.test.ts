import { describe, expect, it } from "vitest";
import { buildCompatibleProcessEnvironment } from "../src/process/compatible-environment.js";

describe("buildCompatibleProcessEnvironment", () => {
  it("preserves reviewed Windows runtime/toolchain variables case-insensitively", () => {
    const env = buildCompatibleProcessEnvironment({
      platform: "win32",
      hostEnvironment: {
        Path: "C:\\Tools;C:\\Windows\\System32",
        pathext: ".COM;.EXE;.BAT;.CMD",
        ComSpec: "C:\\Windows\\System32\\cmd.exe",
        SystemRoot: "C:\\Windows",
        USERPROFILE: "C:\\Users\\demo",
        APPDATA: "C:\\Users\\demo\\AppData\\Roaming",
        LOCALAPPDATA: "C:\\Users\\demo\\AppData\\Local",
        TEMP: "C:\\Temp",
        VSCMD_ARG_TGT_ARCH: "x64",
        VSINSTALLDIR: "C:\\VS",
      },
    });

    expect(env.PATH).toBe("C:\\Tools;C:\\Windows\\System32");
    expect(env.PATHEXT).toBe(".COM;.EXE;.BAT;.CMD");
    expect(env.COMSPEC).toBe("C:\\Windows\\System32\\cmd.exe");
    expect(env.SYSTEMROOT).toBe("C:\\Windows");
    expect(env.USERPROFILE).toBe("C:\\Users\\demo");
    expect(env.APPDATA).toContain("AppData");
    expect(env.LOCALAPPDATA).toContain("AppData");
    expect(env.TEMP).toBe("C:\\Temp");
    expect(env.VSCMD_ARG_TGT_ARCH).toBe("x64");
    expect(env.VSINSTALLDIR).toBe("C:\\VS");
  });

  it("preserves reviewed Unix locale and toolchain variables", () => {
    const env = buildCompatibleProcessEnvironment({
      platform: "linux",
      hostEnvironment: {
        PATH: "/usr/local/bin:/usr/bin",
        HOME: "/home/demo",
        LANG: "en_US.UTF-8",
        LC_MESSAGES: "C.UTF-8",
        JAVA_HOME: "/opt/jdk",
        CARGO_HOME: "/home/demo/.cargo",
      },
    });

    expect(env).toMatchObject({
      PATH: "/usr/local/bin:/usr/bin",
      HOME: "/home/demo",
      LANG: "en_US.UTF-8",
      LC_MESSAGES: "C.UTF-8",
      JAVA_HOME: "/opt/jdk",
      CARGO_HOME: "/home/demo/.cargo",
    });
  });

  it("strips credentials, agent sockets, runtime injection, and unknown variables", () => {
    const env = buildCompatibleProcessEnvironment({
      platform: "linux",
      hostEnvironment: {
        PATH: "/usr/bin",
        OPENAI_API_KEY: "openai-secret",
        ANTHROPIC_API_KEY: "anthropic-secret",
        GITHUB_TOKEN: "github-secret",
        GH_TOKEN: "gh-secret",
        AWS_SECRET_ACCESS_KEY: "aws-secret",
        AZURE_CLIENT_SECRET: "azure-secret",
        GOOGLE_APPLICATION_CREDENTIALS: "/tmp/google-secret.json",
        CLOUDFLARE_API_TOKEN: "cf-secret",
        SSH_AUTH_SOCK: "/tmp/ssh-agent.sock",
        SSH_AGENT_PID: "123",
        NPM_TOKEN: "npm-secret",
        NODE_AUTH_TOKEN: "node-auth-secret",
        NODE_OPTIONS: "--require /tmp/inject.js",
        NODE_PATH: "/tmp/modules",
        PYTHONPATH: "/tmp/python",
        PYTHONHOME: "/tmp/python-home",
        LD_PRELOAD: "/tmp/inject.so",
        DYLD_INSERT_LIBRARIES: "/tmp/inject.dylib",
        CHATX_INTERNAL_TOKEN: "chatx-secret",
        C2C_INTERNAL_SECRET: "legacy-secret",
        CHATX_TEST_SECRET: "test-secret",
        MY_RANDOM_SECRET_VALUE: "unknown-secret",
      },
    });

    expect(env.PATH).toBe("/usr/bin");
    for (const key of [
      "OPENAI_API_KEY",
      "ANTHROPIC_API_KEY",
      "GITHUB_TOKEN",
      "GH_TOKEN",
      "AWS_SECRET_ACCESS_KEY",
      "AZURE_CLIENT_SECRET",
      "GOOGLE_APPLICATION_CREDENTIALS",
      "CLOUDFLARE_API_TOKEN",
      "SSH_AUTH_SOCK",
      "SSH_AGENT_PID",
      "NPM_TOKEN",
      "NODE_AUTH_TOKEN",
      "NODE_OPTIONS",
      "NODE_PATH",
      "PYTHONPATH",
      "PYTHONHOME",
      "LD_PRELOAD",
      "DYLD_INSERT_LIBRARIES",
      "CHATX_INTERNAL_TOKEN",
      "C2C_INTERNAL_SECRET",
      "CHATX_TEST_SECRET",
      "MY_RANDOM_SECRET_VALUE",
    ]) {
      expect(env).not.toHaveProperty(key);
    }
  });

  it("does not pass arbitrary npm, proxy, or git execution configuration by default", () => {
    const env = buildCompatibleProcessEnvironment({
      platform: "linux",
      hostEnvironment: {
        PATH: "/usr/bin",
        NPM_CONFIG_CACHE: "/tmp/npm-cache",
        NPM_CONFIG_PREFIX: "/opt/npm",
        NPM_CONFIG_USERCONFIG: "/home/demo/.npmrc",
        NPM_CONFIG__AUTH_TOKEN: "secret",
        HTTPS_PROXY: "http://user:pass@proxy.example",
        GIT_SSH_COMMAND: "evil-wrapper",
      },
    });

    expect(env.NPM_CONFIG_CACHE).toBe("/tmp/npm-cache");
    expect(env.NPM_CONFIG_PREFIX).toBe("/opt/npm");
    expect(env).not.toHaveProperty("NPM_CONFIG_USERCONFIG");
    expect(env).not.toHaveProperty("NPM_CONFIG__AUTH_TOKEN");
    expect(env).not.toHaveProperty("HTTPS_PROXY");
    expect(env).not.toHaveProperty("GIT_SSH_COMMAND");
  });

  it("returns an immutable environment object", () => {
    const env = buildCompatibleProcessEnvironment({
      hostEnvironment: { PATH: "/usr/bin" },
      platform: "linux",
    });

    expect(Object.isFrozen(env)).toBe(true);
  });
});
