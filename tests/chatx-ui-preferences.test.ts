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

function loadUiPrefs(initial?: unknown) {
  const values = new Map<string, unknown>();
  const writes: Record<string, unknown>[] = [];
  if (initial !== undefined) values.set("uiPrefs", initial);
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
  vm.runInNewContext(read("src/ui-prefs.js"), context);
  return {
    prefs: context.ChatXUiPrefs as {
      KEY: string;
      DEFAULTS: { language: string; bubblePosition: null };
      get(): Promise<{ language: string; bubblePosition: { x: number; y: number } | null }>;
      setLanguage(language: string): Promise<unknown>;
      setBubblePosition(position: { x: number; y: number }): Promise<unknown>;
      clampBubblePosition(
        position: { x: number; y: number },
        viewportWidth: number,
        viewportHeight: number,
        bubbleSize?: number
      ): { x: number; y: number };
      t(language: string, key: string): string;
      statusLabel(language: string, status: string): string;
    },
    values,
    writes,
  };
}

describe("ChatX UI preferences", () => {
  it("defaults to Chinese and persists language plus bubble position under uiPrefs", async () => {
    const { prefs, values, writes } = loadUiPrefs();

    expect(prefs.KEY).toBe("uiPrefs");
    expect(JSON.parse(JSON.stringify(await prefs.get()))).toEqual({
      language: "zh-CN",
      bubblePosition: null,
    });

    await prefs.setLanguage("en");
    await prefs.setBubblePosition({ x: 120, y: 80 });

    expect(JSON.parse(JSON.stringify(values.get("uiPrefs")))).toEqual({
      language: "en",
      bubblePosition: { x: 120, y: 80 },
    });
    expect(writes.every((write) => Object.keys(write).length === 1 && "uiPrefs" in write)).toBe(true);
  });

  it("clamps persisted bubble coordinates to the current viewport", () => {
    const { prefs } = loadUiPrefs();

    expect(prefs.clampBubblePosition({ x: 999, y: -20 }, 500, 400)).toEqual({ x: 456, y: 0 });
    expect(prefs.clampBubblePosition({ x: 120, y: 80 }, 100, 30)).toEqual({ x: 56, y: 0 });
  });

  it("maps UI copy and Agent Bridge states without changing raw state values", () => {
    const { prefs } = loadUiPrefs();

    expect(prefs.t("zh-CN", "watcher")).toBe("任务监听");
    expect(prefs.t("en", "watcher")).toBe("Watcher");
    expect(prefs.statusLabel("zh-CN", "DEVELOPING")).toBe("开发中");
    expect(prefs.statusLabel("en", "AUDITING")).toBe("Auditing");
    expect(prefs.statusLabel("zh-CN", "COMPLETED")).toBe("已完成");
    expect(prefs.statusLabel("zh-CN", "FAILED")).toBe("失败");
    expect(prefs.statusLabel("zh-CN", "STOPPED_USER")).toBe("已停止");
    expect(prefs.statusLabel("zh-CN", "UNKNOWN_STATE")).toBe("UNKNOWN_STATE");
  });

  it("shares language preferences across popup and floating UI while keeping drag event-driven", () => {
    const manifest = JSON.parse(read("manifest.json")) as {
      content_scripts: Array<{ js: string[] }>;
    };
    const html = read("popup.html");
    const popup = read("popup.js");
    const floating = read("src/floating-ui.js");

    expect(html).toContain('data-language="zh-CN"');
    expect(html).toContain('data-language="en"');
    expect(html).toContain('src="src/ui-prefs.js"');
    expect(popup).toContain("Prefs.setLanguage(button.dataset.language)");
    expect(popup).toContain("changes[Prefs.KEY]");
    expect(floating).toContain("Prefs.setLanguage(button.dataset.language)");
    expect(floating).toContain("changes[Prefs.KEY]");
    expect(manifest.content_scripts[2].js.indexOf("src/ui-prefs.js")).toBeLessThan(
      manifest.content_scripts[2].js.indexOf("src/ui-api.js")
    );

    expect(floating).toContain('launcher.addEventListener("pointerdown"');
    expect(floating).toContain('launcher.addEventListener("pointermove"');
    expect(floating).toContain('launcher.addEventListener("pointerup"');
    expect(floating).toContain("Math.hypot(dx, dy) < DRAG_THRESHOLD");
    expect(floating).toContain("const moved = dragState?.moved === true");
    expect(floating).toContain("if (!moved) setPanelOpen(panel.hidden)");
    expect(floating).toContain("void Prefs.setBubblePosition(bubblePosition)");
    expect(floating).toContain('window.addEventListener("resize"');
    expect(floating).toContain("Prefs.clampBubblePosition(position, window.innerWidth, window.innerHeight, BUBBLE_SIZE)");
    expect(floating).toContain("function positionPanel()");
    expect(floating).not.toMatch(/\bsetInterval\s*\(/);
  });
});
