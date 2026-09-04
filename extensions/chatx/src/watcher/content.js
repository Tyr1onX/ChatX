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
  let runStarting = false;
  let sawAssistantMutation = false;
  let lastAssistantMutationAt = 0;
  let candidateSent = false;
  let finishTimer = null;
  let confirmTimer = null;
  let ackTimer = null;
  let evaluationQueued = false;
  let pendingMutationRecords = [];

  function parseConversationId(url = location.href) {
    try {
      const parsed = new URL(url);
      const match = parsed.pathname.match(/^\/c\/([^/?#]+)/);
      const conversationId = match?.[1] ?? null;
      return conversationId?.startsWith("WEB:") ? null : conversationId;
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
    runStarting = false;
    sawAssistantMutation = false;
    lastAssistantMutationAt = 0;
    candidateSent = false;
    pendingMutationRecords = [];
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

  async function beginRun(now, activityObserved = false) {
    if (!currentConversationId || runActive || runStarting) return;

    runStarting = true;

    // New local run attempts must never inherit completion evidence from the
    // previous run. If this is actually a refresh/re-attach to an in-flight
    // run, Background returns the persisted lastMutationAt and we restore it.
    sawAssistantMutation = Boolean(activityObserved);
    lastAssistantMutationAt = activityObserved ? now : 0;
    candidateSent = false;
    if (finishTimer) clearTimeout(finishTimer);
    if (confirmTimer) clearTimeout(confirmTimer);
    finishTimer = null;
    confirmTimer = null;

    try {
      const response = await sendMessage({
        type: "RUN_STARTED",
        metadata: {
          ...metadata(),
          lastMutationAt: now,
        },
      });
      if (!response?.runId) return;

      currentRunId = response.runId;
      runActive = true;

      if (!response.started && response.lastMutationAt) {
        sawAssistantMutation = true;
        lastAssistantMutationAt = Math.max(lastAssistantMutationAt, response.lastMutationAt);
      }

      scheduleCompletionCheck();
    } finally {
      runStarting = false;
    }
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
      scheduleAcknowledgeCheck();
    }
  }

  async function evaluateMutations(records) {
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

    if (
      !runActive &&
      !runStarting &&
      (signals.generationActive || signals.generationBusy)
    ) {
      await beginRun(now, assistantMutation);
    }

    if (runActive && assistantMutation) {
      scheduleCompletionCheck();
    } else if (runActive && !signals.generationActive && !signals.generationBusy) {
      scheduleCompletionCheck();
    }

    scheduleAcknowledgeCheck();
  }

  async function flushMutations() {
    try {
      while (pendingMutationRecords.length) {
        const records = pendingMutationRecords;
        pendingMutationRecords = [];
        await evaluateMutations(records);
      }
    } finally {
      evaluationQueued = false;
      if (pendingMutationRecords.length) onMutations([]);
    }
  }

  function onMutations(records) {
    pendingMutationRecords.push(...records);
    if (evaluationQueued) return;
    evaluationQueued = true;
    queueMicrotask(() => void flushMutations());
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
      if (signals.generationActive || signals.generationBusy) void beginRun(Date.now());
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
    if (message?.type === "ACK_CHECK") {


      scheduleAcknowledgeCheck();
    }
  });

  document.addEventListener("visibilitychange", scheduleAcknowledgeCheck, { passive: true });
  window.addEventListener("focus", scheduleAcknowledgeCheck, { passive: true });
  window.addEventListener("popstate", () => void syncConversation());

  void globalThis.ChatXFeatures.get().then((features) => {
    setEnabled(features.watcher);
  });
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes[globalThis.ChatXFeatures.KEY]) return;
    const next = globalThis.ChatXFeatures.normalize(changes[globalThis.ChatXFeatures.KEY].newValue);
    setEnabled(next.watcher);
  });
})();
