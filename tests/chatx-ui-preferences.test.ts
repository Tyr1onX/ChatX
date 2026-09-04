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
      statusVisual(status: string): { tail: string; kind: string; cursor: boolean };
      statusCharacter(status: string): string;
      resolveLauncherVisual(input?: {
        agentBridgeEnabled?: boolean;
        bridgeState?: { status: string; running: boolean } | null;
        watcherRunning?: number;
      }): { tail: string; kind: string; cursor: boolean };
      runtimeMeta(language: string, generation: number, round: number): string;
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

    expect(prefs.statusCharacter("IDLE")).toBe("X_");
    expect(prefs.statusCharacter("DEVELOPING")).toBe("X...");
    expect(prefs.statusCharacter("AUDITING")).toBe("X...");
    expect(prefs.statusCharacter("ROLLOVER")).toBe("X...");
    expect(prefs.statusCharacter("COMPLETED")).toBe("X!");
    expect(prefs.statusCharacter("FAILED")).toBe("X×");
    expect(prefs.statusCharacter("STOPPED_USER")).toBe("X||");
    expect(prefs.statusCharacter("STOPPED_MAX_GENERATIONS")).toBe("X||");
    expect(prefs.statusVisual("IDLE")).toMatchObject({ tail: "_", kind: "idle" });
    expect(prefs.statusVisual("DEVELOPING")).toMatchObject({ tail: "_", kind: "working" });
    expect(prefs.statusVisual("AUDITING")).toMatchObject({ tail: "_", kind: "working" });
    expect(prefs.statusVisual("ROLLOVER")).toMatchObject({ tail: "_", kind: "working" });
    expect(prefs.statusVisual("COMPLETED")).toMatchObject({ tail: "!", kind: "completed" });
    expect(prefs.statusVisual("FAILED")).toMatchObject({ tail: "×", kind: "failed" });
    expect(prefs.statusVisual("STOPPED_USER")).toMatchObject({ tail: "||", kind: "stopped" });
    expect(prefs.statusVisual("STOPPED_MAX_GENERATIONS")).toMatchObject({ tail: "||", kind: "stopped" });
    expect(prefs.runtimeMeta("zh-CN", 2, 3)).toBe("第 2 代 / 第 3 轮");
    expect(prefs.runtimeMeta("en", 2, 3)).toBe("G2 / R3");
  });

  it("resolves launcher visuals without changing Bridge/Watcher priority", () => {
    const { prefs } = loadUiPrefs();
    const visual = (input: Parameters<typeof prefs.resolveLauncherVisual>[0]) => prefs.resolveLauncherVisual(input);

    expect(visual({
      agentBridgeEnabled: false,
      bridgeState: null,
      watcherRunning: 0,
    })).toMatchObject({ tail: "_", kind: "idle" });

    expect(visual({
      agentBridgeEnabled: false,
      bridgeState: null,
      watcherRunning: 1,
    })).toMatchObject({ tail: "_", kind: "working" });

    for (const status of ["DEVELOPING", "AUDITING", "ROLLOVER"]) {
      expect(visual({
        agentBridgeEnabled: true,
        bridgeState: { status, running: true },
        watcherRunning: 3,
      })).toMatchObject({ tail: "_", kind: "working" });
    }

    expect(visual({
      agentBridgeEnabled: true,
      bridgeState: { status: "COMPLETED", running: false },
      watcherRunning: 1,
    })).toMatchObject({ tail: "_", kind: "working" });

    expect(visual({
      agentBridgeEnabled: true,
      bridgeState: { status: "COMPLETED", running: false },
      watcherRunning: 0,
    })).toMatchObject({ tail: "!", kind: "completed" });
    expect(visual({
      agentBridgeEnabled: true,
      bridgeState: { status: "FAILED", running: false },
      watcherRunning: 0,
    })).toMatchObject({ tail: "×", kind: "failed" });
    expect(visual({
      agentBridgeEnabled: true,
      bridgeState: { status: "STOPPED_USER", running: false },
      watcherRunning: 0,
    })).toMatchObject({ tail: "||", kind: "stopped" });
  });

  it("keeps terminal status mapping presentation-only", () => {
    const { prefs, writes } = loadUiPrefs();
    const rawStatuses = ["IDLE", "DEVELOPING", "AUDITING", "COMPLETED", "FAILED", "STOPPED_USER"];

    const characters = rawStatuses.map((status) => prefs.statusCharacter(status));

    expect(characters).toEqual(["X_", "X...", "X...", "X!", "X×", "X||"]);
    expect(rawStatuses).toEqual(["IDLE", "DEVELOPING", "AUDITING", "COMPLETED", "FAILED", "STOPPED_USER"]);
    expect(writes).toHaveLength(0);
  });

  it("shares language preferences across popup and floating UI while keeping drag event-driven", () => {
    const manifest = JSON.parse(read("manifest.json")) as {
      content_scripts: Array<{ js: string[] }>;
    };
    const html = read("popup.html");
    const popup = read("popup.js");
    const floating = read("src/floating-ui.js");
    const overlay = read("src/watcher/overlay.js");

    expect(html).toContain('data-language="zh-CN"');
    expect(html).toContain('data-language="en"');
    expect(html).toContain('src="src/ui-prefs.js"');
    expect(popup).toContain("Prefs.setLanguage(button.dataset.language)");
    expect(popup).toContain("changes[Prefs.KEY]");
    expect(floating).toContain("Prefs.setLanguage(button.dataset.language)");
    expect(floating).toContain("changes[Prefs.KEY]");
    expect(floating).toContain("Ui.getWatcherStatus()");
    expect(floating).toContain("changes.watcherState");
    expect(manifest.content_scripts[2].js.indexOf("src/ui-prefs.js")).toBeLessThan(
      manifest.content_scripts[2].js.indexOf("src/ui-api.js")
    );

    expect(manifest.content_scripts[3].js.indexOf("src/ui-prefs.js")).toBeLessThan(
      manifest.content_scripts[3].js.indexOf("src/watcher/overlay.js")
    );
    expect(overlay).toContain("globalThis.ChatXUiPrefs.get()");
    expect(overlay).toContain("changes[globalThis.ChatXUiPrefs.KEY]");
    expect(overlay).toContain('Prefs.t(language, "watcherDone")');

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
    expect(floating).toContain('const DRAG_THRESHOLD = 4');
    expect(floating).toContain('@media (prefers-reduced-motion: reduce)');
    expect(floating).toContain('animation: chatx-cursor-blink 1.6s step-end infinite');
    expect(floating).toContain('.launcher[data-visual="working"]::before');
    expect(floating).toContain('background: conic-gradient(');
    expect(floating).toContain('color-mix(in srgb, CanvasText 58%, transparent) 305deg 355deg');
    expect(floating).toContain('animation: chatx-terminal-scan 1.8s linear infinite');
    expect(floating).toContain('@keyframes chatx-terminal-scan');
    expect(floating).toContain('to { transform: rotate(1turn); }');
    expect(floating).toContain('.launcher[data-visual="working"]::before { animation: none !important; }');
    expect(floating).not.toContain('chatx-working-dots');
    expect(floating).not.toContain('width: 2ch');
    expect(floating).not.toContain('width: 3ch');
    expect(floating).not.toMatch(/\bsetInterval\s*\(/);
    expect(floating).not.toMatch(/requestAnimationFrame/);
  });
});
