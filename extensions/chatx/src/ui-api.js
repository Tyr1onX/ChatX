(() => {
  if (globalThis.ChatXUiApi) return;

  const Features = globalThis.ChatXFeatures;
  const UiPrefs = globalThis.ChatXUiPrefs;

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

  function friendlyError(error, language = UiPrefs.DEFAULTS.language) {
    return UiPrefs.errorLabel(language, error);
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
