const HOST_ID = "chatx-completion-overlay";

function removeOverlay(runId = null) {
  const host = document.getElementById(HOST_ID);
  if (!host) return false;
  if (runId && host.dataset.chatxRunId !== runId) return false;
  host.remove();
  return true;
}

function renderOverlayLanguage(host, language) {
  const shadow = host?.shadowRoot;
  if (!shadow) return;
  const Prefs = globalThis.ChatXUiPrefs;
  shadow.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = Prefs.t(language, element.dataset.i18n);
  });
  shadow.querySelector(".done")?.prepend("> ");
  shadow.querySelector(".close")?.setAttribute("aria-label", Prefs.t(language, "close"));
  const title = shadow.querySelector(".title");
  if (title?.dataset.fallback === "true") {
    title.textContent = Prefs.t(language, "watcherConversationFallback");
  }
}

function showOverlay({ runId, title, language }) {
  if (!runId) return false;

  removeOverlay();

  const Prefs = globalThis.ChatXUiPrefs;
  const host = document.createElement("div");
  host.id = HOST_ID;
  host.dataset.chatxRunId = runId;
  host.style.cssText =
    "all:initial;position:fixed;right:22px;bottom:22px;z-index:2147483647;display:block;pointer-events:auto;";
  const shadow = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = `
    :host {
      color-scheme: light dark;
      font-family: "Segoe UI", "Microsoft YaHei", system-ui, sans-serif;
    }
    * { box-sizing: border-box; }
    .card {
      position: relative;
      width: min(320px, calc(100vw - 32px));
      padding: 12px 13px 13px;
      border: 1px solid color-mix(in srgb, CanvasText 14%, transparent);
      border-radius: 12px;
      background: Canvas;
      color: CanvasText;
      box-shadow: 0 12px 34px rgb(0 0 0 / 0.22);
    }
    .terminal {
      padding-right: 22px;
      font-family: "Cascadia Mono", Consolas, "Microsoft YaHei", monospace;
    }
    .frame-top, .frame-bottom {
      overflow: hidden;
      white-space: nowrap;
      font-size: 12px;
      line-height: 1.35;
      opacity: 0.72;
    }
    .frame-top { font-weight: 700; opacity: 0.9; }
    .terminal-row {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      gap: 7px;
      align-items: baseline;
      margin: 4px 0;
      font-size: 12px;
    }
    .edge { opacity: 0.48; }
    .done {
      font-weight: 800;
      letter-spacing: 0.05em;
    }
    .summary { font-weight: 700; }
    .title {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      opacity: 0.66;
    }
    button {
      border: 0;
      color: inherit;
      font: inherit;
      cursor: pointer;
    }
    .close {
      position: absolute;
      top: 8px;
      right: 8px;
      width: 26px;
      height: 24px;
      border-radius: 6px;
      background: Canvas;
      font-size: 18px;
      line-height: 1;
      opacity: 0.58;
    }
    .close:hover { background: color-mix(in srgb, CanvasText 8%, Canvas); opacity: 0.9; }
    .actions {
      display: flex;
      justify-content: flex-end;
      margin-top: 10px;
    }
    .view {
      min-width: 72px;
      height: 30px;
      padding: 0 11px;
      border: 1px solid color-mix(in srgb, CanvasText 16%, transparent);
      border-radius: 7px;
      background: color-mix(in srgb, CanvasText 7%, transparent);
      font-size: 12px;
      font-weight: 650;
    }
    .view:hover { background: color-mix(in srgb, CanvasText 11%, transparent); }
    .view:disabled { cursor: default; opacity: 0.5; }
  `;

  const card = document.createElement("section");
  card.className = "card";
  card.setAttribute("role", "status");
  card.setAttribute("aria-live", "polite");

  const terminal = document.createElement("div");
  terminal.className = "terminal";

  const top = document.createElement("div");
  top.className = "frame-top";
  top.textContent = "╭─ X_ ChatX ─────────────────╮";

  const statusRow = document.createElement("div");
  statusRow.className = "terminal-row";
  const statusLeft = document.createElement("span");
  statusLeft.className = "edge";
  statusLeft.textContent = "│";
  const status = document.createElement("strong");
  status.className = "done";
  status.dataset.i18n = "watcherDoneStatus";
  status.textContent = Prefs.t(language, "watcherDoneStatus");
  status.prepend("> ");
  const statusRight = document.createElement("span");
  statusRight.className = "edge";
  statusRight.textContent = "│";
  statusRow.append(statusLeft, status, statusRight);

  const summaryRow = document.createElement("div");
  summaryRow.className = "terminal-row";
  const summaryLeft = document.createElement("span");
  summaryLeft.className = "edge";
  summaryLeft.textContent = "│";
  const summary = document.createElement("div");
  summary.className = "summary";
  summary.dataset.i18n = "watcherDone";
  summary.textContent = Prefs.t(language, "watcherDone");
  const summaryRight = document.createElement("span");
  summaryRight.className = "edge";
  summaryRight.textContent = "│";
  summaryRow.append(summaryLeft, summary, summaryRight);

  const titleRow = document.createElement("div");
  titleRow.className = "terminal-row";
  const titleLeft = document.createElement("span");
  titleLeft.className = "edge";
  titleLeft.textContent = "│";
  const conversationTitle = document.createElement("div");
  conversationTitle.className = "title";
  const normalizedTitle = title?.trim();
  conversationTitle.dataset.fallback = String(!normalizedTitle);
  conversationTitle.textContent = normalizedTitle || Prefs.t(language, "watcherConversationFallback");
  const titleRight = document.createElement("span");
  titleRight.className = "edge";
  titleRight.textContent = "│";
  titleRow.append(titleLeft, conversationTitle, titleRight);

  const bottom = document.createElement("div");
  bottom.className = "frame-bottom";
  bottom.textContent = "╰────────────────────────────╯";

  const close = document.createElement("button");
  close.className = "close";
  close.type = "button";
  close.setAttribute("aria-label", Prefs.t(language, "close"));
  close.textContent = "×";
  close.addEventListener("click", () => removeOverlay(runId));

  const actions = document.createElement("div");
  actions.className = "actions";

  const view = document.createElement("button");
  view.className = "view";
  view.type = "button";
  view.dataset.i18n = "view";
  view.textContent = Prefs.t(language, "view");
  view.addEventListener("click", async () => {
    view.disabled = true;
    try {
      const result = await chrome.runtime.sendMessage({ type: "OPEN_COMPLETION", runId });
      if (!result?.acknowledged) view.disabled = false;
    } catch {
      view.disabled = false;
    }
  });

  terminal.append(top, statusRow, summaryRow, titleRow, bottom);
  actions.append(view);
  card.append(terminal, close, actions);
  shadow.append(style, card);
  document.documentElement.append(host);
  return true;
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (changes[globalThis.ChatXFeatures.KEY]) {
    const next = globalThis.ChatXFeatures.normalize(changes[globalThis.ChatXFeatures.KEY].newValue);
    if (!next.watcher) removeOverlay();
  }
  if (changes[globalThis.ChatXUiPrefs.KEY]) {
    const host = document.getElementById(HOST_ID);
    if (host) {
      const next = globalThis.ChatXUiPrefs.normalize(changes[globalThis.ChatXUiPrefs.KEY].newValue);
      renderOverlayLanguage(host, next.language);
    }
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "SHOW_COMPLETION_OVERLAY") {
    void Promise.all([
      globalThis.ChatXFeatures.get(),
      globalThis.ChatXUiPrefs.get(),
    ]).then(([features, uiPrefs]) => {
      const shown = features.watcher
        ? showOverlay({ runId: message.runId, title: message.title, language: uiPrefs.language })
        : false;
      sendResponse({ shown, runId: message.runId ?? null });
    });
    return true;
  }

  if (message?.type === "HIDE_COMPLETION_OVERLAY") {
    const hidden = removeOverlay(message.runId ?? null);
    sendResponse({ hidden });
    return false;
  }

  return false;
});
