const enabled = document.querySelector("#enabled");
const state = document.querySelector("#state");
const watched = document.querySelector("#watched");
const completed = document.querySelector("#completed");

async function refresh() {
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

enabled.addEventListener("change", async () => {
  enabled.disabled = true;
  try {
    await chrome.runtime.sendMessage({ type: "SET_ENABLED", enabled: enabled.checked });
  } finally {
    enabled.disabled = false;
    await refresh();
  }
});

void refresh();
