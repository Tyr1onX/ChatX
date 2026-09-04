(() => {
  const HOST_ID = "chatx-floating-controls";
  if (document.getElementById(HOST_ID)) return;

  const Features = globalThis.ChatXFeatures;
  const Prefs = globalThis.ChatXUiPrefs;
  const Ui = globalThis.ChatXUiApi;
  const BUBBLE_SIZE = 44;
  const DEFAULT_OFFSET = 20;
  const PANEL_GAP = 10;
  const VIEWPORT_MARGIN = 8;
  const DRAG_THRESHOLD = 4;

  let features = { ...Features.DEFAULTS };
  let uiPrefs = { ...Prefs.DEFAULTS };
  let currentState = null;
  let bridgeInitialized = false;
  let bubblePosition = null;
  let dragState = null;
  let noticeError = null;

  const host = document.createElement("div");
  host.id = HOST_ID;
  host.style.cssText = `all:initial;position:fixed;right:${DEFAULT_OFFSET}px;bottom:${DEFAULT_OFFSET}px;width:${BUBBLE_SIZE}px;height:${BUBBLE_SIZE}px;z-index:2147483646;display:block;pointer-events:auto;`;
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
      cursor: grab;
      display: grid;
      place-items: center;
      touch-action: none;
      user-select: none;
    }
    .launcher:hover { background: color-mix(in srgb, CanvasText 5%, Canvas); }
    .launcher.dragging { cursor: grabbing; }
    .launcher-mark {
      min-width: 26px;
      font: 750 16px/1 "Cascadia Mono", Consolas, monospace;
      letter-spacing: -0.06em;
      white-space: nowrap;
    }
    .launcher-tail {
      display: inline-block;
      min-width: 1ch;
      text-align: left;
    }
    .launcher[data-visual="idle"] .launcher-tail {
      animation: chatx-cursor-blink 1.6s step-end infinite;
    }
    .launcher[data-visual="working"] .launcher-tail {
      width: 1ch;
      overflow: hidden;
      vertical-align: bottom;
      animation: chatx-working-dots 2.4s step-end infinite;
    }
    @keyframes chatx-cursor-blink {
      0%, 54% { opacity: 1; }
      55%, 100% { opacity: 0.22; }
    }
    @keyframes chatx-working-dots {
      0%, 32% { width: 1ch; }
      33%, 65% { width: 2ch; }
      66%, 100% { width: 3ch; }
    }
    @media (prefers-reduced-motion: reduce) {
      .launcher-tail { animation: none !important; }
      .launcher[data-visual="working"] .launcher-tail { width: 3ch; }
    }
    .panel {
      position: absolute;
      width: min(316px, calc(100vw - 32px));
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
    .brand-mark, .section-kicker, .terminal-label, .terminal-glyph, .status-cursor, .runtime-meta {
      font-family: "Cascadia Mono", Consolas, monospace;
    }
    .brand-mark { font-weight: 750; }
    .section-kicker {
      margin: 2px 0 6px;
      font-size: 11px;
      font-weight: 700;
      opacity: 0.68;
    }
    .header-actions, .language-switch {
      display: flex;
      align-items: center;
    }
    .header-actions { gap: 6px; }
    .language-switch { gap: 3px; font-size: 11px; }
    .language-switch button {
      min-height: 0;
      padding: 2px 3px;
      border: 0;
      background: transparent;
      color: inherit;
      cursor: pointer;
      opacity: 0.55;
    }
    .language-switch button[aria-pressed="true"] { opacity: 1; font-weight: 700; }
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
    .runtime {
      margin-top: 9px;
      padding: 9px 10px;
      border-radius: 8px;
      background: color-mix(in srgb, CanvasText 4%, transparent);
    }
    .terminal-label {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.08em;
      opacity: 0.56;
    }
    .runtime-status { display: flex; align-items: baseline; gap: 8px; }
    .terminal-glyph { min-width: 30px; font-size: 13px; font-weight: 750; }
    #status { text-transform: uppercase; letter-spacing: 0.03em; }
    .status-cursor { margin-left: -8px; }
    .runtime-meta { font-size: 11px; opacity: 0.64; }
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
      <strong class="brand"><span class="brand-mark">X_</span> ChatX</strong>
      <div class="header-actions">
        <div class="language-switch" aria-label="Language">
          <button type="button" data-language="zh-CN" aria-pressed="true">中文</button>
          <span>/</span>
          <button type="button" data-language="en" aria-pressed="false">EN</button>
        </div>
        <button class="close" type="button" aria-label="关闭 ChatX">×</button>
      </div>
    </div>
    <div class="section-kicker">&gt; <span data-i18n="featuresHeading">功能</span></div>
    <label class="feature-row"><span data-i18n="watcher">任务监听</span><input id="watcherToggle" type="checkbox"></label>
    <label class="feature-row"><span data-i18n="sessionGuard">会话保护</span><input id="sessionGuardToggle" type="checkbox"></label>
    <label class="feature-row"><span data-i18n="agentBridge">Agent Bridge / 智能协作</span><input id="agentBridgeToggle" type="checkbox"></label>
    <section id="agentBridgeControls" class="bridge" hidden>
      <div class="agents">
        <div><span data-i18n="developer">开发者</span>: <strong id="developerState">未指定</strong></div>
        <div><span data-i18n="auditor">审计者</span>: <strong id="auditorState">未指定</strong></div>
      </div>
      <label class="field-label" for="task" data-i18n="task">任务</label>
      <textarea id="task" rows="3" required></textarea>
      <div class="budget-grid">
        <label for="maxRounds"><span data-i18n="maxRounds">最大轮数</span><input id="maxRounds" type="number" min="1" step="1" value="6"></label>
        <label for="maxGenerations"><span data-i18n="maxGenerations">最大代数</span><input id="maxGenerations" type="number" min="1" step="1" value="3"></label>
      </div>
      <div class="button-grid">
        <button id="assignDeveloper" type="button" data-i18n="assignDeveloper">指定开发者</button>
        <button id="assignAuditor" type="button" data-i18n="assignAuditor">指定审计者</button>
        <button id="start" type="button" data-i18n="start">开始</button>
        <button id="stop" type="button" data-i18n="stop">停止</button>
      </div>
      <div class="runtime" aria-live="polite">
        <div class="terminal-label" data-i18n="terminalStatus">STATUS</div>
        <div class="runtime-status"><span id="statusGlyph" class="terminal-glyph">X_</span><strong id="status">空闲</strong><span id="statusCursor" class="status-cursor">_</span></div>
        <div id="runtimeMeta" class="runtime-meta">第 1 代 / 第 0 轮</div>

        <div id="errorRow" hidden><span data-i18n="error">错误</span> <strong id="error"></strong></div>
      </div>
      <p id="notice" class="notice" role="status" aria-live="polite" hidden></p>
    </section>
  `;

  const launcher = document.createElement("button");
  launcher.className = "launcher";
  launcher.type = "button";
  launcher.setAttribute("aria-label", "打开 ChatX");
  launcher.setAttribute("aria-expanded", "false");
  const launcherMark = document.createElement("span");
  launcherMark.className = "launcher-mark";
  const launcherTail = document.createElement("span");
  launcherTail.className = "launcher-tail";
  launcherTail.textContent = "_";
  launcherMark.append("X", launcherTail);

  launcher.append(launcherMark);

  shadow.append(style, panel, launcher);
  document.documentElement.append(host);

  const $ = (id) => shadow.getElementById(id);

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), Math.max(min, max));
  }

  function defaultBubblePosition() {
    return Prefs.clampBubblePosition({
      x: window.innerWidth - BUBBLE_SIZE - DEFAULT_OFFSET,
      y: window.innerHeight - BUBBLE_SIZE - DEFAULT_OFFSET,
    }, window.innerWidth, window.innerHeight, BUBBLE_SIZE);
  }

  function applyBubblePosition(position) {
    bubblePosition = Prefs.clampBubblePosition(position, window.innerWidth, window.innerHeight, BUBBLE_SIZE);
    host.style.left = `${bubblePosition.x}px`;
    host.style.top = `${bubblePosition.y}px`;
    host.style.right = "auto";
    host.style.bottom = "auto";
  }

  function positionPanel() {
    if (panel.hidden || !bubblePosition) return;

    const panelWidth = Math.min(316, Math.max(0, window.innerWidth - 32));
    const opensRight = window.innerWidth - (bubblePosition.x + BUBBLE_SIZE) >= bubblePosition.x;
    const preferredLeft = opensRight
      ? bubblePosition.x
      : bubblePosition.x + BUBBLE_SIZE - panelWidth;
    const panelLeft = clamp(
      preferredLeft,
      VIEWPORT_MARGIN,
      window.innerWidth - panelWidth - VIEWPORT_MARGIN
    );
    panel.style.left = `${panelLeft - bubblePosition.x}px`;
    panel.style.right = "auto";

    const above = Math.max(0, bubblePosition.y - PANEL_GAP - VIEWPORT_MARGIN);
    const below = Math.max(
      0,
      window.innerHeight - (bubblePosition.y + BUBBLE_SIZE + PANEL_GAP) - VIEWPORT_MARGIN
    );
    if (below >= above) {
      panel.style.top = `${BUBBLE_SIZE + PANEL_GAP}px`;
      panel.style.bottom = "auto";
      panel.style.maxHeight = `${below}px`;
    } else {
      panel.style.top = "auto";
      panel.style.bottom = `${BUBBLE_SIZE + PANEL_GAP}px`;
      panel.style.maxHeight = `${above}px`;
    }
  }

  function setPanelOpen(open) {
    panel.hidden = !open;
    launcher.setAttribute("aria-expanded", String(open));
    if (open) {
      positionPanel();
      void refreshBridge();
    }
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
    shadow.querySelectorAll("[data-i18n]").forEach((element) => {
      element.textContent = Prefs.t(uiPrefs.language, element.dataset.i18n);
    });
    shadow.querySelectorAll("[data-language]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.language === uiPrefs.language));
    });
    launcher.setAttribute("aria-label", Prefs.t(uiPrefs.language, "openChatX"));
    shadow.querySelector(".close").setAttribute("aria-label", Prefs.t(uiPrefs.language, "closeChatX"));
    if (currentState) renderBridge(currentState);
    if (noticeError) showError(noticeError);
    positionPanel();
  }

  function renderLauncherVisual() {
    const status = features.agentBridge && currentState ? currentState.status : "IDLE";
    const visual = Prefs.statusVisual(status);
    launcher.dataset.visual = visual.kind;
    launcherTail.textContent = visual.tail;
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
    renderLauncherVisual();
    updateStartEnabled();
  }

  function renderFeatures() {
    $("watcherToggle").checked = features.watcher;
    $("sessionGuardToggle").checked = features.sessionGuard;
    $("agentBridgeToggle").checked = features.agentBridge;
    $("agentBridgeControls").hidden = !features.agentBridge;
    if (!features.agentBridge) clearNotice();
    renderLauncherVisual();
    positionPanel();
  }

  async function refreshBridge({ hydrate = false } = {}) {
    if (!features.agentBridge) return;
    try {
      renderBridge(await Ui.getBridgeState(), hydrate || !bridgeInitialized);
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

  function finishDrag(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    if (dragState.moved && event.type === "pointerup") {
      applyBubblePosition({
        x: dragState.startPosition.x + event.clientX - dragState.startX,
        y: dragState.startPosition.y + event.clientY - dragState.startY,
      });
      void Prefs.setBubblePosition(bubblePosition);
    }
    launcher.classList.remove("dragging");
    if (launcher.hasPointerCapture?.(event.pointerId)) launcher.releasePointerCapture(event.pointerId);
    dragState = null;
  }

  launcher.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const startPosition = bubblePosition || defaultBubblePosition();
    dragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startPosition,
      moved: false,
    };
    launcher.setPointerCapture?.(event.pointerId);
  });

  launcher.addEventListener("pointermove", (event) => {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    const dx = event.clientX - dragState.startX;
    const dy = event.clientY - dragState.startY;
    if (!dragState.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    if (!dragState.moved) {
      dragState.moved = true;
      launcher.classList.add("dragging");
      setPanelOpen(false);
    }
    event.preventDefault();
    applyBubblePosition({
      x: dragState.startPosition.x + dx,
      y: dragState.startPosition.y + dy,
    });
  });

  launcher.addEventListener("pointerup", (event) => {
    const moved = dragState?.moved === true;
    finishDrag(event);
    if (!moved) setPanelOpen(panel.hidden);
  });
  launcher.addEventListener("pointercancel", finishDrag);
  launcher.addEventListener("click", (event) => {
    if (event.detail > 0) {
      event.preventDefault();
      return;
    }
    setPanelOpen(panel.hidden);
  });

  shadow.querySelector(".close").addEventListener("click", () => setPanelOpen(false));
  shadow.querySelectorAll("[data-language]").forEach((button) => {
    button.addEventListener("click", async () => {
      uiPrefs = await Prefs.setLanguage(button.dataset.language);
      renderLanguage();
    });
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
      clearNotice();
      renderBridge(await Ui.assign("developer"));
    } catch (error) {
      showError(error);
    }
  });
  $("assignAuditor").addEventListener("click", async () => {
    try {
      clearNotice();
      renderBridge(await Ui.assign("auditor"));
    } catch (error) {
      showError(error);
    }
  });
  $("start").addEventListener("click", async () => {
    try {
      clearNotice();
      renderBridge(await Ui.start({
        task: $("task").value.trim(),
        maxRounds: Number.parseInt($("maxRounds").value, 10),
        maxGenerations: Number.parseInt($("maxGenerations").value, 10),
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

  window.addEventListener("resize", () => {
    if (uiPrefs.bubblePosition) applyBubblePosition(bubblePosition || uiPrefs.bubblePosition);
    else applyBubblePosition(defaultBubblePosition());
    positionPanel();
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (changes[Features.KEY]) {
      features = Features.normalize(changes[Features.KEY].newValue);
      renderFeatures();
    }
    if (changes[Prefs.KEY]) {
      uiPrefs = Prefs.normalize(changes[Prefs.KEY].newValue);
      if (!dragState) applyBubblePosition(uiPrefs.bubblePosition || defaultBubblePosition());
      renderLanguage();
    }
    if (features.agentBridge && (changes.runtimeProof || changes[Features.KEY])) {
      void refreshBridge();
    }
  });

  void (async () => {
    try {
      uiPrefs = await Prefs.get();
      applyBubblePosition(uiPrefs.bubblePosition || defaultBubblePosition());
      renderLanguage();
      await refreshFeatures();
      await refreshBridge({ hydrate: true });
    } catch (error) {
      showError(error);
    }
  })();
})();
