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
    read("popup.js"),
  ].join("\n");
}

describe("ChatX Watcher extension constraints", () => {
  it("keeps MV3 permissions minimal and scoped only to ChatGPT", () => {
    const manifest = JSON.parse(read("manifest.json")) as {
      manifest_version: number;
      permissions: string[];
      host_permissions: string[];
      content_scripts: Array<{ matches: string[] }>;
    };

    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions.sort()).toEqual(["storage", "tabs"].sort());
    expect(manifest.permissions).not.toContain("notifications");
    expect(manifest.host_permissions).toEqual(["https://chatgpt.com/*"]);
    expect(manifest.content_scripts).toHaveLength(1);
    expect(manifest.content_scripts[0].matches).toEqual(["https://chatgpt.com/*"]);
    expect(JSON.stringify(manifest)).not.toContain("<all_urls>");
  });

  it("uses only the ChatX popup completion path", () => {
    const background = read("src/background.js");
    const popup = read("popup.js");
    const source = runtimeSource();

    expect(fs.existsSync(path.join(extensionRoot, "src", "notifications.js"))).toBe(false);
    expect(source).not.toContain("chrome.notifications");
    expect(background).toContain('chrome.runtime.getURL("popup.html?completion=1")');
    expect(background).toContain("chrome.windows.create({");
    expect(background).toContain('type: "popup"');
    expect(background).toContain("focused: false");
    expect(background).toContain("handleViewPendingCompletion");
    expect(background).toContain("focusConversation");
    expect(popup).toContain('type: "VIEW_PENDING_COMPLETION"');
  });

  it("keeps popup close separate from acknowledgement", () => {
    const background = read("src/background.js");
    const popup = read("popup.js");

    expect(popup).toContain('dismiss.addEventListener("click", () => window.close())');
    expect(popup).not.toContain("ACK_ELIGIBLE");
    expect(background).not.toContain("chrome.windows.onRemoved");
    expect(background).toContain("await acknowledgeConversation(run.conversationId)");
  });

  it("has no polling loop, background network client, persistent animation, or bundled browser runtime", () => {
    const source = runtimeSource();
    const popup = read("popup.js");

    expect(source).not.toMatch(/\bsetInterval\s*\(/);
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/\bXMLHttpRequest\b/);
    expect(source).not.toMatch(/\bWebSocket\b/);
    expect(source).not.toMatch(/requestAnimationFrame/);
    expect(source).not.toMatch(/playwright|puppeteer|electron/i);
    expect(popup.match(/\bsetTimeout\s*\(/g)?.length ?? 0).toBe(2);
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
