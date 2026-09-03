import {
  RunState,
  acknowledgeRun,
  cleanupWatcherState,
  confirmDone,
  createEmptyWatcherState,
  getPendingDoneRuns,
  markFinishCandidate,
  normalizeWatcherState,
  recordActivity,
  startRun,
} from "./state.js";

const STATE_KEY = "watcherState";
const SETTINGS_KEY = "settings";
const COMPLETION_POPUP_URL = chrome.runtime.getURL("popup.html?completion=1");
const COMPLETION_POPUP_WIDTH = 340;
const COMPLETION_POPUP_HEIGHT = 168;

let stateCache = null;
let writeQueue = Promise.resolve();
let popupCreatePromise = null;

async function loadState() {
  if (stateCache) return stateCache;
  const stored = await chrome.storage.local.get(STATE_KEY);
  stateCache = normalizeWatcherState(stored[STATE_KEY]);
  cleanupWatcherState(stateCache, Date.now());
  return stateCache;
}

function persistState() {
  writeQueue = writeQueue.then(() =>
    chrome.storage.local.set({ [STATE_KEY]: stateCache ?? createEmptyWatcherState() })
  );
  return writeQueue;
}

function withSenderMetadata(message, sender) {
  return {
    ...(message.metadata ?? {}),
    tabId: sender.tab?.id ?? message.metadata?.tabId ?? null,
    windowId: sender.tab?.windowId ?? message.metadata?.windowId ?? null,
    url: sender.tab?.url ?? message.metadata?.url ?? "",
    title: message.metadata?.title ?? sender.tab?.title ?? "",
  };
}

async function isEnabled() {
  const stored = await chrome.storage.local.get({ [SETTINGS_KEY]: { enabled: true } });
  return stored[SETTINGS_KEY]?.enabled !== false;
}

async function getCompletionPopupWindow() {
  const windows = await chrome.windows.getAll({ populate: true, windowTypes: ["popup"] });
  return (
    windows.find((windowInfo) =>
      windowInfo.tabs?.some((tab) => tab.url === COMPLETION_POPUP_URL)
    ) ?? null
  );
}

async function refreshCompletionPopup() {
  try {
    await chrome.runtime.sendMessage({ type: "COMPLETION_UPDATED" });
  } catch {
    // No completion popup is currently open.
  }
}

async function showCompletionPopup() {
  if (popupCreatePromise) {
    await popupCreatePromise;
    await refreshCompletionPopup();
    return;
  }

  popupCreatePromise = (async () => {
    const existing = await getCompletionPopupWindow();
    if (existing) {
      await refreshCompletionPopup();
      return;
    }

    await chrome.windows.create({
      url: COMPLETION_POPUP_URL,
      type: "popup",
      width: COMPLETION_POPUP_WIDTH,
      height: COMPLETION_POPUP_HEIGHT,
      focused: false,
    });
  })();

  try {
    await popupCreatePromise;
  } finally {
    popupCreatePromise = null;
  }
}

async function handleRunStarted(message, sender) {
  if (!(await isEnabled())) return { ignored: true };
  const metadata = withSenderMetadata(message, sender);
  if (!metadata.conversationId) return { ignored: true };

  const state = await loadState();
  const runId = crypto.randomUUID();
  const result = startRun(state, metadata, Date.now(), runId);
  cleanupWatcherState(state, Date.now());
  await persistState();
  return {
    runId: result.run.runId,
    started: result.started,
    state: result.run.state,
    lastMutationAt: result.run.lastMutationAt ?? null,
  };
}

async function handleRunActivity(message, sender) {
  const state = await loadState();
  const run = recordActivity(
    state,
    message.runId,
    withSenderMetadata(message, sender),
    Date.now()
  );
  if (run) await persistState();
  return { runId: run?.runId ?? null, state: run?.state ?? null };
}

async function handleFinishCandidate(message, sender) {
  const state = await loadState();
  const result = markFinishCandidate(
    state,
    message.runId,
    { ...withSenderMetadata(message, sender), signals: message.metadata?.signals ?? {} },
    Date.now()
  );
  if (result.accepted) await persistState();
  return {
    accepted: result.accepted,
    runId: result.run?.runId ?? null,
    state: result.run?.state ?? null,
  };
}

async function handleFinishConfirmed(message, sender) {
  const state = await loadState();
  const metadata = {
    ...withSenderMetadata(message, sender),
    signals: message.metadata?.signals ?? {},
  };
  const result = confirmDone(state, message.runId, metadata, Date.now());

  if (!result.completed) {
    return {
      completed: false,
      runId: result.run?.runId ?? null,
      state: result.run?.state ?? null,
    };
  }

  cleanupWatcherState(state, Date.now());
  await persistState();

  if (result.shouldPresent) {
    await showCompletionPopup();
  }

  return {
    completed: true,
    runId: result.run?.runId ?? null,
    state: result.run?.state ?? null,
    presented: result.shouldPresent,
  };
}

async function acknowledgeConversation(conversationId) {
  const state = await loadState();
  const result = acknowledgeRun(state, conversationId, Date.now());
  if (result.acknowledged) {
    await persistState();
    await refreshCompletionPopup();
  }
  return result;
}

