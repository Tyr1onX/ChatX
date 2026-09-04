import "./features.js";
import "./watcher/background.js";
import "./session-guard/background.js";
import "./agent-bridge/background.js";

const Features = globalThis.ChatXFeatures;

await Features.ensure();

function isPopupSender(sender) {
  return sender.id === chrome.runtime.id
    && !sender.tab
    && typeof sender.url === "string"
    && sender.url.endsWith("/popup.html");
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "CHATX_GET_FEATURES" && message?.type !== "CHATX_SET_FEATURE") return false;
  if (!isPopupSender(sender)) {
    sendResponse({ ok: false, error: "POPUP_ONLY_ACTION" });
    return false;
  }

  void (async () => {
    try {
      if (message.type === "CHATX_GET_FEATURES") {
        sendResponse({ ok: true, features: await Features.get() });
        return;
      }

      const features = await Features.set(message.feature, message.enabled);
      if (message.feature === "agentBridge" && features.agentBridge === false) {
        await globalThis.ChatXAgentBridge?.stopForFeatureDisable?.();
      }
      sendResponse({ ok: true, features });
    } catch (error) {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  })();
  return true;
});
