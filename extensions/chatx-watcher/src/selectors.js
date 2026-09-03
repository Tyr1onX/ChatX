(() => {
  const selectors = Object.freeze({
    conversationRoot: [
      "main",
      '[role="main"]',
    ],
    assistantMessage: [
      '[data-message-author-role="assistant"]',
    ],
    generationControl: [
      'button[data-testid="stop-button"]',
      'button[data-testid*="stop" i]',
      'button[aria-label*="stop" i]',
      'button[aria-label*="停止"]',
      'button[aria-label*="cancel" i]',
      'button[aria-label*="取消"]',
    ],
    generationBusy: [
      '[data-testid*="thinking" i][aria-busy="true"]',
      '[data-testid*="tool" i][aria-busy="true"]',
      '[data-state="running"]',
      '[data-status="running"]',
      '[aria-busy="true"]',
    ],
    composerInput: [
      "#prompt-textarea",
      '[data-testid="composer-text-input"]',
      'form textarea[name="prompt-textarea"]',
      'form textarea[placeholder]',
      'form div[contenteditable="true"][role="textbox"]',
    ],
  });

  function queryFirst(root, list) {
    for (const selector of list) {
      const node = root.querySelector(selector);
      if (node) return node;
    }
    return null;
  }

  function isHidden(node) {
    if (!node) return true;
    if (node.hidden || node.getAttribute?.("aria-hidden") === "true") return true;
    return Boolean(node.closest?.('[hidden], [aria-hidden="true"]'));
  }

  function queryFirstVisible(root, list) {
    for (const selector of list) {
      for (const node of root.querySelectorAll(selector)) {
        if (!isHidden(node)) return node;
      }
    }
    return null;
  }

  function queryAll(root, list) {
    const result = [];
    for (const selector of list) {
      for (const node of root.querySelectorAll(selector)) {
        if (!result.includes(node)) result.push(node);
      }
    }
    return result;
  }

  function getConversationRoot() {
    return queryFirst(document, selectors.conversationRoot);
  }

  function getLastAssistantMessage(root) {
    const messages = queryAll(root ?? document, selectors.assistantMessage)
      .filter((node) => !isHidden(node));
    return messages.at(-1) ?? null;
  }

  function isGenerationActive() {
    return queryAll(document, selectors.generationControl).some((node) =>
      !isHidden(node) &&
      !node.disabled &&
      node.getAttribute?.("aria-disabled") !== "true"
    );
  }

  function isGenerationBusy(root) {
    const target = root ?? document;
    return queryAll(target, selectors.generationBusy).some((node) => {
      if (isHidden(node)) return false;
      if (node.closest?.('button[data-testid="send-button"]')) return false;
      return node.getAttribute("aria-busy") === "true" ||
        node.getAttribute("data-state") === "running" ||
        node.getAttribute("data-status") === "running";
    });
  }

  function isComposerIdle() {
    const input = queryFirstVisible(document, selectors.composerInput);
    if (!input) return false;
    if (input.disabled) return false;
    if (input.getAttribute("aria-disabled") === "true") return false;
    if (input.getAttribute("contenteditable") === "false") return false;
    return true;
  }

  globalThis.ChatXWatcherSelectors = Object.freeze({
    selectors,
    getConversationRoot,
    getLastAssistantMessage,
    isGenerationActive,
    isGenerationBusy,
    isComposerIdle,
  });
})();
