import { afterEach, describe, expect, it, vi } from "vitest";

function doneRun({
  conversationId,
  runId,
  completedAt,
  tabId,
}: {
  conversationId: string;
  runId: string;
  completedAt: number;
  tabId: number;
}) {
  return {
    conversationId,
    runId,
    state: "DONE",
    startedAt: completedAt - 10_000,
    lastMutationAt: completedAt - 1_000,
    completedAt,
    acknowledgedAt: null,
    tabId,
    windowId: 1,
    url: `https://chatgpt.com/c/${conversationId}`,
    title: conversationId,
  };
}

function doneWatcherState(count = 2) {
  const now = Date.now();
  const runs = [
    doneRun({
      conversationId: "conversation-1",
      runId: "run-1",
      completedAt: now - 1_000,
      tabId: 9,
    }),
    doneRun({
      conversationId: "conversation-2",
      runId: "run-2",
      completedAt: now - 500,
      tabId: 22,
    }),
  ].slice(0, count);

  return {
    version: 1,
    runs,
    currentByConversation: Object.fromEntries(runs.map((run) => [run.conversationId, run.runId])),
  };
}

type RuntimeListener = (
  message: { type?: string; metadata?: { conversationId?: string } },
  sender: { tab?: { id: number; windowId: number; url: string; title: string; active: boolean } },
  sendResponse: (response: unknown) => void
) => boolean;

async function loadWatcherBackground({ count = 2, ackOnCheck = false } = {}) {
  const initialState = doneWatcherState(count);
  const values = new Map<string, unknown>([
    ["features", { watcher: true, sessionGuard: true, agentBridge: false }],
    ["watcherState", initialState],
  ]);
  const sentMessages: Array<{
    tabId: number;
    message: { type?: string; runId?: string };
  }> = [];
  const activatedListeners: Array<(event: { tabId: number }) => void> = [];
  const runtimeListeners: RuntimeListener[] = [];
  const overlayRunByTab = new Map<number, string>();

  const activeTab = {
    id: 9,
    windowId: 1,
    url: "https://chatgpt.com/c/conversation-1",
    title: "Conversation 1",
    active: true,
  };

  function leaveForeground(tabId: number) {
    overlayRunByTab.delete(tabId);
  }

  function activateForeground(tabId: number) {
    leaveForeground(activeTab.id);
    activeTab.id = tabId;
    activeTab.url = `https://example.com/tab-${tabId}`;
    activeTab.title = `Tab ${tabId}`;
    activatedListeners[0]?.({ tabId });
  }

  async function dispatchRuntimeMessage(
    message: { type?: string; metadata?: { conversationId?: string } },
    sender = { tab: activeTab }
  ) {
    const listener = runtimeListeners[0];
    if (!listener) return undefined;
    return await new Promise((resolve) => {
      const handled = listener(message, sender, resolve);
      if (!handled) resolve(undefined);
    });
  }

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
      onMessage: {
        addListener: vi.fn((listener: RuntimeListener) => {
          runtimeListeners.push(listener);
        }),
      },
    },
    tabs: {
      query: vi.fn(async (query: { active?: boolean; url?: string[] }) => {
        if (query.active) return [activeTab];
        if (query.url) return [activeTab];
        return [];
      }),
      sendMessage: vi.fn(async (tabId: number, message: { type?: string; runId?: string }) => {
        sentMessages.push({ tabId, message });
        if (message.type === "SHOW_COMPLETION_OVERLAY") {
          const occupiedRunId = overlayRunByTab.get(tabId) ?? null;
          if (occupiedRunId && occupiedRunId !== message.runId) {
            return { shown: false, occupiedRunId };
          }
          if (message.runId) overlayRunByTab.set(tabId, message.runId);
          return { shown: true, occupiedRunId: message.runId ?? null };
        }
        if (message.type === "HIDE_COMPLETION_OVERLAY") {
          if (overlayRunByTab.get(tabId) === message.runId) overlayRunByTab.delete(tabId);
          return { hidden: true };
        }
        if (message.type === "ACK_CHECK" && ackOnCheck) {
          await dispatchRuntimeMessage({
            type: "ACK_ELIGIBLE",
            metadata: { conversationId: "conversation-1" },
          });
        }
        return {};
      }),
      onActivated: {
        addListener: vi.fn((listener: (event: { tabId: number }) => void) => {
          activatedListeners.push(listener);
        }),
      },
      get: vi.fn(async (tabId: number) => {
        const state = values.get("watcherState") as ReturnType<typeof doneWatcherState>;
        const run = state.runs.find((candidate) => candidate.tabId === tabId);
        if (!run) throw new Error("missing tab");
        return {
          id: tabId,
          windowId: run.windowId,
          url: run.url,
          title: run.title,
          active: tabId === activeTab.id,
        };
      }),
      create: vi.fn(),
      update: vi.fn(async (tabId: number) => {
        const state = values.get("watcherState") as ReturnType<typeof doneWatcherState>;
        const run = state.runs.find((candidate) => candidate.tabId === tabId);
        return {
          id: tabId,
          windowId: run?.windowId ?? 1,
          url: run?.url ?? activeTab.url,
          title: run?.title ?? activeTab.title,
          active: true,
        };
      }),
    },
    windows: {
      WINDOW_ID_NONE: -1,
      getLastFocused: vi.fn(async () => ({ id: 1, focused: true })),
      onFocusChanged: { addListener: vi.fn() },
      get: vi.fn(async () => ({ id: 1, focused: true })),
      update: vi.fn(async () => ({ id: 1, focused: true })),
    },
  };

  vi.resetModules();
  delete (globalThis as { ChatXFeatures?: unknown }).ChatXFeatures;
  (globalThis as { chrome?: unknown }).chrome = chrome;

  const background = await import("../extensions/chatx/src/watcher/background.js");
  return {
    background,
    values,
    sentMessages,
    activatedListeners,
    activeTab,
    overlayRunByTab,
    activateForeground,
  };
}

