import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionRoot = path.join(repoRoot, "extensions", "chatx-watcher");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(extensionRoot, relativePath), "utf8");
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
    expect(manifest.permissions.sort()).toEqual(["notifications", "storage", "tabs"].sort());
    expect(manifest.host_permissions).toEqual(["https://chatgpt.com/*"]);
    expect(manifest.content_scripts).toHaveLength(1);
    expect(manifest.content_scripts[0].matches).toEqual(["https://chatgpt.com/*"]);
    expect(JSON.stringify(manifest)).not.toContain("<all_urls>");
  });

  it("has no polling loop, background network client, or bundled browser runtime", () => {
    const source = [
      read("src/content.js"),
      read("src/background.js"),
      read("src/state.js"),
      read("src/selectors.js"),
      read("src/notifications.js"),
    ].join("\n");

    expect(source).not.toMatch(/\bsetInterval\s*\(/);
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/\bXMLHttpRequest\b/);
    expect(source).not.toMatch(/\bWebSocket\b/);
    expect(source).not.toMatch(/playwright|puppeteer|electron/i);
  });

  it("uses a bounded number of event-driven DOM observers", () => {
    const content = read("src/content.js");
    const observerCount = content.match(/new MutationObserver\s*\(/g)?.length ?? 0;

    expect(observerCount).toBeGreaterThan(0);
    expect(observerCount).toBeLessThanOrEqual(3);
  });

  it("keeps completion delivery behind the browser notification sink", () => {
    const notifications = read("src/notifications.js");
    const background = read("src/background.js");

    expect(notifications).toContain("class BrowserNotificationSink");
    expect(notifications).toContain("chrome.notifications.create");
    expect(background).toContain("new BrowserNotificationSink()");
  });
});
