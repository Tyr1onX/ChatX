const $ = (id) => document.getElementById(id);
const Features = globalThis.ChatXFeatures;
const Prefs = globalThis.ChatXUiPrefs;
const Ui = globalThis.ChatXUiApi;

let features = { ...Features.DEFAULTS };
let uiPrefs = { ...Prefs.DEFAULTS };
let currentState = null;
let bridgeInitialized = false;
let noticeError = null;

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("NO_ACTIVE_TAB");
  return tab;
}

function clearNotice() {
  noticeError = null;
  const notice = $("notice");
  notice.textContent = "";
  notice.hidden = true;
}

function showError(error) {
  noticeError = error;
  const notice = $("notice");
  notice.textContent = Ui.friendlyError(error, uiPrefs.language);
  notice.hidden = false;
}

function renderLanguage() {
  document.documentElement.lang = uiPrefs.language;
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = Prefs.t(uiPrefs.language, element.dataset.i18n);
  });
  document.querySelectorAll("[data-language]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.language === uiPrefs.language));
  });
  if (currentState) renderBridge(currentState);
  if (noticeError) showError(noticeError);
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
  $("developerState").textContent = Prefs.t(uiPrefs.language, state.developerAssigned ? "assigned" : "missing");
  $("auditorState").textContent = Prefs.t(uiPrefs.language, state.auditorAssigned ? "assigned" : "missing");
  const visual = Prefs.statusVisual(state.status);
  $("statusGlyph").textContent = Prefs.statusCharacter(state.status);
  $("statusGlyph").dataset.visual = visual.kind;
  $("status").textContent = Prefs.statusLabel(uiPrefs.language, state.status);
  $("statusCursor").hidden = !visual.cursor;
  $("runtimeMeta").textContent = Prefs.runtimeMeta(uiPrefs.language, state.generation, state.round);

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
  if (!features.agentBridge) clearNotice();
}

async function refreshBridge({ hydrate = false } = {}) {
  if (!features.agentBridge) return;
  try {
    const state = await Ui.getBridgeState();
    renderBridge(state, hydrate || !bridgeInitialized);
    bridgeInitialized = true;
  } catch (error) {
    showError(error);
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
    showError(error);
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

document.querySelectorAll("[data-language]").forEach((button) => {
  button.addEventListener("click", async () => {
    uiPrefs = await Prefs.setLanguage(button.dataset.language);
    renderLanguage();
  });
});

$("assignDeveloper").addEventListener("click", async () => {
  try {
    clearNotice();
    const tab = await activeTab();
    renderBridge(await Ui.assign("developer", tab.id));
  } catch (error) {
    showError(error);
  }
});

$("assignAuditor").addEventListener("click", async () => {
  try {
    clearNotice();
    const tab = await activeTab();
    renderBridge(await Ui.assign("auditor", tab.id));
  } catch (error) {
    showError(error);
  }
});

$("start").addEventListener("click", async () => {
  try {
    clearNotice();
    const tab = await activeTab();
    renderBridge(await Ui.start({
      task: $("task").value.trim(),
      maxRounds: Number.parseInt($("maxRounds").value, 10),
      maxGenerations: Number.parseInt($("maxGenerations").value, 10),
      triggerTabId: tab.id,
    }));
  } catch (error) {
    showError(error);
  }
});

$("stop").addEventListener("click", async () => {
  try {
    clearNotice();
    renderBridge(await Ui.stop());
  } catch (error) {
    showError(error);
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
  if (changes[Prefs.KEY]) {
    uiPrefs = Prefs.normalize(changes[Prefs.KEY].newValue);
    renderLanguage();
  }
  if (features.agentBridge && (changes.runtimeProof || changes[Features.KEY])) {
    void refreshBridge();
  }
});

void (async () => {
  try {
    uiPrefs = await Prefs.get();
    renderLanguage();
    await refreshFeatures();
    await refreshBridge({ hydrate: true });
  } catch (error) {
    showError(error);
  }
})();
