const $ = (id) => document.getElementById(id);
const Features = globalThis.ChatXFeatures;

let features = { ...Features.DEFAULTS };
let currentState = null;
let bridgeInitialized = false;

async function popupMessage(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...payload });
  if (!response?.ok) throw new Error(response?.error || "ACTION_FAILED");
  return response;
}

async function bridge(type, payload = {}) {
  const response = await popupMessage(type, payload);
  return response.state;
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("NO_ACTIVE_TAB");
  return tab;
}

function showNotice(text) {
  const notice = $("notice");
  notice.textContent = text || "";
  notice.hidden = !text;
}

function friendlyError(error) {
  const code = error instanceof Error ? error.message : String(error);
  const messages = {
    CURRENT_TAB_NOT_CHATGPT: "Open a ChatGPT tab to assign this role.",
    DEVELOPER_AND_AUDITOR_MUST_DIFFER: "Developer and Auditor must use different ChatGPT tabs.",
    STOP_CURRENT_RUN_BEFORE_REASSIGN: "Stop the current run before changing Agent tabs.",
    TASK_REQUIRED: "Task is required.",
    AGENTS_MISSING: "Assign both Developer and Auditor first.",
    START_FROM_NON_AGENT_TAB: "Start from a non-Agent tab.",
    TRIGGER_TAB_NOT_FOREGROUND: "Start from the current foreground non-Agent tab.",
    AGENT_TAB_ACTIVE_AT_START: "Developer and Auditor must both be inactive before Start.",
    RUN_ALREADY_ACTIVE: "A run is already active.",
    AGENT_BRIDGE_DISABLED: "Agent Bridge is off.",
  };
  return messages[code] || code;
}

function updateStartEnabled() {
  const taskReady = $("task").value.trim().length > 0;
  $("start").disabled = !features.agentBridge
    || !currentState
    || currentState.running
    || !currentState.developerAssigned
    || !currentState.auditorAssigned
    || !taskReady;
}

function renderBridge(state, hydrateInputs = false) {
  currentState = state;
  $("developerState").textContent = state.developerAssigned ? "assigned" : "missing";
  $("auditorState").textContent = state.auditorAssigned ? "assigned" : "missing";
  $("status").textContent = state.status;
  $("generation").textContent = String(state.generation);
  $("round").textContent = String(state.round);

  const failed = state.status === "FAILED" && state.error;
  $("errorRow").hidden = !failed;
  $("error").textContent = failed ? state.error : "";

  if (hydrateInputs) {
    $("task").value = state.task || "";
    $("maxRounds").value = String(state.maxRounds || 6);
    $("maxGenerations").value = String(state.maxGenerations || 3);
  }

  const running = state.running === true;
  $("assignDeveloper").disabled = running;
  $("assignAuditor").disabled = running;
  $("stop").disabled = !running;
  updateStartEnabled();
}

function renderFeatures() {
  $("watcherToggle").checked = features.watcher;
  $("sessionGuardToggle").checked = features.sessionGuard;
  $("agentBridgeToggle").checked = features.agentBridge;
  $("agentBridgeControls").hidden = !features.agentBridge;
  if (!features.agentBridge) showNotice("");
}

async function refreshBridge({ hydrate = false } = {}) {
  if (!features.agentBridge) return;
  try {
    const state = await bridge("BRIDGE_UI_STATE");
    renderBridge(state, hydrate || !bridgeInitialized);
    bridgeInitialized = true;
  } catch (error) {
    showNotice(friendlyError(error));
  }
}

async function refreshFeatures() {
  const response = await popupMessage("CHATX_GET_FEATURES");
  features = Features.normalize(response.features);
  renderFeatures();
}

async function setFeature(name, enabled, input) {
  input.disabled = true;
  try {
    const response = await popupMessage("CHATX_SET_FEATURE", { feature: name, enabled });
    features = Features.normalize(response.features);
    renderFeatures();
    if (name === "agentBridge" && features.agentBridge) {
      bridgeInitialized = false;
      await refreshBridge({ hydrate: true });
    }
  } catch (error) {
    input.checked = !enabled;
    showNotice(friendlyError(error));
  } finally {
    input.disabled = false;
  }
}

$("watcherToggle").addEventListener("change", (event) => {
  void setFeature("watcher", event.currentTarget.checked, event.currentTarget);
});

$("sessionGuardToggle").addEventListener("change", (event) => {
  void setFeature("sessionGuard", event.currentTarget.checked, event.currentTarget);
});

$("agentBridgeToggle").addEventListener("change", (event) => {
  void setFeature("agentBridge", event.currentTarget.checked, event.currentTarget);
});

$("assignDeveloper").addEventListener("click", async () => {
  try {
    showNotice("");
    const tab = await activeTab();
    renderBridge(await bridge("BRIDGE_ASSIGN", { role: "developer", tabId: tab.id }));
  } catch (error) {
    showNotice(friendlyError(error));
  }
});

$("assignAuditor").addEventListener("click", async () => {
  try {
    showNotice("");
    const tab = await activeTab();
    renderBridge(await bridge("BRIDGE_ASSIGN", { role: "auditor", tabId: tab.id }));
  } catch (error) {
    showNotice(friendlyError(error));
  }
});

$("start").addEventListener("click", async () => {
  try {
    showNotice("");
    const tab = await activeTab();
    renderBridge(await bridge("BRIDGE_START", {
      task: $("task").value.trim(),
      maxRounds: Number.parseInt($("maxRounds").value, 10),
      maxGenerations: Number.parseInt($("maxGenerations").value, 10),
      triggerTabId: tab.id,
    }));
  } catch (error) {
    showNotice(friendlyError(error));
  }
});

$("stop").addEventListener("click", async () => {
  try {
    showNotice("");
    renderBridge(await bridge("BRIDGE_STOP"));
  } catch (error) {
    showNotice(friendlyError(error));
  }
});

$("task").addEventListener("input", updateStartEnabled);
$("maxRounds").addEventListener("input", updateStartEnabled);
$("maxGenerations").addEventListener("input", updateStartEnabled);

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (changes[Features.KEY]) {
    features = Features.normalize(changes[Features.KEY].newValue);
    renderFeatures();
  }
  if (features.agentBridge && (changes.runtimeProof || changes[Features.KEY])) {
    void refreshBridge();
  }
});

void (async () => {
  try {
    await refreshFeatures();
    await refreshBridge({ hydrate: true });
  } catch (error) {
    showNotice(friendlyError(error));
  }
})();
