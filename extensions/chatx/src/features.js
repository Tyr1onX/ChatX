(() => {
  if (globalThis.ChatXFeatures) return;

  const KEY = "features";
  const DEFAULTS = Object.freeze({
    watcher: true,
    sessionGuard: true,
    agentBridge: false,
  });
  const NAMES = new Set(Object.keys(DEFAULTS));
  let writeQueue = Promise.resolve();

  function normalize(value) {
    const source = value && typeof value === "object" ? value : {};
    return {
      watcher: typeof source.watcher === "boolean" ? source.watcher : DEFAULTS.watcher,
      sessionGuard: typeof source.sessionGuard === "boolean" ? source.sessionGuard : DEFAULTS.sessionGuard,
      agentBridge: typeof source.agentBridge === "boolean" ? source.agentBridge : DEFAULTS.agentBridge,
    };
  }

  async function get() {
    const stored = await chrome.storage.local.get(KEY);
    return normalize(stored[KEY]);
  }

  async function ensure() {
    const stored = await chrome.storage.local.get(KEY);
    const current = stored[KEY];
    const next = normalize(current);
    if (!current
        || Object.keys(current).length !== Object.keys(next).length
        || Object.keys(next).some((name) => current[name] !== next[name])) {
      await chrome.storage.local.set({ [KEY]: next });
    }
    return next;
  }

  function set(name, enabled) {
    if (!NAMES.has(name)) return Promise.reject(new Error("UNKNOWN_FEATURE"));
    writeQueue = writeQueue.catch(() => undefined).then(async () => {
      const current = await get();
      const next = { ...current, [name]: Boolean(enabled) };
      await chrome.storage.local.set({ [KEY]: next });
      return next;
    });
    return writeQueue;
  }

  globalThis.ChatXFeatures = Object.freeze({ KEY, DEFAULTS, normalize, get, ensure, set });
})();
