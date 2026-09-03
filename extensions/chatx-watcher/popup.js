const completionMode = new URLSearchParams(location.search).get("completion") === "1";
const statusView = document.querySelector("#status-view");
const completionView = document.querySelector("#completion-view");

const enabled = document.querySelector("#enabled");
const state = document.querySelector("#state");
const watched = document.querySelector("#watched");
const completed = document.querySelector("#completed");

const character = document.querySelector("#character");
const summary = document.querySelector("#completion-summary");
const conversationTitle = document.querySelector("#conversation-title");
const viewConversation = document.querySelector("#view-conversation");
const dismiss = document.querySelector("#dismiss");

async function refreshStatus() {
  try {
    const status = await chrome.runtime.sendMessage({ type: "GET_STATUS" });
    enabled.checked = status?.enabled !== false;
    state.textContent = status?.enabled === false ? "已暂停" : "监听中";
    watched.textContent = `${status?.watchedTabs ?? 0} 个 ChatGPT 对话`;
    completed.textContent = String(status?.completed ?? 0);
  } catch {
    state.textContent = "不可用";
  }
}

async function refreshCompletion() {
  try {
    const data = await chrome.runtime.sendMessage({ type: "GET_COMPLETION_DATA" });
    const count = data?.count ?? 0;
    if (count === 0) {
      window.close();
      return;
    }
    summary.textContent = count === 1 ? "ChatGPT 已完成" : `${count} 个 ChatGPT 对话已完成`;
    conversationTitle.textContent = data?.title || "ChatGPT 对话";
  } catch {
    summary.textContent = "ChatGPT 已完成";
    conversationTitle.textContent = "ChatGPT 对话";
  }
}

function playCharacterAnimation() {
  character.textContent = "[._.]\n /|\\\n / \\";
  setTimeout(() => {
    character.textContent = "[-_-]\n /|\\\n / \\";
  }, 180);
  setTimeout(() => {
    character.textContent = "[^_^] !\n /|\\\n / \\";
  }, 420);
}

if (completionMode) {
  document.body.classList.add("completion-mode");
  statusView.hidden = true;
  completionView.hidden = false;

  dismiss.addEventListener("click", () => window.close());
  viewConversation.addEventListener("click", async () => {
    viewConversation.disabled = true;
    try {
      const result = await chrome.runtime.sendMessage({ type: "VIEW_PENDING_COMPLETION" });
      if (result?.viewed && result?.acknowledged) {
        window.close();
        return;
      }
      await refreshCompletion();
    } finally {
      viewConversation.disabled = false;
    }
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "COMPLETION_UPDATED") void refreshCompletion();
  });

  playCharacterAnimation();
  void refreshCompletion();
} else {
  enabled.addEventListener("change", async () => {
    enabled.disabled = true;
    try {
      await chrome.runtime.sendMessage({ type: "SET_ENABLED", enabled: enabled.checked });
    } finally {
      enabled.disabled = false;
      await refreshStatus();
    }
  });

  void refreshStatus();
}
