const NOTIFICATION_PREFIX = "chatx-watcher:";

export function notificationIdForRun(runId) {
  return `${NOTIFICATION_PREFIX}${runId}`;
}

export function runIdFromNotificationId(notificationId) {
  return notificationId.startsWith(NOTIFICATION_PREFIX)
    ? notificationId.slice(NOTIFICATION_PREFIX.length)
    : null;
}

export class BrowserNotificationSink {
  async emitCompletion(event) {
    const notificationId = notificationIdForRun(event.runId);
    const title = event.title?.trim() || "ChatGPT 对话";
    await chrome.notifications.create(notificationId, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon128.png"),
      title: "ChatX",
      message: `ChatGPT 已完成\n「${title}」`,
      priority: 1,
    });
    return notificationId;
  }
}
