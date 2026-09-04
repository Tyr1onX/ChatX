(() => {
  const HOST_ID = "chatx-floating-controls";
  if (document.getElementById(HOST_ID)) return;

  const Features = globalThis.ChatXFeatures;
  const Ui = globalThis.ChatXUiApi;
  let features = { ...Features.DEFAULTS };
  let currentState = null;
  let bridgeInitialized = false;

  const host = document.createElement("div");
  host.id = HOST_ID;
  host.style.cssText = "all:initial;position:fixed;right:20px;bottom:20px;z-index:2147483646;display:block;pointer-events:auto;";
  const shadow = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = `
    :host {
      color-scheme: light dark;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    button, input, textarea { font: inherit; }
    .launcher {
      width: 44px;
      height: 44px;
      padding: 0;
      border: 1px solid color-mix(in srgb, CanvasText 14%, transparent);
      border-radius: 50%;
      background: Canvas;
      color: CanvasText;
      box-shadow: 0 8px 24px rgb(0 0 0 / 0.2);
      cursor: pointer;
      display: grid;
      place-items: center;
    }
    .launcher:hover { background: color-mix(in srgb, CanvasText 5%, Canvas); }
    .launcher img { width: 30px; height: 30px; display: block; }
    .panel {
      position: absolute;
      right: 0;
      bottom: 54px;
      width: min(316px, calc(100vw - 32px));
      max-height: min(620px, calc(100vh - 90px));
      overflow: auto;
      padding: 12px;
      border: 1px solid color-mix(in srgb, CanvasText 14%, transparent);
      border-radius: 12px;
      background: Canvas;
      color: CanvasText;
      box-shadow: 0 12px 34px rgb(0 0 0 / 0.22);
    }
    .panel[hidden] { display: none; }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 5px;
    }
    .brand { font-size: 15px; font-weight: 700; }
    .close {
      width: 28px;
      height: 28px;
      padding: 0;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: inherit;
      cursor: pointer;
      font-size: 18px;
      line-height: 1;
    }
    .close:hover { background: color-mix(in srgb, CanvasText 8%, transparent); }
    .feature-row {
      min-height: 38px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      border-top: 1px solid color-mix(in srgb, CanvasText 11%, transparent);
      font-size: 13px;
      font-weight: 600;
    }
    .feature-row input { width: 18px; height: 18px; margin: 0; }
    .bridge {
      padding-top: 10px;
      border-top: 1px solid color-mix(in srgb, CanvasText 11%, transparent);
    }
    .bridge[hidden] { display: none; }
    .agents, .runtime { display: grid; gap: 4px; font-size: 12px; }
    .agents { margin-bottom: 9px; }
    .runtime { margin-top: 9px; }
    .field-label {
      display: block;
      margin-bottom: 4px;
      font-size: 12px;
      font-weight: 600;
    }
    textarea, input[type="number"] {
      width: 100%;
      border: 1px solid color-mix(in srgb, CanvasText 18%, transparent);
      border-radius: 6px;
      background: Canvas;
      color: CanvasText;
    }
    textarea { min-height: 68px; padding: 7px 8px; resize: vertical; }
    input[type="number"] { padding: 6px 7px; }
    .budget-grid, .button-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 7px;
      margin-top: 8px;
    }
    .budget-grid label { display: grid; gap: 4px; font-size: 11px; }
    .button-grid button {
      min-height: 31px;
      border: 1px solid color-mix(in srgb, CanvasText 18%, transparent);
      border-radius: 6px;
      background: Canvas;
      color: CanvasText;
      cursor: pointer;
    }
    button:disabled { cursor: default; opacity: 0.5; }
    .notice { margin: 8px 0 0; font-size: 11px; }
    .notice[hidden] { display: none; }
  `;

  const panel = document.createElement("section");
  panel.className = "panel";
  panel.hidden = true;
  panel.innerHTML = `
    <div class="header">
      <strong class="brand">ChatX</strong>
      <button class="close" type="button" aria-label="Close ChatX">×</button>
    </div>
    <label class="feature-row"><span>Watcher</span><input id="watcherToggle" type="checkbox"></label>
    <label class="feature-row"><span>Session Guard</span><input id="sessionGuardToggle" type="checkbox"></label>
    <label class="feature-row"><span>Agent Bridge</span><input id="agentBridgeToggle" type="checkbox"></label>
    <section id="agentBridgeControls" class="bridge" hidden>
      <div class="agents">
        <div>Developer: <strong id="developerState">missing</strong></div>
        <div>Auditor: <strong id="auditorState">missing</strong></div>
      </div>
      <label class="field-label" for="task">Task</label>
      <textarea id="task" rows="3" required></textarea>
      <div class="budget-grid">
        <label for="maxRounds">Max rounds<input id="maxRounds" type="number" min="1" step="1" value="6"></label>
        <label for="maxGenerations">Max generations<input id="maxGenerations" type="number" min="1" step="1" value="3"></label>
      </div>
      <div class="button-grid">
        <button id="assignDeveloper" type="button">Assign Developer</button>
        <button id="assignAuditor" type="button">Assign Auditor</button>
        <button id="start" type="button">Start</button>
        <button id="stop" type="button">Stop</button>
      </div>
      <div class="runtime" aria-live="polite">
        <div>status <strong id="status">IDLE</strong></div>
        <div>generation <strong id="generation">1</strong></div>
        <div>round <strong id="round">0</strong></div>
        <div id="errorRow" hidden>error <strong id="error"></strong></div>
      </div>
      <p id="notice" class="notice" role="status" aria-live="polite" hidden></p>
    </section>
  `;

  const launcher = document.createElement("button");
  launcher.className = "launcher";
  launcher.type = "button";
  launcher.setAttribute("aria-label", "Open ChatX");
  launcher.setAttribute("aria-expanded", "false");
  const icon = document.createElement("img");
  icon.src = chrome.runtime.getURL("icons/icon32.png");
  icon.alt = "";
  icon.setAttribute("aria-hidden", "true");
  launcher.append(icon);

  shadow.append(style, panel, launcher);
  document.documentElement.append(host);

  const $ = (id) => shadow.getElementById(id);

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
      renderBridge(await Ui.getBridgeState(), hydrate || !bridgeInitialized);
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

  launcher.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    launcher.setAttribute("aria-expanded", String(!panel.hidden));
    if (!panel.hidden) void refreshBridge();
  });
  shadow.querySelector(".close").addEventListener("click", () => {
    panel.hidden = true;
    launcher.setAttribute("aria-expanded", "false");
  });

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
      renderBridge(await Ui.assign("developer"));
    } catch (error) {
      showNotice(Ui.friendlyError(error));
    }
  });
  $("assignAuditor").addEventListener("click", async () => {
    try {
      showNotice("");
      renderBridge(await Ui.assign("auditor"));
    } catch (error) {
      showNotice(Ui.friendlyError(error));
    }
  });
  $("start").addEventListener("click", async () => {
    try {
      showNotice("");
      renderBridge(await Ui.start({
        task: $("task").value.trim(),
        maxRounds: Number.parseInt($("maxRounds").value, 10),
        maxGenerations: Number.parseInt($("maxGenerations").value, 10),
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
})();
