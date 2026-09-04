(() => {
  if (globalThis.ChatXUiApi) return;

  const Features = globalThis.ChatXFeatures;

  async function message(type, payload = {}) {
    const response = await chrome.runtime.sendMessage({ type, ...payload });
    if (!response?.ok) throw new Error(response?.error || "ACTION_FAILED");
    return response;
  }

  async function getFeatures() {
    const response = await message("CHATX_GET_FEATURES");
    return Features.normalize(response.features);
  }

  async function setFeature(feature, enabled) {
    const response = await message("CHATX_SET_FEATURE", { feature, enabled });
    return Features.normalize(response.features);
  }

  async function getBridgeState() {
    return (await message("BRIDGE_UI_STATE")).state;
  }

  async function assign(role, tabId) {
    const payload = { role };
    if (Number.isInteger(tabId)) payload.tabId = tabId;
    return (await message("BRIDGE_ASSIGN", payload)).state;
  }

  async function start({ task, maxRounds, maxGenerations, triggerTabId }) {
    const payload = { task, maxRounds, maxGenerations };
    if (Number.isInteger(triggerTabId)) payload.triggerTabId = triggerTabId;
    return (await message("BRIDGE_START", payload)).state;
  }

  async function stop() {
    return (await message("BRIDGE_STOP")).state;
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

  globalThis.ChatXUiApi = Object.freeze({
    getFeatures,
    setFeature,
    getBridgeState,
    assign,
    start,
    stop,
    friendlyError,
  });
})();
