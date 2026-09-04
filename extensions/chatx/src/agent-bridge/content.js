const Protocol = globalThis.ChatGptBridgeProtocol;
const Features = globalThis.ChatXFeatures;
const ASSISTANT_SELECTOR = '[data-message-author-role="assistant"]';
const COMPOSER_SELECTORS = [
  "#prompt-textarea",
  '[data-testid="composer-text-input"]',
  'form textarea[name="prompt-textarea"]',
  'form div[contenteditable="true"][role="textbox"]',
];
const SEND_SELECTORS = [
  'button[data-testid="send-button"]',
  'button[data-testid="composer-submit-button"]',
];
const STOP_SELECTOR = 'button[data-testid="stop-button"]';
const TURN_TIMEOUT_MS = 120_000;
const QUIET_SETTLE_MS = 1000;
const seenRequestIds = new Set();

async function assertFeatureEnabled() {
  if (!(await Features.get()).agentBridge) throw new Error("AGENT_BRIDGE_DISABLED");
}

function isShown(node) {
  if (!node || node.hidden || node.getAttribute?.("aria-hidden") === "true") return false;
  return !node.closest?.('[hidden], [aria-hidden="true"]');
}

function isUsable(node) {
  if (!isShown(node)) return false;
  if (node.disabled || node.getAttribute?.("aria-disabled") === "true") return false;
  if (node.getAttribute?.("contenteditable") === "false") return false;
  return true;
}

function queryFirstUsable(selectors, root = document) {
  for (const selector of selectors) {
    for (const node of root.querySelectorAll(selector)) {
      if (isUsable(node)) return node;
    }
  }
  return null;
}

function getAssistantMessages() {
  return Array.from(document.querySelectorAll(ASSISTANT_SELECTOR)).filter(isShown);
}

function isGenerating(latestAssistant) {
  if (queryFirstUsable([STOP_SELECTOR])) return true;
  if (!latestAssistant) return false;
  return Boolean(
    latestAssistant.querySelector(
      '[data-testid*="thinking" i][aria-busy="true"], [data-testid*="tool" i][aria-busy="true"], [data-state="running"], [data-status="running"], [aria-busy="true"]',
    ),
  );
}

function setComposerText(composer, text) {
  if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) {
    const prototype = composer instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (!setter) throw new Error("COMPOSER_VALUE_SETTER_MISSING");
    setter.call(composer, text);
    composer.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    return;
  }

  if (composer.getAttribute("contenteditable") === "true") {
    composer.focus({ preventScroll: true });
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(composer);
    selection.removeAllRanges();
    selection.addRange(range);
    const inserted = document.execCommand("insertText", false, text);
    selection.removeAllRanges();
    if (!inserted) throw new Error("COMPOSER_INSERT_FAILED");
    composer.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    return;
  }

  throw new Error("UNSUPPORTED_COMPOSER");
}

function waitForSendButton() {
  return new Promise((resolve, reject) => {
    let observer;
    let timeout;
    let queued = false;

    const cleanup = () => {
      observer?.disconnect();
      clearTimeout(timeout);
    };

    const check = () => {
      queued = false;
      const button = queryFirstUsable(SEND_SELECTORS);
      if (!button) return;
      cleanup();
      resolve(button);
    };

    const queueCheck = () => {
      if (queued) return;
      queued = true;
      queueMicrotask(check);
    };

    observer = new MutationObserver(queueCheck);
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["disabled", "aria-disabled", "data-testid"],
    });
    timeout = setTimeout(() => {
      cleanup();
      reject(new Error("SEND_BUTTON_TIMEOUT"));
    }, 10_000);
    check();
  });
}

