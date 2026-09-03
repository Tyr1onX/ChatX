(() => {
  const api = globalThis.ChatXWatcherSelectors;
  if (!api) return;

  const STABLE_MS = 3000;
  const CONFIRM_MS = 1500;
  const ACK_DEBOUNCE_MS = 180;

  let enabled = true;
  let root = null;
  let rootObserver = null;
  let rootParentObserver = null;
  let bootstrapObserver = null;
  let currentConversationId = null;
  let currentRunId = null;
  let runActive = false;
  let sawAssistantMutation = false;
  let lastAssistantMutationAt = 0;
  let candidateSent = false;
  let finishTimer = null;
  let confirmTimer = null;
  let ackTimer = null;
  let evaluationQueued = false;

  function parseConversationId(url = location.href) {
    try {
      const parsed = new URL(url);
      const match = parsed.pathname.match(/^\/c\/([^/?#]+)/);
      return match?.[1] ?? null;
    } catch {
      return null;
    }
  }

  function metadata() {
    return {
      conversationId: currentConversationId,
      url: location.href,
      title: document.title.replace(/\s*[-–—]\s*ChatGPT\s*$/i, "").trim() || "ChatGPT 对话",
    };
  }

  function clearTimers() {
    if (finishTimer) clearTimeout(finishTimer);
    if (confirmTimer) clearTimeout(confirmTimer);
    if (ackTimer) clearTimeout(ackTimer);
    finishTimer = null;
    confirmTimer = null;
    ackTimer = null;
  }

  function resetLocalRun() {
    currentRunId = null;
    runActive = false;
    sawAssistantMutation = false;
    lastAssistantMutationAt = 0;
    candidateSent = false;
    if (finishTimer) clearTimeout(finishTimer);
    if (confirmTimer) clearTimeout(confirmTimer);
    finishTimer = null;
    confirmTimer = null;
  }

  function readSignals() {
    return {
      generationActive: api.isGenerationActive(root),
      generationBusy: api.isGenerationBusy(root),
      composerIdle: api.isComposerIdle(),
    };
  }

  function intersectsNode(node, target) {
    if (!node || !target) return false;
    if (node === target) return true;
    if (node.nodeType === Node.ELEMENT_NODE) {
      return node.contains?.(target) || target.contains?.(node);
    }
    return target.contains?.(node.parentNode);
  }

  function mutationTouchesAssistant(records, assistant) {
    if (!assistant) return false;
    return records.some((record) => {
      if (intersectsNode(record.target, assistant)) return true;
      for (const node of record.addedNodes) {
        if (intersectsNode(node, assistant)) return true;
      }
      for (const node of record.removedNodes) {
        if (intersectsNode(node, assistant)) return true;
      }
      return false;
    });
  }

  async function sendMessage(message) {
    try {
      return await chrome.runtime.sendMessage(message);
    } catch {
      return null;
    }
  }

  async function syncConversation() {
    const next = parseConversationId();
    if (next === currentConversationId) return;
    currentConversationId = next;
    resetLocalRun();
    if (next) {
      await sendMessage({ type: "REGISTER_CONVERSATION", metadata: metadata() });
    }
  }

  async function beginRun(now) {
    if (!currentConversationId || runActive) return;

    // If the extension attaches in the middle of an already-running response,
    // treat the existing assistant surface as activity from this run. We still
    // require the full stable + confirmation windows before completion.
    if (!sawAssistantMutation && api.getLastAssistantMessage(root)) {
      sawAssistantMutation = true;
      lastAssistantMutationAt = now;
    }

    const response = await sendMessage({
      type: "RUN_STARTED",
      metadata: {
        ...metadata(),
        lastMutationAt: lastAssistantMutationAt || now,
      },
    });
    if (!response?.runId) return;
    currentRunId = response.runId;
    runActive = true;
    scheduleCompletionCheck();
  }

  async function cancelCandidate(now) {
    if (!candidateSent || !currentRunId) return;
    candidateSent = false;
    if (confirmTimer) clearTimeout(confirmTimer);
    confirmTimer = null;
    await sendMessage({
      type: "RUN_ACTIVITY",
      runId: currentRunId,
      metadata: {
        ...metadata(),
        lastMutationAt: lastAssistantMutationAt || now,
      },
    });
  }

  function completionSignals(now) {
    return {
      ...readSignals(),
      sawAssistantMutation,
      stableForMs: lastAssistantMutationAt ? now - lastAssistantMutationAt : 0,
    };
  }

  function scheduleCompletionCheck() {
    if (!enabled || !runActive || !currentRunId || !sawAssistantMutation) return;
    if (finishTimer) clearTimeout(finishTimer);
    const elapsed = Date.now() - lastAssistantMutationAt;
    const delay = Math.max(0, STABLE_MS - elapsed);
    finishTimer = setTimeout(() => void evaluateFinishCandidate(), delay);
  }

  async function evaluateFinishCandidate() {
    finishTimer = null;
    if (!enabled || !runActive || !currentRunId || candidateSent) return;

    const now = Date.now();
    const signals = completionSignals(now);
    if (
      signals.stableForMs < STABLE_MS ||
      signals.generationActive ||
      signals.generationBusy ||
      !signals.composerIdle ||
      !signals.sawAssistantMutation
    ) {
      return;
    }

    const response = await sendMessage({
      type: "FINISH_CANDIDATE",
      runId: currentRunId,
      metadata: {
        ...metadata(),
        lastMutationAt: lastAssistantMutationAt,
        signals,
      },
    });

    if (!response?.accepted) return;
    candidateSent = true;
    confirmTimer = setTimeout(() => void confirmFinish(), CONFIRM_MS);
  }

  async function confirmFinish() {
    confirmTimer = null;
    if (!enabled || !runActive || !currentRunId || !candidateSent) return;

    const now = Date.now();
    const signals = completionSignals(now);
    if (
      signals.generationActive ||
      signals.generationBusy ||
      !signals.composerIdle ||
      !signals.sawAssistantMutation ||
      signals.stableForMs < STABLE_MS + CONFIRM_MS
    ) {
      await cancelCandidate(now);
      scheduleCompletionCheck();
      return;
    }

    const response = await sendMessage({
      type: "FINISH_CONFIRMED",
      runId: currentRunId,
      metadata: {
        ...metadata(),
        lastMutationAt: lastAssistantMutationAt,
        signals,
      },
    });

    if (response?.completed) {
      runActive = false;
      candidateSent = false;
      currentRunId = response.runId ?? currentRunId;
    }
  }

  async function evaluateMutations(records) {
    evaluationQueued = false;
    if (!enabled) return;

    await syncConversation();
    if (!currentConversationId) return;

    const now = Date.now();
    const assistant = api.getLastAssistantMessage(root);
    const assistantMutation = mutationTouchesAssistant(records, assistant);
    const signals = readSignals();

    if (assistantMutation) {
      sawAssistantMutation = true;
      lastAssistantMutationAt = now;
      if (candidateSent) await cancelCandidate(now);
    }

    if (!runActive && signals.generationActive) {
      await beginRun(now);
    }

    if (runActive && assistantMutation) {
      scheduleCompletionCheck();
    } else if (runActive && !signals.generationActive) {
      scheduleCompletionCheck();
    }

    scheduleAcknowledgeCheck();
  }

  function onMutations(records) {
    if (evaluationQueued) return;
    evaluationQueued = true;
    queueMicrotask(() => void evaluateMutations(records));
  }

  function attachRootObserver() {
    if (!enabled || rootObserver) return;
    root = api.getConversationRoot();
    if (!root) {
      attachBootstrapObserver();
      return;
    }
    rootObserver = new MutationObserver(onMutations);
    rootObserver.observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["aria-busy", "aria-disabled", "disabled", "data-state", "data-status"],
    });

    const parent = root.parentNode;
    if (parent) {
      rootParentObserver = new MutationObserver(() => {
        if (root?.isConnected) return;
        rootObserver?.disconnect();
        rootObserver = null;
        rootParentObserver?.disconnect();
        rootParentObserver = null;
        root = null;
        attachRootObserver();
      });
      rootParentObserver.observe(parent, { childList: true });
    }

    void syncConversation().then(() => {
      const signals = readSignals();
      if (signals.generationActive) void beginRun(Date.now());
      scheduleAcknowledgeCheck();
    });
  }

  function attachBootstrapObserver() {
    if (!enabled || bootstrapObserver || !document.documentElement) return;
    bootstrapObserver = new MutationObserver(() => {
      const candidate = api.getConversationRoot();
      if (!candidate) return;
      bootstrapObserver?.disconnect();
      bootstrapObserver = null;
      attachRootObserver();
    });
    bootstrapObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  function detachObservers() {
    rootObserver?.disconnect();
    rootParentObserver?.disconnect();
    bootstrapObserver?.disconnect();
    rootObserver = null;
    rootParentObserver = null;
    bootstrapObserver = null;
    root = null;
    clearTimers();
    resetLocalRun();
  }

  async function acknowledgeIfVisible() {
    ackTimer = null;
    if (!enabled || !currentConversationId) return;
    if (document.visibilityState !== "visible" || !document.hasFocus()) return;
    await sendMessage({
      type: "ACK_ELIGIBLE",
      metadata: metadata(),
    });
  }

  function scheduleAcknowledgeCheck() {
    if (!enabled || !currentConversationId) return;
    if (ackTimer) clearTimeout(ackTimer);
    ackTimer = setTimeout(() => void acknowledgeIfVisible(), ACK_DEBOUNCE_MS);
  }

  function setEnabled(next) {
    enabled = Boolean(next);
    if (enabled) {
      attachRootObserver();
    } else {
      detachObservers();
    }
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "CONFIG_CHANGED") {
      setEnabled(message.enabled);
    } else if (message?.type === "ACK_CHECK") {
      scheduleAcknowledgeCheck();
    }
  });

  document.addEventListener("visibilitychange", scheduleAcknowledgeCheck, { passive: true });
  window.addEventListener("focus", scheduleAcknowledgeCheck, { passive: true });
  window.addEventListener("popstate", () => void syncConversation());

  chrome.storage.local.get({ settings: { enabled: true } }, ({ settings }) => {
    setEnabled(settings?.enabled !== false);
  });
})();
