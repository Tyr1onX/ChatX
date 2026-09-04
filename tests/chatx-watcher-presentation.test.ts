import { afterEach, describe, expect, it, vi } from "vitest";

function doneWatcherState() {
  const now = Date.now();
  return {
    version: 1,
    runs: [
      {
        conversationId: "conversation-1",
        runId: "run-1",
        state: "DONE",
        startedAt: now - 10_000,
        lastMutationAt: now - 1_000,
        completedAt: now - 500,
        acknowledgedAt: null,
        presentedAt: null,
        tabId: 21,
        windowId: 1,
        url: "https://chatgpt.com/c/conversation-1",
        title: "Conversation 1",
      },
    ],
    currentByConversation: { "conversation-1": "run-1" },
  };
}

async function loadWatcherBackground(overlayResults: boolean[]) {
  const values = new Map<string, unknown>([
    ["features", { watcher: true, sessionGuard: true, agentBridge: false }],
    ["watcherState", doneWatcherState()],
  ]);
  const sentMessages: Array<{ tabId: number; message: { type?: string } }> = [];
  const activatedListeners: Array<(event: { tabId: number }) => void> = [];

  const chrome = {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: values.get(key) })),
        set: vi.fn(async (patch: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(patch)) values.set(key, value);
        }),
      },
      onChanged: { addListener: vi.fn() },
    },
    runtime: {
      onMessage: { addListener: vi.fn() },
    },
    tabs: {
      query: vi.fn(async (query: { active?: boolean }) =>
        query.active
          ? [{ id: 9, windowId: 1, url: "https://example.com/", active: true }]
          : []
      ),
      sendMessage: vi.fn(async (tabId: number, message: { type?: string }) => {
        sentMessages.push({ tabId, message });
        if (message.type === "SHOW_COMPLETION_OVERLAY") {
          return { shown: overlayResults.shift() === true };
        }
        return {};
      }),
      onActivated: {
        addListener: vi.fn((listener: (event: { tabId: number }) => void) => {
          activatedListeners.push(listener);
        }),
      },
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    windows: {
      WINDOW_ID_NONE: -1,
      getLastFocused: vi.fn(async () => ({ id: 1, focused: true })),
      onFocusChanged: { addListener: vi.fn() },
      get: vi.fn(),
      update: vi.fn(),
    },
  };

  vi.resetModules();
  delete (globalThis as { ChatXFeatures?: unknown }).ChatXFeatures;
  (globalThis as { chrome?: unknown }).chrome = chrome;

  const background = await import("../extensions/chatx/src/watcher/background.js");
  return { background, values, sentMessages, activatedListeners };
}

afterEach(() => {
  delete (globalThis as { chrome?: unknown }).chrome;
  delete (globalThis as { ChatXFeatures?: unknown }).ChatXFeatures;
  vi.resetModules();
});

describe("ChatX Watcher completion presentation", () => {
  it("marks only after a successful overlay and never presents the same run again", async () => {
    const { background, values, sentMessages, activatedListeners } = await loadWatcherBackground([
      false,
      true,
    ]);
    const showCount = () =>
      sentMessages.filter(({ message }) => message.type === "SHOW_COMPLETION_OVERLAY").length;

    expect(await background.tryPresentPendingCompletion()).toMatchObject({
      presented: false,
      reason: "overlay_unavailable",
      runId: "run-1",
    });
    expect((values.get("watcherState") as ReturnType<typeof doneWatcherState>).runs[0].presentedAt).toBeNull();
    expect(showCount()).toBe(1);

    expect(await background.tryPresentPendingCompletion()).toMatchObject({
      presented: true,
      runId: "run-1",
      tabId: 9,
    });
    expect((values.get("watcherState") as ReturnType<typeof doneWatcherState>).runs[0].presentedAt).not.toBeNull();
    expect(showCount()).toBe(2);

    expect(await background.tryPresentPendingCompletion()).toMatchObject({
      presented: false,
      reason: "none",
    });
    expect(showCount()).toBe(2);

    expect(activatedListeners).toHaveLength(1);
    activatedListeners[0]({ tabId: 9 });
    await vi.waitFor(() => {
      expect(sentMessages.some(({ message }) => message.type === "ACK_CHECK")).toBe(true);
    });
    expect(showCount()).toBe(2);
  });
});
