const $ = (id) => document.getElementById(id);
const Features = globalThis.ChatXFeatures;
const Ui = globalThis.ChatXUiApi;

let features = { ...Features.DEFAULTS };
let currentState = null;
let bridgeInitialized = false;

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
    const state = await Ui.getBridgeState();
    renderBridge(state, hydrate || !bridgeInitialized);
    bridgeInitialized = true;
  } catch (error) {
    showNotice(Ui.friendlyError(error));
  }
}

async function refreshFeatures() {
  features = await Ui.getFeatures();
  renderFeatures();
}

async function setFeature(name, enabled, input) {
  input.disabled = true;
  try {
    features = await Ui.setFeature(name, enabled);
    renderFeatures();
    if (name === "agentBridge" && features.agentBridge) {
      bridgeInitialized = false;
      await refreshBridge({ hydrate: true });
    }
  } catch (error) {
    input.checked = !enabled;
    showNotice(Ui.friendlyError(error));
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
    renderBridge(await Ui.assign("developer", tab.id));
  } catch (error) {
    showNotice(Ui.friendlyError(error));
  }
});

$("assignAuditor").addEventListener("click", async () => {
  try {
    showNotice("");
    const tab = await activeTab();
    renderBridge(await Ui.assign("auditor", tab.id));
  } catch (error) {
    showNotice(Ui.friendlyError(error));
  }
});

$("start").addEventListener("click", async () => {
  try {
    showNotice("");
    const tab = await activeTab();
    renderBridge(await Ui.start({
      task: $("task").value.trim(),
      maxRounds: Number.parseInt($("maxRounds").value, 10),
      maxGenerations: Number.parseInt($("maxGenerations").value, 10),
      triggerTabId: tab.id,
    }));
  } catch (error) {
    showNotice(Ui.friendlyError(error));
  }
});

$("stop").addEventListener("click", async () => {
  try {
    showNotice("");
    renderBridge(await Ui.stop());
  } catch (error) {
    showNotice(Ui.friendlyError(error));
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
    showNotice(Ui.friendlyError(error));
  }
})();