afterEach(() => {
  delete (globalThis as { chrome?: unknown }).chrome;
  delete (globalThis as { document?: unknown }).document;
  delete (globalThis as { window?: unknown }).window;
  delete (globalThis as { ChatXFeatures?: unknown }).ChatXFeatures;
  delete (globalThis as { ChatXUiPrefs?: unknown }).ChatXUiPrefs;
  vi.resetModules();
});

describe("ChatX Watcher completion presentation", () => {
  it("removes the page-local overlay when the page leaves foreground without ACK", async () => {
    const documentListeners = new Map<string, () => void>();
    const windowListeners = new Map<string, () => void>();
    const sendMessage = vi.fn(async () => ({}));
    let currentHost: { dataset: { chatxRunId: string }; remove: () => void } | null = {
      dataset: { chatxRunId: "run-1" },
      remove: () => {
        currentHost = null;
      },
    };
    const fakeDocument = {
      visibilityState: "visible",
      getElementById: vi.fn(() => currentHost),
      addEventListener: vi.fn((type: string, listener: () => void) => {
        documentListeners.set(type, listener);
      }),
    };
    const fakeWindow = {
      addEventListener: vi.fn((type: string, listener: () => void) => {
        windowListeners.set(type, listener);
      }),
    };
    const chrome = {
      storage: { onChanged: { addListener: vi.fn() } },
      runtime: { onMessage: { addListener: vi.fn() }, sendMessage },
    };

    vi.resetModules();
    (globalThis as { chrome?: unknown }).chrome = chrome;
    (globalThis as { document?: unknown }).document = fakeDocument;
    (globalThis as { window?: unknown }).window = fakeWindow;
    await import("../extensions/chatx/src/watcher/overlay.js");

    fakeDocument.visibilityState = "hidden";
    documentListeners.get("visibilitychange")?.();
    expect(currentHost).toBeNull();
    expect(sendMessage).not.toHaveBeenCalled();

    currentHost = {
      dataset: { chatxRunId: "run-1" },
      remove: () => {
        currentHost = null;
      },
    };
    windowListeners.get("blur")?.();
    expect(currentHost).toBeNull();
    expect(sendMessage).not.toHaveBeenCalled();

    windowListeners.get("focus")?.();
    expect(sendMessage).toHaveBeenCalledWith({ type: "PRESENT_PENDING_COMPLETION" });
  });

  it("migrates one pending overlay across foreground tabs without leaving stale copies", async () => {
    const { background, values, activeTab, overlayRunByTab, activateForeground } =
      await loadWatcherBackground({ count: 1 });

    expect(await background.tryPresentPendingCompletion()).toMatchObject({
      presented: true,
      runId: "run-1",
      tabId: 9,
    });
    expect(overlayRunByTab.get(9)).toBe("run-1");

    activateForeground(10);
    expect(overlayRunByTab.has(9)).toBe(false);
    await vi.waitFor(() => expect(overlayRunByTab.get(10)).toBe("run-1"));

    activateForeground(11);
    expect(overlayRunByTab.has(10)).toBe(false);
    await vi.waitFor(() => expect(overlayRunByTab.get(11)).toBe("run-1"));

    expect(
      await background.handleOpenCompletion(
        { runId: "run-1" },
        { tab: { ...activeTab } }
      )
    ).toMatchObject({ viewed: true, acknowledged: true, runId: "run-1", remaining: 0 });

    const state = values.get("watcherState") as ReturnType<typeof doneWatcherState>;
    expect(state.runs.find((run) => run.runId === "run-1")?.state).toBe("ACKNOWLEDGED");
    expect(overlayRunByTab.has(9)).toBe(false);
    expect(overlayRunByTab.has(10)).toBe(false);
    expect(overlayRunByTab.has(11)).toBe(false);
    expect(await background.tryPresentPendingCompletion()).toMatchObject({
      presented: false,
      reason: "none",
    });
  });

  it("keeps the first DONE pending until consumption, then presents the next completion", async () => {
    const { background, values, sentMessages, activeTab, overlayRunByTab } =
      await loadWatcherBackground();
    const showRunIds = () =>
      sentMessages
        .filter(({ message }) => message.type === "SHOW_COMPLETION_OVERLAY")
        .map(({ message }) => message.runId);

    expect(await background.tryPresentPendingCompletion()).toMatchObject({
      presented: true,
      runId: "run-1",
      tabId: 9,
    });
    expect(await background.tryPresentPendingCompletion()).toMatchObject({
      presented: true,
      runId: "run-1",
      tabId: 9,
    });
    expect(showRunIds()).toEqual(["run-1", "run-1"]);
    expect(overlayRunByTab.get(9)).toBe("run-1");
    expect(sentMessages.some(({ message }) => message.type === "HIDE_COMPLETION_OVERLAY")).toBe(false);

    const beforeConsume = values.get("watcherState") as ReturnType<typeof doneWatcherState>;
    expect(beforeConsume.runs.map((run) => [run.runId, run.state])).toEqual([
      ["run-1", "DONE"],
      ["run-2", "DONE"],
    ]);

    expect(
      await background.handleOpenCompletion(
        { runId: "run-1" },
        { tab: activeTab }
      )
    ).toMatchObject({ viewed: true, acknowledged: true, runId: "run-1", remaining: 1 });

    const afterFirst = values.get("watcherState") as ReturnType<typeof doneWatcherState>;
    expect(afterFirst.runs.find((run) => run.runId === "run-1")?.state).toBe("ACKNOWLEDGED");
    expect(afterFirst.runs.find((run) => run.runId === "run-2")?.state).toBe("DONE");
    expect(showRunIds().at(-1)).toBe("run-2");
    expect(overlayRunByTab.get(9)).toBe("run-2");

    expect(
      await background.handleOpenCompletion(
        { runId: "run-2" },
        { tab: activeTab }
      )
    ).toMatchObject({ viewed: true, acknowledged: true, runId: "run-2", remaining: 0 });

    const showCountAfterConsume = showRunIds().length;
    expect(await background.tryPresentPendingCompletion()).toMatchObject({
      presented: false,
      reason: "none",
    });
    expect(showRunIds()).toHaveLength(showCountAfterConsume);
    expect(showRunIds()).not.toContain(undefined);
  });

  it("presents before the activation ACK path can consume the completion", async () => {
    const { values, sentMessages, activatedListeners } = await loadWatcherBackground({
      count: 2,
      ackOnCheck: true,
    });

    expect(activatedListeners).toHaveLength(1);
    activatedListeners[0]({ tabId: 9 });

    await vi.waitFor(() => {
      const state = values.get("watcherState") as ReturnType<typeof doneWatcherState>;
      expect(state.runs.find((run) => run.runId === "run-1")?.state).toBe("ACKNOWLEDGED");
    });

    const messageTypes = sentMessages.map(({ message }) => message.type);
    expect(messageTypes.indexOf("SHOW_COMPLETION_OVERLAY")).toBeGreaterThanOrEqual(0);
    expect(messageTypes.indexOf("SHOW_COMPLETION_OVERLAY")).toBeLessThan(
      messageTypes.indexOf("ACK_CHECK")
    );

    const shownRunIds = sentMessages
      .filter(({ message }) => message.type === "SHOW_COMPLETION_OVERLAY")
      .map(({ message }) => message.runId);
    expect(shownRunIds[0]).toBe("run-1");
    expect(shownRunIds).toContain("run-2");

    const state = values.get("watcherState") as ReturnType<typeof doneWatcherState>;
    expect(state.runs.find((run) => run.runId === "run-1")?.state).toBe("ACKNOWLEDGED");
    expect(state.runs.find((run) => run.runId === "run-2")?.state).toBe("DONE");
  });
});
