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
    expect(html).toContain('<span class="brand-mark">X_</span> ChatX');
    expect(html).toContain('id="watcherToggle"');
    expect(html).toContain('id="sessionGuardToggle"');
    expect(html).toContain('id="agentBridgeToggle"');
    expect(html).toContain('id="agentBridgeControls" hidden');
    expect(html).toContain('data-i18n="developer"');
    expect(html).toContain('data-i18n="auditor"');
    expect(html).toContain('data-i18n="task">任务');
    expect(html).toContain('data-i18n="maxRounds">最大轮数');
    expect(html).toContain('data-i18n="maxGenerations">最大代数');
    expect(popup).toContain('setFeature("watcher"');
    expect(popup).toContain('setFeature("sessionGuard"');
    expect(popup).toContain('setFeature("agentBridge"');
    expect(popup).toContain('$("agentBridgeControls").hidden = !features.agentBridge');
    expect(popup).toContain("Ui.stop()");
    for (const forbidden of ["timeline", "requestId", "tabId", "completion marker", "storage 原始状态"]) {
      expect(html).not.toContain(forbidden);
    }
  });

  it("adds one ChatGPT-only floating launcher backed by the same UI API", () => {
    const html = read("popup.html");
    const popup = read("popup.js");
    const uiPrefs = read("src/ui-prefs.js");
    const uiApi = read("src/ui-api.js");
    const floating = read("src/floating-ui.js");
    const background = read("src/background.js");
    const bridgeBackground = read("src/agent-bridge/background.js");
    const manifest = JSON.parse(read("manifest.json")) as {
      action: { default_icon: Record<string, string> };
      icons: Record<string, string>;
      content_scripts: Array<{ matches: string[]; js: string[] }>;
      web_accessible_resources: Array<{ resources: string[]; matches: string[] }>;
    };

    expect(html).toContain('src="icons/icon32.png"');
    expect(html).toContain('src="src/ui-prefs.js"');
    expect(html).toContain('src="src/ui-api.js"');
    expect(popup).toContain("const Ui = globalThis.ChatXUiApi");
    expect(popup).not.toContain("chrome.runtime.sendMessage");
    expect(floating).toContain('const HOST_ID = "chatx-floating-controls"');
    expect(floating).toContain('panel.className = "panel"');
    expect(floating).toContain("panel.hidden = true");
    expect(floating).toContain('launcher.setAttribute("aria-expanded", "false")');
    expect(floating).toContain('$("agentBridgeControls").hidden = !features.agentBridge');
    expect(floating).toContain('Ui.setFeature(name, enabled)');
    expect(floating).toContain('Ui.assign("developer")');
    expect(floating).toContain('Ui.assign("auditor")');
    expect(floating).toContain("Ui.start({");
    expect(floating).toContain("Ui.stop()");
    for (const label of ["任务监听", "会话保护", "Agent Bridge / 智能协作", "开发者", "审计者", "任务", "最大轮数", "最大代数", "STATUS", "X_", "第 1 代 / 第 0 轮"]) {
      expect(floating).toContain(label);
    }
    for (const forbidden of ["timeline", "requestId", "completion marker", "storage 原始状态"]) {
      expect(floating).not.toContain(forbidden);
    }

    expect(uiApi).toContain('message("CHATX_GET_FEATURES")');
    expect(uiApi).toContain('message("CHATX_SET_FEATURE"');
    expect(uiApi).toContain('message("BRIDGE_UI_STATE")');
    expect(uiApi).toContain('message("BRIDGE_ASSIGN"');
    expect(uiApi).toContain('message("BRIDGE_START"');
    expect(uiApi).toContain('message("BRIDGE_STOP")');
    expect(background).toContain("function isUiSender(sender)");
    expect(background).toContain('url.hostname === "chatgpt.com"');
    expect(bridgeBackground).toContain("isChatGptTab(sender.tab)");
    expect(bridgeBackground).toContain("message.tabId ?? contentTabId");
    expect(bridgeBackground).toContain("message.triggerTabId ?? contentTabId");

    expect(manifest.content_scripts[2].matches).toEqual(["https://chatgpt.com/*"]);
    expect(manifest.content_scripts[2].js).toContain("src/ui-prefs.js");
    expect(manifest.content_scripts[2].js).toContain("src/ui-api.js");
    expect(manifest.content_scripts[2].js).toContain("src/floating-ui.js");
    expect(manifest.web_accessible_resources).toEqual([{
      resources: ["icons/icon32.png"],
      matches: ["https://chatgpt.com/*"],
    }]);
    expect(manifest.action.default_icon).toEqual(manifest.icons);
    expect(Object.keys(manifest.icons).sort()).toEqual(["128", "16", "32", "48"].sort());
    expect(fs.existsSync(path.join(extensionRoot, "icons", "chatx.svg"))).toBe(true);
    for (const size of [16, 32, 48, 128]) {
      expect(fs.statSync(path.join(extensionRoot, "icons", `icon${size}.png`)).size).toBeGreaterThan(0);
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

  it("keeps true-to-false transitions persisted for all three top-level features", async () => {
    const values = new Map<string, unknown>([["features", {
      watcher: true,
      sessionGuard: true,
      agentBridge: true,
    }]]);
    const chrome = {
      storage: {
        local: {
          async get(key: string) {
            return { [key]: values.get(key) };
          },
          async set(next: Record<string, unknown>) {
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
      set(name: string, enabled: boolean): Promise<Record<string, boolean>>;
    };

    for (const name of ["watcher", "sessionGuard", "agentBridge"]) {
      await features.set(name, true);
      const disabled = await features.set(name, false);
      expect(disabled[name]).toBe(false);
      expect((values.get("features") as Record<string, boolean>)[name]).toBe(false);
    }

    expect(JSON.parse(JSON.stringify(await features.get()))).toEqual({
      watcher: false,
      sessionGuard: false,
      agentBridge: false,
    });
  });

  it("registers feature messaging synchronously and keeps storage-driven UI off", () => {
    const background = read("src/background.js");
    const popup = read("popup.js");
    const floating = read("src/floating-ui.js");

    expect(background).not.toContain("await Features.ensure()");
    const readyIndex = background.indexOf("const featuresReady = Features.ensure()");
    const listenerIndex = background.indexOf("chrome.runtime.onMessage.addListener");
    const awaitReadyIndex = background.indexOf("await featuresReady", listenerIndex);
    expect(readyIndex).toBeGreaterThanOrEqual(0);
    expect(listenerIndex).toBeGreaterThan(readyIndex);
    expect(awaitReadyIndex).toBeGreaterThan(listenerIndex);

    for (const source of [popup, floating]) {
      expect(source).toContain('$("watcherToggle").checked = features.watcher');
      expect(source).toContain('$("sessionGuardToggle").checked = features.sessionGuard');
      expect(source).toContain('$("agentBridgeToggle").checked = features.agentBridge');
      const storageStart = source.indexOf("chrome.storage.onChanged.addListener");
      expect(storageStart).toBeGreaterThan(0);
      const storageBlock = source.slice(storageStart);
      expect(storageBlock).toContain("features = Features.normalize(changes[Features.KEY].newValue)");
      expect(storageBlock).toContain("renderFeatures()");
      expect(storageBlock).not.toContain("Features.set(");
      expect(storageBlock).not.toContain("Ui.setFeature(");
      expect(storageBlock).not.toContain("chrome.storage.local.set(");
    }
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
    expect(content).toContain("setEnabled(next.watcher)");
    expect(content).toMatch(/function setEnabled\(next\) \{[\s\S]*?else \{\r?\n      detachObservers\(\);/);
    expect(overlay).toContain("ChatXFeatures.get()");
    expect(overlay).toContain("if (!next.watcher) removeOverlay()");
  });

  it("gates Session Guard through features.sessionGuard and keeps its existing restore path", () => {
    const content = read("src/session-guard/content.js");

    expect(content).toContain("sessionGuardEnabled = (await globalThis.ChatXFeatures.get()).sessionGuard");
    expect(content).toContain("sessionGuardEnabled = globalThis.ChatXFeatures.normalize(changes[globalThis.ChatXFeatures.KEY].newValue).sessionGuard");
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
    const rootSetIndex = rootBackground.indexOf("const features = await Features.set(message.feature, message.enabled)");
    const rootStopIndex = rootBackground.indexOf("await globalThis.ChatXAgentBridge?.stopForFeatureDisable?.()");
    const rootResponseIndex = rootBackground.indexOf("sendResponse({ ok: true, features })", rootStopIndex);
    expect(rootSetIndex).toBeGreaterThan(0);
    expect(rootStopIndex).toBeGreaterThan(rootSetIndex);
    expect(rootResponseIndex).toBeGreaterThan(rootStopIndex);
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

    for (const functionName of ["onTurnSent", "onTurnComplete", "onTurnFailed", "resumeRollover"]) {
      const functionStart = background.indexOf(`async function ${functionName}`);
      const featureGuard = background.indexOf("if (!(await isFeatureEnabled())) return;", functionStart);
      expect(functionStart).toBeGreaterThan(0);
      expect(featureGuard).toBeGreaterThan(functionStart);
      expect(featureGuard - functionStart).toBeLessThan(160);
    }

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
      "src/ui-prefs.js",
      "src/ui-api.js",
      "src/floating-ui.js",
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