function waitForNewAssistant(baselineCount, completionMarker, signal) {
  return new Promise((resolve, reject) => {
    let observer;
    let timeout;
    let settleTimer;
    let settleCandidate = null;
    let queued = false;

    const cleanup = () => {
      observer?.disconnect();
      clearTimeout(timeout);
      clearTimeout(settleTimer);
      signal?.removeEventListener("abort", onAbort);
    };

    const finishIfStable = (candidateText) => {
      settleCandidate = candidateText;
      settleTimer = setTimeout(() => {
        settleTimer = null;
        settleCandidate = null;
        const assistants = getAssistantMessages();
        if (assistants.length <= baselineCount) return;
        const latest = assistants.at(-1);
        const text = latest?.innerText?.trim() ?? "";
        const generating = isGenerating(latest);
        if (text !== candidateText || !Protocol.isCompletionCandidate(text, completionMarker, generating)) return;
        cleanup();
        resolve({
          text,
          finalAssistantCount: assistants.length,
          quietSettleMs: QUIET_SETTLE_MS,
          generationInactive: true,
        });
      }, QUIET_SETTLE_MS);
    };

    const check = () => {
      queued = false;
      const assistants = getAssistantMessages();
      if (assistants.length <= baselineCount) return;
      const latest = assistants.at(-1);
      const text = latest?.innerText?.trim() ?? "";
      const generating = isGenerating(latest);
      if (!Protocol.isCompletionCandidate(text, completionMarker, generating)) {
        clearTimeout(settleTimer);
        settleTimer = null;
        settleCandidate = null;
        return;
      }
      if (settleTimer && settleCandidate === text) return;
      clearTimeout(settleTimer);
      settleTimer = null;
      finishIfStable(text);
    };

    const queueCheck = () => {
      if (queued) return;
      queued = true;
      queueMicrotask(check);
    };

    const onAbort = () => {
      cleanup();
      reject(new Error("TURN_ABORTED"));
    };

    observer = new MutationObserver(queueCheck);
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["aria-busy", "aria-disabled", "disabled", "data-state", "data-status", "data-testid"],
    });
    signal?.addEventListener("abort", onAbort, { once: true });
    timeout = setTimeout(() => {
      cleanup();
      reject(new Error("TURN_TIMEOUT"));
    }, TURN_TIMEOUT_MS);
    check();
  });
}

async function runPrompt(requestId, prompt, completionMarker) {
  await assertFeatureEnabled();
  const composer = queryFirstUsable(COMPOSER_SELECTORS);
  if (!composer) throw new Error("COMPOSER_NOT_READY");

  const baselineAssistantCount = getAssistantMessages().length;
  const abortController = new AbortController();
  const completion = waitForNewAssistant(baselineAssistantCount, completionMarker, abortController.signal);

  try {
    setComposerText(composer, prompt);
    const sendButton = await waitForSendButton();
    await assertFeatureEnabled();
    sendButton.click();
    await chrome.runtime.sendMessage({
      type: "TURN_SENT",
      requestId,
      completionMarker,
      baselineAssistantCount,
    });
    const result = await completion;
    await chrome.runtime.sendMessage({
      type: "TURN_COMPLETE",
      requestId,
      completionMarker,
      baselineAssistantCount,
      ...result,
    });
  } catch (error) {
    abortController.abort();
    await completion.catch(() => {});
    await chrome.runtime.sendMessage({
      type: "TURN_FAILED",
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "RUN_PROMPT"
      || typeof message.requestId !== "string"
      || typeof message.prompt !== "string"
      || typeof message.completionMarker !== "string"
      || !message.completionMarker.trim()) {
    return;
  }

  if (seenRequestIds.has(message.requestId)) {
    sendResponse({
      accepted: true,
      duplicate: true,
      baselineAssistantCount: getAssistantMessages().length,
    });
    return;
  }

  seenRequestIds.add(message.requestId);
  sendResponse({
    accepted: true,
    duplicate: false,
    baselineAssistantCount: getAssistantMessages().length,
  });
  void runPrompt(message.requestId, message.prompt, message.completionMarker);
});

void Features.get()
  .then((features) => features.agentBridge
    ? chrome.runtime.sendMessage({ type: "CONTENT_READY" })
    : undefined)
  .catch(() => {});