async function handleAcknowledge(message, sender) {
  const metadata = withSenderMetadata(message, sender);
  if (!metadata.conversationId || !sender.tab?.id || !sender.tab.active) {
    return { acknowledged: false };
  }

  let windowInfo;
  try {
    windowInfo = await chrome.windows.get(sender.tab.windowId);
  } catch {
    return { acknowledged: false };
  }
  if (!windowInfo.focused) return { acknowledged: false };

  const result = await acknowledgeConversation(metadata.conversationId);
  return {
    acknowledged: result.acknowledged,
    runId: result.run?.runId ?? null,
    state: result.run?.state ?? null,
  };
}

async function registerConversation() {
  return { registered: true };
}

async function getStatus() {
  const state = await loadState();
  const tabs = await chrome.tabs.query({ url: ["https://chatgpt.com/*"] });
  const completed = getPendingDoneRuns(state).length;
  const running = state.runs.filter(
    (run) => run.state === RunState.RUNNING || run.state === RunState.FINISH_CANDIDATE
  ).length;
  const stored = await chrome.storage.local.get({ [SETTINGS_KEY]: { enabled: true } });
  return {
    enabled: stored[SETTINGS_KEY]?.enabled !== false,
    watchedTabs: tabs.length,
    completed,
    running,
  };
}

async function getCompletionData() {
  const state = await loadState();
  const pending = getPendingDoneRuns(state);
  const first = pending[0] ?? null;
  return {
    count: pending.length,
    runId: first?.runId ?? null,
    title: first?.title?.trim() || "ChatGPT 对话",
  };
}

async function setEnabled(enabled) {
  const settings = { enabled: Boolean(enabled) };
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  const tabs = await chrome.tabs.query({ url: ["https://chatgpt.com/*"] });
  await Promise.allSettled(
    tabs
      .filter((tab) => tab.id != null)
      .map((tab) => chrome.tabs.sendMessage(tab.id, { type: "CONFIG_CHANGED", enabled: settings.enabled }))
  );
  return settings;
}

async function focusConversation(run) {
  let tab = null;
  if (run.tabId != null) {
    try {
      tab = await chrome.tabs.get(run.tabId);
    } catch {
      tab = null;
    }
  }

  if (!tab && run.url) {
    const matches = await chrome.tabs.query({ url: ["https://chatgpt.com/*"] });
    tab = matches.find((item) => item.url === run.url) ?? null;
  }

  if (!tab && run.url) {
    tab = await chrome.tabs.create({ url: run.url, active: true });
  } else if (tab?.id != null) {
    if (run.url && tab.url !== run.url) {
      tab = await chrome.tabs.update(tab.id, { url: run.url, active: true });
    } else {
      tab = await chrome.tabs.update(tab.id, { active: true });
    }
  }

  if (tab?.windowId != null) {
    await chrome.windows.update(tab.windowId, { focused: true });
  }

  return tab;
}

async function handleViewPendingCompletion() {
  const state = await loadState();
  const run = getPendingDoneRuns(state)[0] ?? null;
  if (!run) return { viewed: false, acknowledged: false, remaining: 0 };

  const tab = await focusConversation(run);
  if (!tab) {
    return { viewed: false, acknowledged: false, remaining: getPendingDoneRuns(state).length };
  }

  const result = await acknowledgeConversation(run.conversationId);
  return {
    viewed: true,
    acknowledged: result.acknowledged,
    runId: run.runId,
    remaining: getPendingDoneRuns(state).length,
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const task = (() => {
    switch (message?.type) {
      case "RUN_STARTED":
        return handleRunStarted(message, sender);
      case "RUN_ACTIVITY":
        return handleRunActivity(message, sender);
      case "FINISH_CANDIDATE":
        return handleFinishCandidate(message, sender);
      case "FINISH_CONFIRMED":
        return handleFinishConfirmed(message, sender);
      case "ACK_ELIGIBLE":
        return handleAcknowledge(message, sender);
      case "REGISTER_CONVERSATION":
        return registerConversation();
      case "GET_STATUS":
        return getStatus();
      case "GET_COMPLETION_DATA":
        return getCompletionData();
      case "VIEW_PENDING_COMPLETION":
        return handleViewPendingCompletion();
      case "SET_ENABLED":
        return setEnabled(message.enabled);
      default:
        return Promise.resolve({ ignored: true });
    }
  })();

  task.then(sendResponse).catch(() => sendResponse({ error: "watcher_error" }));
  return true;
});

async function requestAckCheck(tabId) {
  if (tabId == null) return;
  try {
    await chrome.tabs.sendMessage(tabId, { type: "ACK_CHECK" });
  } catch {
    // Content script may not exist yet or the tab may have closed.
  }
}

chrome.tabs.onActivated.addListener(({ tabId }) => {
  void requestAckCheck(tabId);
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  void chrome.tabs
    .query({ active: true, windowId })
    .then((tabs) => requestAckCheck(tabs[0]?.id))
    .catch(() => undefined);
});

chrome.runtime.onInstalled.addListener(() => {
  void chrome.storage.local.get(SETTINGS_KEY).then((stored) => {
    if (!stored[SETTINGS_KEY]) {
      return chrome.storage.local.set({ [SETTINGS_KEY]: { enabled: true } });
    }
    return undefined;
  });
});