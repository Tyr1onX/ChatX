import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionRoot = path.join(repoRoot, "extensions", "chatx");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(extensionRoot, relativePath), "utf8");
}

describe("ChatX unified browser extension", () => {
  it("keeps one popup with exactly three top-level feature toggles", () => {
    const html = read("popup.html");
    const popup = read("popup.js");
    const manifest = JSON.parse(read("manifest.json")) as { action: { default_popup: string } };

    expect(manifest.action.default_popup).toBe("popup.html");
    expect(html).toContain("<h1>ChatX</h1>");
    expect(html).toContain('id="watcherToggle"');
    expect(html).toContain('id="sessionGuardToggle"');
    expect(html).toContain('id="agentBridgeToggle"');
    expect(html).toContain('id="agentBridgeControls" hidden');
    expect(html).toContain("Developer: <strong");
    expect(html).toContain("Auditor: <strong");
    expect(html).toContain("Task");
    expect(html).toContain("Max rounds");
    expect(html).toContain("Max generations");
    expect(popup).toContain('setFeature("watcher"');
    expect(popup).toContain('setFeature("sessionGuard"');
    expect(popup).toContain('setFeature("agentBridge"');
    expect(popup).toContain('$("agentBridgeControls").hidden = !features.agentBridge');
    expect(popup).toContain('bridge("BRIDGE_STOP")');
    for (const forbidden of ["timeline", "requestId", "tabId", "completion marker", "storage 原始状态"]) {
      expect(html).not.toContain(forbidden);
    }
  });

  it("persists only the shared features object for top-level feature state", async () => {
    const values = new Map<string, unknown>();
    const writes: Record<string, unknown>[] = [];
    const chrome = {
      storage: {
        local: {
          async get(key: string) {
            return { [key]: values.get(key) };
          },
          async set(next: Record<string, unknown>) {
            writes.push(next);
            for (const [key, value] of Object.entries(next)) values.set(key, value);
          },
        },
      },
    };
    const context: Record<string, unknown> = { chrome };
    context.globalThis = context;
    vm.runInNewContext(read("src/features.js"), context);
    const features = context.ChatXFeatures as {
      get(): Promise<Record<string, boolean>>;
      ensure(): Promise<Record<string, boolean>>;
      set(name: string, enabled: boolean): Promise<Record<string, boolean>>;
    };

    expect(JSON.parse(JSON.stringify(await features.get()))).toEqual({
      watcher: true,
      sessionGuard: true,
      agentBridge: false,
    });
    await features.ensure();
    expect(writes.map((write) => Object.keys(write))).toEqual([["features"]]);
    values.set("features", { watcher: true, sessionGuard: true, agentBridge: false, legacy: true });
    await features.ensure();
    expect(JSON.parse(JSON.stringify(values.get("features")))).toEqual({
      watcher: true,
      sessionGuard: true,
      agentBridge: false,
    });
    expect(JSON.parse(JSON.stringify(await features.set("agentBridge", true)))).toEqual({
      watcher: true,
      sessionGuard: true,
      agentBridge: true,
    });
    await Promise.all([
      features.set("watcher", false),
      features.set("sessionGuard", false),
    ]);
    expect(JSON.parse(JSON.stringify(await features.get()))).toEqual({
      watcher: false,
      sessionGuard: false,
      agentBridge: true,
    });
    expect(writes.every((write) => Object.keys(write).length === 1 && "features" in write)).toBe(true);
  });

  it("gates Watcher execution and removes its legacy enable state", () => {
    const background = read("src/watcher/background.js");
    const content = read("src/watcher/content.js");
    const overlay = read("src/watcher/overlay.js");

    expect(background).toContain("const features = await Features.get()");
    expect(background).toContain("return features.watcher");
    expect(background).not.toContain("SETTINGS_KEY");
    expect(background).not.toContain("SET_ENABLED");
    expect(background).toContain("if (!task) return false");
    expect(content).toContain("ChatXFeatures.get()");
    expect(content).toContain("detachObservers()");
    expect(overlay).toContain("ChatXFeatures.get()");
    expect(overlay).toContain("if (!next.watcher) removeOverlay()");
  });

  it("gates Session Guard through features.sessionGuard and keeps its existing restore path", () => {
    const content = read("src/session-guard/content.js");

    expect(content).toContain("sessionGuardEnabled = (await globalThis.ChatXFeatures.get()).sessionGuard");
    expect(content).toContain("enabled: sessionGuardEnabled");
    expect(content).toContain("controller?.updateConfig(runtime)");
    expect(content).toContain("SESSION_GUARD_DISABLED");
    expect(content).toContain("let { enabled: _enabled, ...storedConfig } = config");
    expect(content).toContain('"enabled" in value');
    expect(content).toContain("restoreAllVisualState()");
  });

  it("gates Agent Bridge sends, rollover and replacement-tab creation while retaining terminal send guard", () => {
    const rootBackground = read("src/background.js");
    const background = read("src/agent-bridge/background.js");
    const content = read("src/agent-bridge/content.js");

    expect(background).toContain("AGENT_BRIDGE_DISABLED");
    expect(background).toContain("RUN_TERMINATED_NO_SEND");
    expect(background).toContain("async function resumeRollover");
    expect(background).toContain("if (!(await isFeatureEnabled())) return");
    expect(background).toContain("async function createRolloverTab");
    const createStart = background.indexOf("async function createRolloverTab");
    const tabCreate = background.indexOf("chrome.tabs.create", createStart);
    const createGuard = background.lastIndexOf("await assertFeatureEnabled()", tabCreate);
    expect(createGuard).toBeGreaterThan(createStart);
    expect(createGuard).toBeLessThan(tabCreate);
    expect(background).not.toContain("chrome.action.onClicked");
    expect(background).toContain("stopForFeatureDisable: stopUser");
    expect(rootBackground).toContain("await globalThis.ChatXAgentBridge?.stopForFeatureDisable?.()");
    expect(background).toMatch(/async function restoreRolloverSafely\(state\) \{\r?\n  if \(!\(await isFeatureEnabled\(\)\)\) return/);

    const stopStart = background.indexOf("async function stopUser()");
    const stopEnd = background.indexOf("async function onTurnFailed", stopStart);
    const stopBlock = background.slice(stopStart, stopEnd);
    expect(stopBlock).toContain("...state");
    expect(stopBlock).toContain('status: "STOPPED_USER"');
    expect(stopBlock).toContain("expected: null");
    expect(stopBlock).not.toContain("latestDeveloperHandoff: null");
    expect(stopBlock).not.toContain("latestAuditorVerdict: null");
    expect(stopBlock).not.toContain("checkpoint: null");

    const clickIndex = content.indexOf("sendButton.click()");
    const guardIndex = content.lastIndexOf("await assertFeatureEnabled()", clickIndex);
    expect(clickIndex).toBeGreaterThan(0);
    expect(guardIndex).toBeGreaterThan(0);
    expect(guardIndex).toBeLessThan(clickIndex);
  });

  it("does not add polling to the unified extension", () => {
    const files = [
      "src/background.js",
      "src/features.js",
      "src/watcher/background.js",
      "src/watcher/content.js",
      "src/watcher/overlay.js",
      "src/session-guard/content.js",
      "src/session-guard/main-world.js",
      "src/agent-bridge/background.js",
      "src/agent-bridge/content.js",
      "popup.js",
    ];
    expect(files.map(read).join("\n")).not.toMatch(/\bsetInterval\s*\(/);
  });
});
