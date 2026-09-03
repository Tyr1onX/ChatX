import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionRoot = path.join(repoRoot, "extensions", "chatx-watcher");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(extensionRoot, relativePath), "utf8");
}

function runtimeSource(): string {
  return [
    read("src/content.js"),
    read("src/background.js"),
    read("src/state.js"),
    read("src/selectors.js"),
    read("src/overlay.js"),
    read("popup.js"),
  ].join("\n");
}

describe("ChatX Watcher extension constraints", () => {
  it("keeps MV3 permissions minimal while separating ChatGPT detection from ordinary-page overlay", () => {
    const manifest = JSON.parse(read("manifest.json")) as {
      manifest_version: number;
      permissions: string[];
      host_permissions: string[];
      content_scripts: Array<{ matches: string[]; js: string[] }>;
    };

    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions.sort()).toEqual(["storage", "tabs"].sort());
    expect(manifest.permissions).not.toContain("notifications");
    expect(manifest.host_permissions.sort()).toEqual(["http://*/*", "https://*/*"].sort());
    expect(manifest.content_scripts).toHaveLength(2);
    expect(manifest.content_scripts[0].matches).toEqual(["https://chatgpt.com/*"]);
    expect(manifest.content_scripts[0].js).toEqual(["src/selectors.js", "src/content.js"]);
    expect(manifest.content_scripts[1].matches.sort()).toEqual(["http://*/*", "https://*/*"].sort());
    expect(manifest.content_scripts[1].js).toEqual(["src/overlay.js"]);
    expect(JSON.stringify(manifest)).not.toContain("<all_urls>");
  });

  it("uses only the in-page completion overlay path", () => {
    const background = read("src/background.js");
    const overlay = read("src/overlay.js");
    const popup = read("popup.js");
    const source = runtimeSource();

    expect(source).not.toContain("chrome.notifications");
    expect(background).not.toContain("chrome.windows.create");
    expect(background).not.toContain('type: "popup"');
    expect(background).not.toContain("popupCreatePromise");
    expect(background).not.toContain("completion=1");
    expect(background).not.toContain("COMPLETION_POPUP");
    expect(background).toContain("SHOW_COMPLETION_OVERLAY");
    expect(background).toContain("HIDE_COMPLETION_OVERLAY");
    expect(background).toContain("OPEN_COMPLETION");
    expect(background).toContain("focusConversation");
    expect(overlay).toContain("SHOW_COMPLETION_OVERLAY");
    expect(overlay).toContain("OPEN_COMPLETION");
    expect(overlay).toContain('view.textContent = "查看 →"');
    expect(popup).not.toContain("completionMode");
    expect(popup).not.toContain("OPEN_COMPLETION");
  });

  it("selects the focused normal window active http/https tab and retries from focus events", () => {
    const background = read("src/background.js");

    expect(background).toContain('getLastFocused({ windowTypes: ["normal"] })');
    expect(background).toContain("if (!windowInfo?.focused");
    expect(background).toContain("{ active: true, windowId: windowInfo.id }");
    expect(background).toContain('tab.url.startsWith("http://")');
    expect(background).toContain('tab.url.startsWith("https://")');
    expect(background).toContain("getUnpresentedDoneRuns(state)[0]");
    expect(background).toContain("markRunPresented");
    expect(background).toContain("chrome.tabs.onActivated.addListener");
    expect(background).toContain("chrome.windows.onFocusChanged.addListener");
  });

  it("keeps close separate from ACK and delegates View to Background", () => {
    const background = read("src/background.js");
    const overlay = read("src/overlay.js");

    expect(overlay).toContain('close.addEventListener("click", () => removeOverlay(runId))');
    expect(overlay).not.toContain("ACK_ELIGIBLE");
    expect(overlay).toContain('chrome.runtime.sendMessage({ type: "OPEN_COMPLETION", runId })');
    expect(background).toContain("await focusConversation(run)");
    expect(background).toContain("await acknowledgeConversation(run.conversationId)");
    expect(background).toContain("await hideOverlay(sender.tab?.id, run.runId)");
  });

  it("uses a single Shadow DOM host and a one-shot animation without polling or network", () => {
    const source = runtimeSource();
    const overlay = read("src/overlay.js");

    expect(overlay).toContain('const HOST_ID = "chatx-completion-overlay"');
    expect(overlay).toContain("removeOverlay();");
    expect(overlay).toContain('host.attachShadow({ mode: "open" })');
    expect(overlay).toContain("position:fixed");
    expect(overlay).toContain("right:22px");
    expect(overlay).toContain("bottom:22px");
    expect(overlay).toContain("z-index:2147483647");
    expect(overlay).toContain('"[._.]"');
    expect(overlay).toContain('"[-_-]"');
    expect(overlay).toContain('"[^_^] !"');
    expect(overlay.match(/\bsetTimeout\s*\(/g)?.length ?? 0).toBe(2);
    expect(overlay).not.toContain("MutationObserver");
    expect(source).not.toMatch(/\bsetInterval\s*\(/);
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/\bXMLHttpRequest\b/);
    expect(source).not.toMatch(/\bWebSocket\b/);
    expect(source).not.toMatch(/requestAnimationFrame/);
    expect(source).not.toMatch(/playwright|puppeteer|electron/i);
  });

  it("uses a bounded number of event-driven DOM observers", () => {
    const content = read("src/content.js");
    const observerCount = content.match(/new MutationObserver\s*\(/g)?.length ?? 0;

    expect(observerCount).toBeGreaterThan(0);
    expect(observerCount).toBeLessThanOrEqual(3);
  });

  it("matches the current ChatGPT generation control without sidebar cancel false positives", () => {
    const selectors = read("src/selectors.js");
    const content = read("src/content.js");

    expect(selectors).toContain('button[data-testid="stop-button"]');
    expect(selectors).not.toContain('aria-label*="取消"');
    expect(selectors).not.toContain('aria-label*="cancel"');
    expect(content).toContain('conversationId?.startsWith("WEB:") ? null : conversationId');
  });
});
