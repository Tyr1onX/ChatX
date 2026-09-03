const HOST_ID = "chatx-completion-overlay";

function removeOverlay(runId = null) {
  const host = document.getElementById(HOST_ID);
  if (!host) return false;
  if (runId && host.dataset.chatxRunId !== runId) return false;
  host.remove();
  return true;
}

function playCharacterAnimation(character) {
  character.textContent = "[._.]";
  setTimeout(() => {
    character.textContent = "[-_-]";
  }, 180);
  setTimeout(() => {
    character.textContent = "[^_^] !";
  }, 420);
}

function showOverlay({ runId, title }) {
  if (!runId) return false;

  removeOverlay();

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
      width: min(320px, calc(100vw - 32px));
      padding: 12px 13px 13px;
      border: 1px solid color-mix(in srgb, CanvasText 14%, transparent);
      border-radius: 12px;
      background: Canvas;
      color: CanvasText;
      box-shadow: 0 12px 34px rgb(0 0 0 / 0.22);
    }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      min-height: 24px;
    }
    .brand {
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.01em;
    }
    button {
      border: 0;
      color: inherit;
      font: inherit;
      cursor: pointer;
    }
    .close {
      width: 26px;
      height: 24px;
      border-radius: 6px;
      background: transparent;
      font-size: 18px;
      line-height: 1;
      opacity: 0.58;
    }
    .close:hover { background: color-mix(in srgb, CanvasText 8%, transparent); opacity: 0.9; }
    .body {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      gap: 11px;
      align-items: center;
      margin-top: 8px;
    }
    .character {
      min-width: 58px;
      font: 13px/1 Consolas, "Cascadia Mono", monospace;
      white-space: nowrap;
      opacity: 0.88;
    }
    .summary {
      font-size: 13px;
      font-weight: 650;
    }
    .title {
      margin-top: 4px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 12px;
      opacity: 0.68;
    }
    .actions {
      display: flex;
     justify-content: flex-end;
      margin-top: 11px;
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

  const header = document.createElement("div");
  header.className = "header";

  const brand = document.createElement("strong");
  brand.className = "brand";
  brand.textContent = "ChatX";

  const close = document.createElement("button");
  close.className = "close";
  close.type = "button";
  close.setAttribute("aria-label", "关闭");
  close.textContent = "×";
  close.addEventListener("click", () => removeOverlay(runId));

  const body = document.createElement("div");
  body.className = "body";

  const character = document.createElement("div");
  character.className = "character";
  character.setAttribute("aria-hidden", "true");
  character.textContent = "[._.]";

  const copy = document.createElement("div");

  const summary = document.createElement("div");
  summary.className = "summary";
  summary.textContent = "ChatGPT 已完成";

  const conversationTitle = document.createElement("div");
  conversationTitle.className = "title";
  conversationTitle.textContent = title?.trim() || "ChatGPT 对话";

  const actions = document.createElement("div");
  actions.className = "actions";

  const view = document.createElement("button");
  view.className = "view";
  view.type = "button";
  view.textContent = "查看 →";
  view.addEventListener("click", async () => {
    view.disabled = true;
    try {
      const result = await chrome.runtime.sendMessage({ type: "OPEN_COMPLETION", runId });
      if (!result?.acknowledged) view.disabled = false;
    } catch {
      view.disabled = false;
    }
  });

  header.append(brand, close);
  copy.append(summary, conversationTitle);
  body.append(character, copy);
  actions.append(view);
  card.append(header, body, actions);
  shadow.append(style, card);
  document.documentElement.append(host);

  playCharacterAnimation(character);
  return true;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "SHOW_COMPLETION_OVERLAY") {
    const shown = showOverlay({ runId: message.runId, title: message.title });
    sendResponse({ shown, runId: message.runId ?? null });
    return false;
  }

  if (message?.type === "HIDE_COMPLETION_OVERLAY") {
    const hidden = removeOverlay(message.runId ?? null);
    sendResponse({ hidden });
    return false;
  }

  return false;
});
