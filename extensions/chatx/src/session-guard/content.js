"use strict";
(() => {
  // src/shared/config.ts
  var STORAGE_KEY = "csg.settings.v1";
  var DEFAULT_CONFIG = {
    version: 2,
    enabled: !0,
    mode: "balanced",
    historyUnit: "round",
    historyCount: 8,
    historyBatchSize: 10,
    autoLoadHistory: !1,
    historyExpansion: 0,
    historyExpansionConversationId: null,
    recentRounds: 8,
    minRounds: 1,
    targetRounds: 8,
    maxRounds: 8,
    domBudget: 7e3,
    temporaryFullHistory: !1,
    hardSwitchEnabled: !1,
    debug: !1
  }, MODES = /* @__PURE__ */ new Set(["safe", "balanced", "ultra-lite", "aggressive"]), HISTORY_UNITS = /* @__PURE__ */ new Set(["message", "round"]);
  function clampInteger(value, fallback, min, max) {
    return typeof value == "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
  }
  function normalizeConfig(input) {
    let raw = typeof input == "object" && input !== null ? input : {}, historyUnit = typeof raw.historyUnit == "string" && HISTORY_UNITS.has(raw.historyUnit) ? raw.historyUnit : "round", migratedCount = raw.historyCount ?? raw.recentRounds, historyCount = clampInteger(migratedCount, DEFAULT_CONFIG.historyCount, 1, 50), historyBatchSize = clampInteger(raw.historyBatchSize, DEFAULT_CONFIG.historyBatchSize, 1, 50), mode = typeof raw.mode == "string" && MODES.has(raw.mode) ? raw.mode : DEFAULT_CONFIG.mode;
    return {
      version: 2,
      enabled: typeof raw.enabled == "boolean" ? raw.enabled : DEFAULT_CONFIG.enabled,
      mode,
      historyUnit,
      historyCount,
      historyBatchSize,
      autoLoadHistory: typeof raw.autoLoadHistory == "boolean" ? raw.autoLoadHistory : DEFAULT_CONFIG.autoLoadHistory,
      historyExpansion: clampInteger(raw.historyExpansion, 0, 0, 200),
      historyExpansionConversationId: typeof raw.historyExpansionConversationId == "string" ? raw.historyExpansionConversationId : null,
      recentRounds: historyCount,
      minRounds: 1,
      targetRounds: historyCount,
      maxRounds: historyCount,
      domBudget: clampInteger(raw.domBudget, DEFAULT_CONFIG.domBudget, 2e3, 3e4),
      temporaryFullHistory: typeof raw.temporaryFullHistory == "boolean" ? raw.temporaryFullHistory : DEFAULT_CONFIG.temporaryFullHistory,
      hardSwitchEnabled: typeof raw.hardSwitchEnabled == "boolean" ? raw.hardSwitchEnabled : DEFAULT_CONFIG.hardSwitchEnabled,
      debug: typeof raw.debug == "boolean" ? raw.debug : DEFAULT_CONFIG.debug
    };
  }
  function persistentConfig(config2) {
    return { ...config2, historyExpansion: 0, historyExpansionConversationId: null };
  }
  function historyTarget(config2, conversationId) {
    let expansion = conversationId && config2.historyExpansionConversationId === conversationId ? config2.historyExpansion : 0;
    return Math.min(250, config2.historyCount + expansion);
  }

  // src/shared/events.ts
  var EVENTS = {
    config: "csg:config",
    requestConfig: "csg:request-config",
    navigation: "csg:navigation",
    networkStatus: "csg:network-status",
    debugMetrics: "csg:debug-metrics",
    debugCommand: "csg:debug-command",
    loadPreviousHistory: "csg:load-previous-history",
    temporaryFullHistory: "csg:temporary-full-history",
    stats: "csg:stats-event"
  };
  function dispatchStringEvent(name, value) {
    window.dispatchEvent(new CustomEvent(name, { detail: JSON.stringify(value) }));
  }
  function parseStringEvent(event) {
    if (!(event instanceof CustomEvent) || typeof event.detail != "string") return null;
    try {
      return JSON.parse(event.detail);
    } catch {
      return null;
    }
  }

  // src/shared/types.ts
  var EMPTY_METRICS = {
    conversationId: null,
    spaSwitchCount: 0,
    renderedRounds: 0,
    totalRounds: 0,
    renderedMessages: 0,
    totalMessages: 0,
    configuredHistoryCount: 0,
    historyUnit: "round",
    limitedByDomBudget: !1,
    conversationDomNodes: 0,
    activeConversationDomNodes: 0,
    totalDocumentDomNodes: 0,
    networkMode: "unknown",
    networkModified: !1,
    networkRequestedTurns: null,
    networkEffectiveTurns: null,
    cleanupCount: 0,
    hardSwitchCount: 0,
    switchLatencyMs: null,
    jsHeapMb: null,
    lastUpdatedAt: 0
  };

  // src/content/hard-switch.ts
  function visible(element) {
    let html = element;
    return html.offsetParent !== null || getComputedStyle(html).position === "fixed";
  }
  function hasUnsafeInteractiveState(root = document) {
    if (/\/(?:auth|oauth|authorize)(?:\/|$)/i.test(location.pathname)) return !0;
    let stop = root.querySelector('[data-testid="stop-button"], button[aria-label*="stop" i]');
    if (stop && visible(stop)) return !0;
    for (let dialog of root.querySelectorAll('[role="dialog"], [data-testid*="confirmation" i], [data-testid*="permission" i], [data-testid*="oauth" i], [aria-label*="permission" i]'))
      if (visible(dialog)) return !0;
    for (let input of root.querySelectorAll('input[type="file"]'))
      if (input.files && input.files.length > 0) return !0;
    return !1;
  }
  var HardSwitchGuard = class {
    minDocumentNodes = Number.POSITIVE_INFINITY;
    minHeapMb = Number.POSITIVE_INFINITY;
    lastHardSwitchAt = 0;
    count = 0;
    observe(metrics) {
      metrics.totalDocumentDomNodes > 0 && (this.minDocumentNodes = Math.min(this.minDocumentNodes, metrics.totalDocumentDomNodes)), metrics.jsHeapMb !== null && metrics.jsHeapMb > 0 && (this.minHeapMb = Math.min(this.minHeapMb, metrics.jsHeapMb));
    }
    shouldHardReload(config2, metrics) {
      if (!config2.hardSwitchEnabled || config2.temporaryFullHistory || metrics.spaSwitchCount < 30 || metrics.spaSwitchCount - this.lastHardSwitchAt < 30 || hasUnsafeInteractiveState()) return !1;
      let nodeGrowth = Number.isFinite(this.minDocumentNodes) && metrics.totalDocumentDomNodes > Math.max(this.minDocumentNodes + 8e3, this.minDocumentNodes * 1.8), heapGrowth = metrics.jsHeapMb !== null && Number.isFinite(this.minHeapMb) && metrics.jsHeapMb > Math.max(this.minHeapMb + 300, this.minHeapMb * 1.7);
      return nodeGrowth || heapGrowth;
    }
    markHardReload(switchCount) {
      this.lastHardSwitchAt = switchCount, this.count += 1;
    }
    get countPerformed() {
      return this.count;
    }
  };

  // src/content/navigation-observer.ts
  function extractConversationId(pathname) {
    return pathname.match(/^\/c\/([^/?#]+)/)?.[1] ?? null;
  }
  var NavigationObserver = class {
    constructor(onNavigate, onSameConversationMutation) {
      this.onNavigate = onNavigate;
      this.onSameConversationMutation = onSameConversationMutation;
    }
    lastHref = "";
    lastConversationId;
    abortController = null;
    start() {
      if (this.abortController) return;
      this.abortController = new AbortController();
      let { signal } = this.abortController, check = () => {
        if (location.href === this.lastHref) return;
        this.lastHref = location.href;
        let conversationId = extractConversationId(location.pathname), previous = this.lastConversationId;
        if (this.lastConversationId = conversationId, previous === void 0 || previous !== conversationId) {
          this.onNavigate(conversationId);
          return;
        }
        conversationId && this.onSameConversationMutation?.(conversationId);
      };
      window.addEventListener(EVENTS.navigation, check, { signal }), window.addEventListener("popstate", check, { signal }), window.addEventListener("hashchange", check, { signal }), window.navigation?.addEventListener("navigate", check, { signal }), check();
    }
    destroy() {
      this.abortController?.abort(), this.abortController = null, this.lastHref = "", this.lastConversationId = void 0;
    }
  };

  // src/content/dom-window.ts
  var TURN_SELECTOR = [
    '[data-testid^="conversation-turn-"]',
    '[data-testid="conversation-turn"]',
    "article[data-turn-id]"
  ].join(","), PROTECTED_SELECTOR = [
    '[role="dialog"]',
    '[data-testid="stop-button"]',
    '[data-testid*="confirm" i]',
    '[data-testid*="permission" i]',
    '[data-testid*="oauth" i]',
    'input[type="file"]',
    '[contenteditable="true"]'
  ].join(","), PLACEHOLDER_ID = "csg-history-placeholder", STYLE_ID = "csg-window-styles", OWNED_SELECTOR = `#${PLACEHOLDER_ID}, #${STYLE_ID}, [data-csg-owned="true"]`;
  function countNodes(element) {
    return 1 + element.querySelectorAll("*").length;
  }
  function createNodeCounter() {
    let cache = /* @__PURE__ */ new Map();
    return (element) => {
      let cached = cache.get(element);
      if (cached !== void 0) return cached;
      let value = countNodes(element);
      return cache.set(element, value), value;
    };
  }
  function elementForNode(node) {
    return node ? node instanceof Element ? node : node.parentElement : null;
  }
  function isExtensionOwnedNode(node) {
    return !!elementForNode(node)?.closest(OWNED_SELECTOR);
  }
  function matchesOrContains(element, selector) {
    return element.matches(selector) || element.querySelector(selector) !== null;
  }
  function mutationChangesGenerationControl(records) {
    for (let record of records)
      for (let node of [...record.addedNodes, ...record.removedNodes]) {
        let element = elementForNode(node);
        if (element && matchesOrContains(element, '[data-testid="stop-button"], button[aria-label*="stop" i]'))
          return !0;
      }
    return !1;
  }
  function mutationNeedsConversationEvaluate(records) {
    for (let record of records) {
      let target = elementForNode(record.target), changedNodes = [...record.addedNodes, ...record.removedNodes];
      if (!(isExtensionOwnedNode(record.target) && changedNodes.every((node) => isExtensionOwnedNode(node)))) {
        if (target?.matches(TURN_SELECTOR)) return !0;
        for (let node of changedNodes) {
          if (isExtensionOwnedNode(node)) continue;
          let element = elementForNode(node);
          if (element && (matchesOrContains(element, TURN_SELECTOR) || matchesOrContains(element, PROTECTED_SELECTOR)))
            return !0;
        }
      }
    }
    return !1;
  }
  function turnRole(turn) {
    let direct = turn.getAttribute("data-message-author-role"), nested = turn.querySelector("[data-message-author-role]")?.getAttribute("data-message-author-role"), role = direct ?? nested;
    return role === "user" || role === "assistant" ? role : "unknown";
  }
  function findTurnElements(root = document) {
    return Array.from(root.querySelectorAll(TURN_SELECTOR)).filter((candidate) => {
      let ancestor = candidate.parentElement?.closest(TURN_SELECTOR);
      return ancestor == null;
    });
  }
  function findConversationObserveRoot() {
    return findTurnElements()[0]?.closest("main") ?? document.querySelector("main") ?? document.documentElement;
  }
  function visibleMessageTurns(turns) {
    return turns.filter((turn) => turnRole(turn) !== "unknown");
  }
  function buildDomRounds(turns, nodeCount = countNodes) {
    let rounds = [], current = null;
    for (let turn of turns) {
      let role = turnRole(turn);
      if (current === null || role === "user") {
        current = { turns: [turn], nodeCount: nodeCount(turn) }, rounds.push(current);
        continue;
      }
      current.turns.push(turn), current.nodeCount += nodeCount(turn);
    }
    return rounds;
  }
  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    let style = document.createElement("style");
    style.id = STYLE_ID, style.dataset.csgOwned = "true", style.textContent = `
    .csg-safe-windowed { content-visibility: auto !important; contain-intrinsic-size: auto 260px; }
    .csg-balanced-hidden { display: none !important; }
    .csg-aggressive-pruned { display: none !important; }
    #${PLACEHOLDER_ID} {
      box-sizing: border-box;
      width: min(680px, calc(100% - 32px));
      margin: 12px auto;
      padding: 9px 12px;
      border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
      border-radius: 10px;
      background: color-mix(in srgb, Canvas 94%, currentColor 6%);
      color: color-mix(in srgb, CanvasText 72%, transparent);
      font: 12px/1.4 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      text-align: center;
    }
    #${PLACEHOLDER_ID} .csg-history-title { margin-bottom: 7px; }
    #${PLACEHOLDER_ID} .csg-history-actions { display:flex; justify-content:center; gap:6px; flex-wrap:wrap; }
    #${PLACEHOLDER_ID} button {
      border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
      border-radius: 7px;
      padding: 5px 8px;
      background: Canvas;
      color: CanvasText;
      cursor: pointer;
      font: inherit;
    }
  `, document.documentElement.appendChild(style);
  }
  function isVisible(element) {
    let html = element;
    return html.offsetParent !== null || getComputedStyle(html).position === "fixed";
  }
  function containsProtectedInteraction(turn) {
    if (document.activeElement && turn.contains(document.activeElement)) return !0;
    let protectedElement = turn.querySelector(PROTECTED_SELECTOR);
    return protectedElement ? isVisible(protectedElement) : !1;
  }
  function pageHasActiveGeneration() {
    let stop = document.querySelector('[data-testid="stop-button"], button[aria-label*="stop" i]');
    return stop ? isVisible(stop) : !1;
  }
  function resetTurnVisualState(turn) {
    turn.classList.remove("csg-safe-windowed", "csg-balanced-hidden"), turn.dataset.csgPruned !== "true" && turn.classList.remove("csg-aggressive-pruned");
  }
  function turnIndexForRoundBoundary(turns, rounds, requestedRounds) {
    if (rounds.length === 0) return 0;
    let keepRounds = Math.max(1, Math.min(rounds.length, requestedRounds)), firstTurn = rounds[Math.max(0, rounds.length - keepRounds)]?.turns[0];
    return firstTurn ? Math.max(0, turns.indexOf(firstTurn)) : 0;
  }
  function turnIndexForMessageBoundary(turns, requestedMessages) {
    let visibleCount = 0;
    for (let index = turns.length - 1; index >= 0; index -= 1) {
      let turn = turns[index];
      if (turn && (turnRole(turn) !== "unknown" && (visibleCount += 1), visibleCount >= Math.max(1, requestedMessages)))
        return index;
    }
    return 0;
  }
  function enforceDomBudget(turns, rounds, initialBoundary, config2, nodeCount) {
    if (turns.length === 0) return { keepFromTurnIndex: 0, limitedByDomBudget: !1 };
    let budget = Math.max(1, config2.domBudget), boundary = Math.max(0, Math.min(initialBoundary, turns.length - 1)), initial = boundary, activeCost = () => turns.slice(boundary).reduce((sum, turn) => sum + nodeCount(turn), 0), activeUnits = () => config2.historyUnit === "message" ? countRenderedMessages(turns, boundary) : countRenderedRounds(rounds, turns, boundary);
    for (; activeCost() > budget && activeUnits() > 1; ) {
      if (config2.historyUnit === "message") {
        let next = boundary + 1;
        for (; next < turns.length && turnRole(turns[next]) === "unknown"; ) next += 1;
        if (next >= turns.length) break;
        boundary = next;
        continue;
      }
      let firstKept = turns[boundary], currentRoundIndex = firstKept ? rounds.findIndex((round) => round.turns.includes(firstKept)) : -1, nextTurn = (currentRoundIndex >= 0 ? rounds[currentRoundIndex + 1] : void 0)?.turns[0];
      if (!nextTurn) break;
      let nextBoundary = turns.indexOf(nextTurn);
      if (nextBoundary <= boundary) break;
      boundary = nextBoundary;
    }
    return { keepFromTurnIndex: boundary, limitedByDomBudget: boundary > initial };
  }
  function protectSafetyWindow(turns, boundary) {
    let protectedBoundary = boundary;
    for (let index = 0; index < boundary; index += 1) {
      let turn = turns[index];
      if (turn && containsProtectedInteraction(turn)) {
        protectedBoundary = Math.min(protectedBoundary, index);
        break;
      }
    }
    return protectedBoundary;
  }
  function countRenderedMessages(turns, boundary) {
    return visibleMessageTurns(turns.slice(boundary)).length;
  }
  function countRenderedRounds(rounds, turns, boundary) {
    if (rounds.length === 0) return 0;
    let firstKept = turns[boundary];
    if (!firstKept) return 0;
    let firstRound = rounds.findIndex((round) => round.turns.includes(firstKept));
    return firstRound < 0 ? rounds.length : rounds.length - firstRound;
  }
  function setTextIfChanged(element, value) {
    element.textContent !== value && (element.textContent = value);
  }
  function createPlaceholder() {
    let placeholder = document.createElement("div");
    placeholder.id = PLACEHOLDER_ID, placeholder.dataset.csgOwned = "true";
    let title = document.createElement("div");
    title.className = "csg-history-title", title.dataset.csgOwned = "true";
    let actions = document.createElement("div");
    actions.className = "csg-history-actions", actions.dataset.csgOwned = "true";
    let load = document.createElement("button");
    load.type = "button", load.dataset.csgOwned = "true", load.dataset.csgAction = "load-previous", load.addEventListener("click", () => window.dispatchEvent(new Event(EVENTS.loadPreviousHistory)));
    let full = document.createElement("button");
    return full.type = "button", full.dataset.csgOwned = "true", full.dataset.csgAction = "temporary-full", full.addEventListener("click", () => window.dispatchEvent(new Event(EVENTS.temporaryFullHistory))), actions.append(load, full), placeholder.append(title, actions), placeholder;
  }
  function ensurePlaceholder(before, hiddenUnits, config2, olderHistoryAvailable) {
    let existing = document.getElementById(PLACEHOLDER_ID), manualServerHistory = !config2.autoLoadHistory && olderHistoryAvailable, hiddenDomHistory = hiddenUnits > 0 && config2.mode !== "safe";
    if (!before || !hiddenDomHistory && !manualServerHistory) {
      existing?.remove();
      return;
    }
    let placeholder = existing ?? createPlaceholder();
    existing ? (placeholder.parentNode !== before.parentNode || placeholder.nextSibling !== before) && before.parentNode?.insertBefore(placeholder, before) : before.parentNode?.insertBefore(placeholder, before);
    let title = placeholder.querySelector(".csg-history-title"), load = placeholder.querySelector('[data-csg-action="load-previous"]'), full = placeholder.querySelector('[data-csg-action="temporary-full"]');
    if (!title || !load || !full) return;
    let unitLabel = config2.historyUnit === "message" ? "message" : "round";
    setTextIfChanged(title, manualServerHistory ? "Earlier history is available to load" : `${hiddenUnits} earlier ${unitLabel}${hiddenUnits === 1 ? "" : "s"} paused from rendering`);
    let loadText = `Load previous ${config2.historyBatchSize}`;
    setTextIfChanged(load, loadText), load.hidden = config2.autoLoadHistory, setTextIfChanged(full, "Temporary Full History");
  }
  function turnId(turn) {
    return turn?.getAttribute("data-turn-id") ?? turn?.getAttribute("data-testid") ?? null;
  }
  function lastVisibleUserIndex(turns) {
    for (let index = turns.length - 1; index >= 0; index -= 1) {
      let turn = turns[index];
      if (turn && turnRole(turn) === "user") return index;
    }
    return -1;
  }
  var DomRollingWindow = class {
    prunedTurns = 0;
    activeRoundStart = null;
    apply(config2, conversationId = null, olderHistoryAvailable = !1) {
      ensureStyles();
      let turns = findTurnElements(), nodeCount = createNodeCounter(), rounds = buildDomRounds(turns, nodeCount), totalMessages = visibleMessageTurns(turns).length, requested = historyTarget(config2, conversationId), generationActive = pageHasActiveGeneration();
      if (!config2.enabled || config2.temporaryFullHistory) {
        this.activeRoundStart = null;
        for (let turn of turns) resetTurnVisualState(turn);
        return document.getElementById(PLACEHOLDER_ID)?.remove(), this.stats(config2, turns, rounds, 0, !1, requested, nodeCount, generationActive);
      }
      let initialBoundary = config2.historyUnit === "message" ? turnIndexForMessageBoundary(turns, requested) : turnIndexForRoundBoundary(turns, rounds, requested), budgetDecision = enforceDomBudget(turns, rounds, initialBoundary, config2, nodeCount), keepFromTurnIndex = protectSafetyWindow(turns, budgetDecision.keepFromTurnIndex);
      if (generationActive) {
        let latestUserIndex = lastVisibleUserIndex(turns), latestUser = latestUserIndex >= 0 ? turns[latestUserIndex] ?? null : null, pinnedIndex = this.activeRoundStart ? turns.indexOf(this.activeRoundStart) : -1;
        (!this.activeRoundStart || pinnedIndex < 0 || latestUser && latestUserIndex > pinnedIndex) && (this.activeRoundStart = latestUser);
        let activeIndex = this.activeRoundStart ? turns.indexOf(this.activeRoundStart) : -1;
        activeIndex >= 0 && (keepFromTurnIndex = Math.min(keepFromTurnIndex, activeIndex));
      } else
        this.activeRoundStart = null;
      for (let index = 0; index < turns.length; index += 1) {
        let turn = turns[index];
        if (!turn) continue;
        if (index >= keepFromTurnIndex) {
          resetTurnVisualState(turn);
          continue;
        }
        if (config2.mode === "safe") {
          turn.classList.add("csg-safe-windowed"), turn.classList.remove("csg-balanced-hidden");
          continue;
        }
        if (config2.mode === "balanced" || config2.mode === "ultra-lite") {
          turn.classList.add("csg-balanced-hidden"), turn.classList.remove("csg-safe-windowed");
          continue;
        }
        turn.dataset.csgPruned !== "true" && !containsProtectedInteraction(turn) && (turn.replaceChildren(), turn.dataset.csgPruned = "true", this.prunedTurns += 1), turn.classList.add("csg-aggressive-pruned");
      }
      let renderedMessages = countRenderedMessages(turns, keepFromTurnIndex), renderedRounds = countRenderedRounds(rounds, turns, keepFromTurnIndex), hiddenUnits = config2.historyUnit === "message" ? Math.max(0, totalMessages - renderedMessages) : Math.max(0, rounds.length - renderedRounds);
      return ensurePlaceholder(turns[keepFromTurnIndex] ?? turns[0] ?? null, hiddenUnits, config2, olderHistoryAvailable), this.stats(config2, turns, rounds, keepFromTurnIndex, budgetDecision.limitedByDomBudget, requested, nodeCount, generationActive);
    }
    /** Route switches stop Guard-owned work without walking or revealing the outgoing React tree. */
    cleanupForNavigation() {
      document.getElementById(PLACEHOLDER_ID)?.remove(), this.activeRoundStart = null;
    }
    /** Explicit native/full-history restore path. */
    restoreAllVisualState() {
      document.getElementById(PLACEHOLDER_ID)?.remove();
      for (let turn of findTurnElements()) resetTurnVisualState(turn);
      this.activeRoundStart = null;
    }
    /** Backward-compatible explicit cleanup used by tests/benchmarks. */
    cleanup() {
      this.restoreAllVisualState();
    }
    stats(config2, turns, rounds, boundary, limitedByDomBudget, configuredHistoryCount, nodeCount, generationActive) {
      let conversationDomNodes = turns.reduce((sum, turn) => sum + nodeCount(turn), 0), activeConversationDomNodes = turns.slice(boundary).reduce((sum, turn) => sum + nodeCount(turn), 0), renderedMessages = countRenderedMessages(turns, boundary), renderedRounds = countRenderedRounds(rounds, turns, boundary);
      return {
        totalRounds: rounds.length,
        renderedRounds,
        totalMessages: visibleMessageTurns(turns).length,
        renderedMessages,
        conversationDomNodes,
        activeConversationDomNodes,
        hiddenRounds: Math.max(0, rounds.length - renderedRounds),
        prunedTurns: this.prunedTurns,
        configuredHistoryCount,
        historyUnit: config2.historyUnit,
        limitedByDomBudget,
        boundaryIndex: boundary,
        boundaryTurnId: turnId(turns[boundary]),
        lastVisibleUserIndex: lastVisibleUserIndex(turns),
        generationActive
      };
    }
  };

  // src/content/history-session.ts
  async function loadHistoryExpansion() {
    try {
      let state = (await chrome.runtime.sendMessage({ type: "csg:history-session-get" }))?.state;
      return !state || typeof state.conversationId != "string" || !Number.isFinite(state.amount) ? null : { conversationId: state.conversationId, amount: Math.max(0, Math.round(state.amount)) };
    } catch {
      return null;
    }
  }
  async function saveHistoryExpansion(state) {
    try {
      return (await chrome.runtime.sendMessage({ type: "csg:history-session-set", state }))?.ok === !0;
    } catch {
      return !1;
    }
  }
  async function clearHistoryExpansion() {
    try {
      return (await chrome.runtime.sendMessage({ type: "csg:history-session-clear" }))?.ok === !0;
    } catch {
      return !1;
    }
  }

  // src/content/metrics.ts
  function readJsHeapMb() {
    let bytes = performance.memory?.usedJSHeapSize;
    return typeof bytes == "number" && Number.isFinite(bytes) ? Math.round(bytes / 1024 / 1024 * 10) / 10 : null;
  }
  function countDocumentNodes() {
    return document.documentElement ? 1 + document.documentElement.querySelectorAll("*").length : 0;
  }
  function buildMetrics(params) {
    return {
      conversationId: params.conversationId,
      spaSwitchCount: params.spaSwitchCount,
      renderedRounds: params.dom.renderedRounds,
      totalRounds: params.dom.totalRounds,
      renderedMessages: params.dom.renderedMessages,
      totalMessages: params.dom.totalMessages,
      configuredHistoryCount: params.dom.configuredHistoryCount,
      historyUnit: params.dom.historyUnit,
      limitedByDomBudget: params.dom.limitedByDomBudget,
      conversationDomNodes: params.dom.conversationDomNodes,
      activeConversationDomNodes: params.dom.activeConversationDomNodes,
      totalDocumentDomNodes: countDocumentNodes(),
      networkMode: params.networkMode,
      networkModified: params.networkModified,
      networkRequestedTurns: params.networkRequestedTurns,
      networkEffectiveTurns: params.networkEffectiveTurns,
      cleanupCount: params.cleanupCount,
      hardSwitchCount: params.hardSwitchCount,
      switchLatencyMs: params.switchLatencyMs,
      jsHeapMb: readJsHeapMb(),
      lastUpdatedAt: Date.now()
    };
  }

  // src/content/session-controller.ts
  var NAVIGATION_SETTLE_MS = 80, NAVIGATION_DOM_MISSING_MS = 1500, EMPTY_DOM = {
    totalRounds: 0,
    renderedRounds: 0,
    totalMessages: 0,
    renderedMessages: 0,
    conversationDomNodes: 0,
    activeConversationDomNodes: 0,
    hiddenRounds: 0,
    prunedTurns: 0,
    configuredHistoryCount: 0,
    historyUnit: "round",
    limitedByDomBudget: !1,
    boundaryIndex: 0,
    boundaryTurnId: null,
    lastVisibleUserIndex: -1,
    generationActive: !1
  };
  function roundMs(value) {
    return Math.round(value * 10) / 10;
  }
  function turnMountId(turn) {
    return turn ? turn.getAttribute("data-turn-id") ?? turn.querySelector("[data-message-id]")?.getAttribute("data-message-id") ?? null : null;
  }
  function elementForNode2(node) {
    return node ? node instanceof Element ? node : node.parentElement : null;
  }
  function recordsRemoveTurn(records, turn) {
    if (!turn) return !1;
    for (let record of records)
      for (let node of record.removedNodes) {
        let element = elementForNode2(node);
        if (element && (element === turn || element.contains(turn))) return !0;
      }
    return !1;
  }
  var SessionController = class {
    config;
    domWindow = new DomRollingWindow();
    hardSwitch = new HardSwitchGuard();
    navigation;
    onMetrics;
    onTrace;
    onEvaluationStats;
    globalAbort = null;
    mountObserver = null;
    scopeObserver = null;
    scopeTimer = null;
    missingDomTimer = null;
    currentConversationId = null;
    hasInitialNavigation = !1;
    navigationEpoch = 0;
    navigationTransaction = null;
    spaSwitchCount = 0;
    cleanupCount = 0;
    visualRestoreCount = 0;
    ignoredExtensionMutationCount = 0;
    lastGenerationActive = !1;
    networkMode = "unknown";
    networkModified = !1;
    networkRequestedTurns = null;
    networkEffectiveTurns = null;
    olderHistoryAvailable = !1;
    lastSwitchLatencyMs = null;
    metrics = { ...EMPTY_METRICS };
    constructor(config2, onMetrics, onTrace, onEvaluationStats) {
      this.config = config2, this.onMetrics = onMetrics, this.onTrace = onTrace, this.onEvaluationStats = onEvaluationStats, this.navigation = new NavigationObserver(
        (conversationId) => this.onNavigation(conversationId),
        () => this.onSameConversationMutation()
      );
    }
    start() {
      this.globalAbort || (this.globalAbort = new AbortController(), window.addEventListener(EVENTS.networkStatus, (event) => {
        let status = parseStringEvent(event);
        status && (status.conversationId !== void 0 && status.conversationId !== this.currentConversationId || (this.networkMode = status.mode, this.networkModified = status.modified, this.networkRequestedTurns = status.requestedTurns ?? null, this.networkEffectiveTurns = status.effectiveTurns ?? null, typeof status.olderHistoryAvailable == "boolean" && (this.olderHistoryAvailable = status.olderHistoryAvailable), this.scheduleEvaluate(0, "network-status")));
      }, { signal: this.globalAbort.signal }), this.navigation.start());
    }
    updateConfig(config2) {
      let shouldRestoreVisualState = this.config.enabled && !config2.enabled || !this.config.temporaryFullHistory && config2.temporaryFullHistory;
      this.config = config2, shouldRestoreVisualState && (this.domWindow.restoreAllVisualState(), this.visualRestoreCount += 1), this.scheduleEvaluate(0, "config-update");
    }
    getMetrics() {
      return { ...this.metrics };
    }
    destroy() {
      this.navigation.destroy(), this.cleanupScope(), this.domWindow.restoreAllVisualState(), this.globalAbort?.abort(), this.globalAbort = null;
    }
    onSameConversationMutation() {
      this.trace({ type: "navigation", sameConversation: !0 }), this.scheduleEvaluate(0, "same-conversation-navigation");
    }
    onNavigation(conversationId) {
      let previousConversationId = this.currentConversationId;
      if (this.hasInitialNavigation && previousConversationId === conversationId) {
        this.scheduleEvaluate(0, "same-conversation-navigation");
        return;
      }
      let outgoingFirstTurn = this.hasInitialNavigation ? findTurnElements()[0] ?? null : null, outgoingFirstOpaqueId = turnMountId(outgoingFirstTurn);
      this.navigationEpoch += 1;
      let startedAt = performance.now();
      if (this.hasInitialNavigation && (this.spaSwitchCount += 1), this.hasInitialNavigation = !0, this.cleanupScope(), this.currentConversationId = conversationId, this.networkMode = this.config.enabled && !this.config.temporaryFullHistory ? "unknown" : "disabled", this.networkModified = !1, this.networkRequestedTurns = null, this.networkEffectiveTurns = null, this.olderHistoryAvailable = !1, this.trace({ type: "navigation", sameConversation: !1, navigationPhase: "start" }), !conversationId) {
        this.lastSwitchLatencyMs = null, this.metrics = buildMetrics({
          conversationId: null,
          spaSwitchCount: this.spaSwitchCount,
          cleanupCount: this.cleanupCount,
          hardSwitchCount: this.hardSwitch.countPerformed,
          networkMode: this.networkMode,
          networkModified: this.networkModified,
          networkRequestedTurns: this.networkRequestedTurns,
          networkEffectiveTurns: this.networkEffectiveTurns,
          switchLatencyMs: this.lastSwitchLatencyMs,
          dom: EMPTY_DOM
        }), this.publishMetrics();
        return;
      }
      let transaction = {
        epoch: this.navigationEpoch,
        startedAt,
        outgoingFirstTurn,
        outgoingFirstOpaqueId,
        sawEmptyDom: !1,
        sawOldDetach: !1,
        blankStartedAt: null,
        blankIntervalMs: 0,
        firstTurnMountedAt: null,
        missingReported: !1
      };
      this.navigationTransaction = transaction, this.installMountObserver(transaction), this.checkNavigationMount(transaction);
    }
    installMountObserver(transaction) {
      this.mountObserver?.disconnect(), this.mountObserver = new MutationObserver((records) => {
        if (transaction.epoch !== this.navigationEpoch || this.navigationTransaction !== transaction) return;
        let detached = recordsRemoveTurn(records, transaction.outgoingFirstTurn);
        detached && (transaction.sawOldDetach = !0);
        let outgoingIdentityChanged = records.some(
          (record) => record.type === "attributes" && record.attributeName === "data-message-id" && transaction.outgoingFirstTurn?.contains(record.target) === !0
        );
        !detached && !outgoingIdentityChanged && !mutationNeedsConversationEvaluate(records) || this.checkNavigationMount(transaction);
      }), this.mountObserver.observe(document.documentElement, {
        childList: !0,
        subtree: !0,
        attributes: !0,
        attributeFilter: ["data-turn-id", "data-message-id"]
      });
    }
    checkNavigationMount(transaction) {
      if (transaction.epoch !== this.navigationEpoch || this.navigationTransaction !== transaction) return;
      let turns = findTurnElements();
      if (turns.length === 0) {
        transaction.sawEmptyDom = !0, this.beginBlankInterval(transaction);
        return;
      }
      this.endBlankInterval(transaction);
      let firstTurn = turns[0] ?? null, firstOpaqueId = turnMountId(firstTurn);
      (transaction.outgoingFirstTurn === null || transaction.sawEmptyDom || transaction.sawOldDetach || firstTurn !== transaction.outgoingFirstTurn || transaction.outgoingFirstOpaqueId && firstOpaqueId && transaction.outgoingFirstOpaqueId !== firstOpaqueId) && (transaction.firstTurnMountedAt = performance.now(), this.trace({
        type: "navigation",
        navigationPhase: "first-turn-mounted",
        navigationElapsedMs: roundMs(transaction.firstTurnMountedAt - transaction.startedAt),
        firstTurnMountedMs: roundMs(transaction.firstTurnMountedAt - transaction.startedAt),
        blankIntervalMs: roundMs(transaction.blankIntervalMs)
      }), this.mountObserver?.disconnect(), this.mountObserver = null, this.installScopeObserver(), this.scheduleEvaluate(NAVIGATION_SETTLE_MS, "navigation"));
    }
    beginBlankInterval(transaction) {
      transaction.blankStartedAt === null && (transaction.blankStartedAt = performance.now(), this.missingDomTimer !== null && window.clearTimeout(this.missingDomTimer), this.missingDomTimer = window.setTimeout(() => {
        if (this.missingDomTimer = null, transaction.epoch !== this.navigationEpoch || this.navigationTransaction !== transaction) return;
        if (transaction.blankStartedAt === null || findTurnElements().length > 0) {
          this.checkNavigationMount(transaction);
          return;
        }
        if (transaction.missingReported) return;
        transaction.missingReported = !0;
        let now = performance.now(), blankInterval = transaction.blankIntervalMs + (now - transaction.blankStartedAt);
        this.trace({
          type: "navigation",
          navigationPhase: "dom-missing",
          navigationElapsedMs: roundMs(now - transaction.startedAt),
          blankIntervalMs: roundMs(blankInterval)
        });
      }, NAVIGATION_DOM_MISSING_MS));
    }
    endBlankInterval(transaction) {
      transaction.blankStartedAt !== null && (transaction.blankIntervalMs += performance.now() - transaction.blankStartedAt, transaction.blankStartedAt = null, this.missingDomTimer !== null && (window.clearTimeout(this.missingDomTimer), this.missingDomTimer = null));
    }
    installScopeObserver() {
      this.scopeObserver?.disconnect();
      let epoch = this.navigationEpoch;
      this.scopeObserver = new MutationObserver((records) => {
        if (epoch !== this.navigationEpoch) return;
        if (!mutationNeedsConversationEvaluate(records)) {
          let ignoredOwned = records.filter((record) => (record.target instanceof Element ? record.target : record.target.parentElement)?.closest('[data-csg-owned="true"], #csg-history-placeholder, #csg-window-styles') !== null).length;
          this.ignoredExtensionMutationCount += ignoredOwned, this.trace({
            type: "observer",
            observerMutationCount: records.length,
            ignoredExtensionMutationCount: ignoredOwned
          });
          return;
        }
        this.trace({ type: "observer", observerMutationCount: records.length, ignoredExtensionMutationCount: 0 });
        let settleDelay = this.lastGenerationActive && mutationChangesGenerationControl(records) ? 250 : NAVIGATION_SETTLE_MS;
        this.scheduleEvaluate(settleDelay, "conversation-topology");
      }), this.scopeObserver.observe(findConversationObserveRoot(), { childList: !0, subtree: !0 });
    }
    scheduleEvaluate(delay = NAVIGATION_SETTLE_MS, reason = "conversation-topology") {
      if (!this.currentConversationId || !this.scopeObserver || this.scopeTimer !== null) return;
      let taskEpoch = this.navigationEpoch;
      this.scopeTimer = window.setTimeout(() => {
        this.scopeTimer = null, taskEpoch === this.navigationEpoch && this.evaluate(reason, taskEpoch);
      }, delay);
    }
    evaluate(reason, taskEpoch) {
      if (taskEpoch !== this.navigationEpoch) return;
      let transaction = this.navigationTransaction?.epoch === taskEpoch ? this.navigationTransaction : null, guardApplyStartedAt = performance.now(), dom = this.domWindow.apply(this.config, this.currentConversationId, this.olderHistoryAvailable), guardApplyEndedAt = performance.now(), duration = Math.round((guardApplyEndedAt - guardApplyStartedAt) * 100) / 100;
      this.onEvaluationStats?.(this.currentConversationId, dom), this.lastGenerationActive = dom.generationActive;
      let timing = {};
      if (transaction?.firstTurnMountedAt !== null && transaction?.firstTurnMountedAt !== void 0) {
        this.endBlankInterval(transaction);
        let totalSwitchLatencyMs = roundMs(guardApplyEndedAt - transaction.startedAt);
        this.lastSwitchLatencyMs = totalSwitchLatencyMs, timing = {
          stableDomMs: roundMs(guardApplyStartedAt - transaction.startedAt),
          guardApplyStartMs: roundMs(guardApplyStartedAt - transaction.startedAt),
          guardApplyEndMs: totalSwitchLatencyMs,
          blankIntervalMs: roundMs(transaction.blankIntervalMs),
          totalSwitchLatencyMs
        }, this.navigationTransaction = null, this.missingDomTimer !== null && (window.clearTimeout(this.missingDomTimer), this.missingDomTimer = null);
      }
      this.metrics = buildMetrics({
        conversationId: this.currentConversationId,
        spaSwitchCount: this.spaSwitchCount,
        cleanupCount: this.cleanupCount,
        hardSwitchCount: this.hardSwitch.countPerformed,
        networkMode: this.networkMode,
        networkModified: this.networkModified,
        networkRequestedTurns: this.networkRequestedTurns,
        networkEffectiveTurns: this.networkEffectiveTurns,
        switchLatencyMs: this.lastSwitchLatencyMs,
        dom
      }), this.publishMetrics(), this.trace({
        type: "evaluate",
        reason,
        evaluateDurationMs: duration,
        olderHistoryAvailable: this.olderHistoryAvailable,
        dom,
        scrollHeight: document.documentElement.scrollHeight,
        ...timing
      }), this.hardSwitch.observe(this.metrics), this.hardSwitch.shouldHardReload(this.config, this.metrics) && (this.hardSwitch.markHardReload(this.spaSwitchCount), location.replace(location.href));
    }
    publishMetrics() {
      this.onMetrics?.({ ...this.metrics });
    }
    trace(partial) {
      this.onTrace?.({
        timestamp: Date.now(),
        conversationId: this.currentConversationId,
        navigationEpoch: this.navigationEpoch,
        cleanupCount: this.cleanupCount,
        visualRestoreCount: this.visualRestoreCount,
        pathname: location.pathname,
        queryKeys: [...new URL(location.href).searchParams.keys()].sort(),
        ...partial
      });
    }
    cleanupScope() {
      let hadScope = this.mountObserver !== null || this.scopeObserver !== null || this.scopeTimer !== null || this.navigationTransaction !== null || this.currentConversationId !== null;
      this.mountObserver?.disconnect(), this.mountObserver = null, this.scopeObserver?.disconnect(), this.scopeObserver = null, this.scopeTimer !== null && (window.clearTimeout(this.scopeTimer), this.scopeTimer = null), this.missingDomTimer !== null && (window.clearTimeout(this.missingDomTimer), this.missingDomTimer = null), this.navigationTransaction = null, this.domWindow.cleanupForNavigation(), hadScope && (this.cleanupCount += 1);
    }
  };

  // src/content/stats-bridge.ts
  function addDelta(target, key, amount = 1) {
    if (key === "switchLatencySamples") return;
    let current = target[key];
    typeof current == "number" ? target[key] = current + amount : target[key] = amount;
  }
  function alternating(values) {
    if (values.length < 4) return !1;
    let [a, b, c, d] = values.slice(-4);
    return a !== b && a === c && b === d;
  }
  function hasPending(delta) {
    return Object.keys(delta).length > 0;
  }
  function mergePending(target, source) {
    let merged = { ...target }, incrementKeys = [
      "sessionOpenAttemptCount",
      "sessionOpenSuccessCount",
      "failedOpen429Count",
      "historyRequestCount",
      "singleFlightHitCount",
      "olderPageSuppressedCount",
      "rateLimitCooldownStartCount",
      "rateLimitCooldownHitCount",
      "spaSwitchCount",
      "windowFlappingDetectedCount"
    ];
    for (let key of incrementKeys) {
      let value = source[key];
      typeof value == "number" && addDelta(merged, key, value);
    }
    merged.maxActiveConversationDomNodes = Math.max(
      merged.maxActiveConversationDomNodes ?? 0,
      source.maxActiveConversationDomNodes ?? 0
    ), merged.maxDocumentDomNodes = Math.max(
      merged.maxDocumentDomNodes ?? 0,
      source.maxDocumentDomNodes ?? 0
    );
    let samples = [...merged.switchLatencySamples ?? [], ...source.switchLatencySamples ?? []];
    return samples.length > 0 && (merged.switchLatencySamples = samples), merged;
  }
  var LocalStatsBridge = class {
    pending = {};
    flushTimer = null;
    lastSpaSwitchCount = 0;
    lastLatencySwitchCount = -1;
    maxActiveDom = 0;
    maxDocumentDom = 0;
    conversationId = null;
    boundaryIndexes = [];
    hiddenRounds = [];
    flappingActive = !1;
    recordEvent(event) {
      let key = {
        "session-open-attempt": "sessionOpenAttemptCount",
        "session-open-success": "sessionOpenSuccessCount",
        "failed-open-429": "failedOpen429Count",
        "history-request": "historyRequestCount",
        "single-flight-hit": "singleFlightHitCount",
        "older-page-suppressed": "olderPageSuppressedCount",
        "rate-limit-cooldown-start": "rateLimitCooldownStartCount",
        "rate-limit-cooldown-hit": "rateLimitCooldownHitCount"
      }[event.type];
      key && (addDelta(this.pending, key), this.scheduleFlush());
    }
    observeMetrics(metrics) {
      let changed = !1;
      metrics.spaSwitchCount > this.lastSpaSwitchCount && (addDelta(this.pending, "spaSwitchCount", metrics.spaSwitchCount - this.lastSpaSwitchCount), this.lastSpaSwitchCount = metrics.spaSwitchCount, changed = !0), metrics.switchLatencyMs !== null && metrics.spaSwitchCount > 0 && metrics.spaSwitchCount !== this.lastLatencySwitchCount && (this.pending.switchLatencySamples = [
        ...this.pending.switchLatencySamples ?? [],
        metrics.switchLatencyMs
      ], this.lastLatencySwitchCount = metrics.spaSwitchCount, changed = !0), metrics.activeConversationDomNodes > this.maxActiveDom && (this.maxActiveDom = metrics.activeConversationDomNodes, this.pending.maxActiveConversationDomNodes = this.maxActiveDom, changed = !0), metrics.totalDocumentDomNodes > this.maxDocumentDom && (this.maxDocumentDom = metrics.totalDocumentDomNodes, this.pending.maxDocumentDomNodes = this.maxDocumentDom, changed = !0), changed && this.scheduleFlush();
    }
    observeEvaluation(conversationId, dom) {
      if (conversationId !== this.conversationId && (this.conversationId = conversationId, this.boundaryIndexes = [], this.hiddenRounds = [], this.flappingActive = !1), !conversationId) return;
      this.boundaryIndexes.push(dom.boundaryIndex), this.hiddenRounds.push(dom.hiddenRounds), this.boundaryIndexes.length > 4 && this.boundaryIndexes.shift(), this.hiddenRounds.length > 4 && this.hiddenRounds.shift();
      let flapping = alternating(this.boundaryIndexes) || alternating(this.hiddenRounds);
      flapping && !this.flappingActive ? (addDelta(this.pending, "windowFlappingDetectedCount"), this.flappingActive = !0, this.scheduleFlush()) : flapping || (this.flappingActive = !1);
    }
    async flushNow() {
      if (this.flushTimer !== null && (window.clearTimeout(this.flushTimer), this.flushTimer = null), !hasPending(this.pending)) return;
      let delta = this.pending;
      this.pending = {};
      try {
        await chrome.runtime.sendMessage({ type: "csg:stats-apply-delta", delta });
      } catch {
        this.pending = mergePending(this.pending, delta);
      }
    }
    destroy() {
      this.flushNow();
    }
    scheduleFlush() {
      this.flushTimer === null && (this.flushTimer = window.setTimeout(() => {
        this.flushTimer = null, this.flushNow();
      }, 1e3));
    }
  };

  // src/content/index.ts
  var config = DEFAULT_CONFIG, historyExpansion = null, controller = null, benchmarkRunner = null;
  var longStressRunner = null, fieldRecorder = null, statsBridge = new LocalStatsBridge();
  var sessionGuardEnabled = !1;
  function currentConversationId() {
    return extractConversationId(location.pathname);
  }
  function runtimeConfig() {
    let conversationId = currentConversationId();
    let base = { ...config, enabled: sessionGuardEnabled };
    return !historyExpansion || !conversationId || historyExpansion.conversationId !== conversationId ? { ...base, historyExpansion: 0, historyExpansionConversationId: null } : {
      ...base,
      historyExpansion: historyExpansion.amount,
      historyExpansionConversationId: historyExpansion.conversationId
    };
  }
  function sendConfigToMainWorld() {
    dispatchStringEvent(EVENTS.config, runtimeConfig());
  }
  async function saveConfig(next) {
    config = normalizeConfig(persistentConfig(next));
    let { enabled: _enabled, ...storedConfig } = config;
    await chrome.storage.local.set({ [STORAGE_KEY]: storedConfig });
    let runtime = runtimeConfig();
    dispatchStringEvent(EVENTS.config, runtime), controller?.updateConfig(runtime);
  }
  async function loadConfig() {
    try {
      let stored = await chrome.storage.local.get(STORAGE_KEY);
      let value = stored[STORAGE_KEY];
      if (value && typeof value === "object" && "enabled" in value) {
        let { enabled: _enabled, ...migrated } = value;
        value = migrated;
        await chrome.storage.local.set({ [STORAGE_KEY]: migrated });
      }
      return normalizeConfig(value);
    } catch {
      return DEFAULT_CONFIG;
    }
  }
  async function loadPreviousHistory() {
    if (!sessionGuardEnabled) return { ok: !1, error: "SESSION_GUARD_DISABLED" };
    let conversationId = currentConversationId();
    if (!conversationId) return { ok: !1, error: "\u8BF7\u5148\u6253\u5F00\u4E00\u4E2A\u6B63\u5E38\u7684 ChatGPT \u4F1A\u8BDD\u3002" };
    if (hasUnsafeInteractiveState()) return { ok: !1, error: "ChatGPT \u6B63\u5728\u5904\u7406\u4EFB\u52A1\uFF0C\u8BF7\u7B49\u5F85\u5F53\u524D\u4EFB\u52A1\u7ED3\u675F\u540E\u518D\u52A0\u8F7D\u66F4\u65E9\u5386\u53F2\u3002" };
    let previous = historyExpansion?.conversationId === conversationId ? historyExpansion.amount : 0;
    historyExpansion = { conversationId, amount: Math.min(200, previous + config.historyBatchSize) }, await saveHistoryExpansion(historyExpansion);
    let runtime = runtimeConfig();
    return dispatchStringEvent(EVENTS.config, runtime), controller?.updateConfig(runtime), window.setTimeout(() => location.reload(), 80), { ok: !0 };
  }
  async function enableTemporaryFullHistory() {
    if (!sessionGuardEnabled) return { ok: !1, error: "SESSION_GUARD_DISABLED" };
    return hasUnsafeInteractiveState() ? { ok: !1, error: "ChatGPT \u6B63\u5728\u5904\u7406\u4EFB\u52A1\uFF0C\u8BF7\u7B49\u5F85\u5F53\u524D\u4EFB\u52A1\u7ED3\u675F\u540E\u518D\u663E\u793A\u5B8C\u6574\u5386\u53F2\u3002" } : (historyExpansion = null, await clearHistoryExpansion(), await saveConfig({ ...config, temporaryFullHistory: !0 }), window.setTimeout(() => location.reload(), 80), { ok: !0 });
  }
  async function restoreLightweightMode() {
    if (!sessionGuardEnabled) return { ok: !1, error: "SESSION_GUARD_DISABLED" };
    return hasUnsafeInteractiveState() ? { ok: !1, error: "ChatGPT \u6B63\u5728\u5904\u7406\u4EFB\u52A1\uFF0C\u8BF7\u7B49\u5F85\u5F53\u524D\u4EFB\u52A1\u7ED3\u675F\u540E\u518D\u6062\u590D\u8F7B\u91CF\u6A21\u5F0F\u3002" } : (historyExpansion = null, await clearHistoryExpansion(), await saveConfig({ ...config, temporaryFullHistory: !1 }), window.setTimeout(() => location.reload(), 80), { ok: !0 });
  }
  function setupHistoryEvents() {
    window.addEventListener(EVENTS.loadPreviousHistory, () => {
      loadPreviousHistory();
    }), window.addEventListener(EVENTS.temporaryFullHistory, () => {
      enableTemporaryFullHistory();
    }), window.addEventListener(EVENTS.navigation, () => {
      let conversationId = currentConversationId();
      if (!historyExpansion || historyExpansion.conversationId === conversationId) return;
      historyExpansion = null, clearHistoryExpansion();
      let runtime = runtimeConfig();
      dispatchStringEvent(EVENTS.config, runtime), controller?.updateConfig(runtime);
    });
  }
  function setupStatsEvents() {
    window.addEventListener(EVENTS.stats, (event) => {
      let statsEvent = parseStringEvent(event);
      statsEvent && (statsBridge.recordEvent(statsEvent), fieldRecorder?.recordStatsEvent(statsEvent.type));
    });
  }
  function setupRuntimeMessages() {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      let request = message;
      if (request.type === "csg:get-state") {
        let response = {
          metrics: controller?.getMetrics() ?? { ...EMPTY_METRICS },
          benchmark: null,
          longStress: null
        };
        return sendResponse(response), !1;
      }
      return request.type === "csg:history-load-previous" ? (loadPreviousHistory().then((result) => sendResponse(result)), !0) : request.type === "csg:temporary-full-history" ? (enableTemporaryFullHistory().then((result) => sendResponse(result)), !0) : request.type === "csg:restore-lightweight" ? (restoreLightweightMode().then((result) => sendResponse(result)), !0) : !1;
    });
  }
  async function init() {
    sessionGuardEnabled = (await globalThis.ChatXFeatures.get()).sessionGuard;
    window.addEventListener(EVENTS.requestConfig, sendConfigToMainWorld), setupStatsEvents(), setupHistoryEvents(), config = await loadConfig(), historyExpansion = await loadHistoryExpansion(), sendConfigToMainWorld(), controller = new SessionController(
      runtimeConfig(),
      (metrics) => {
        statsBridge.observeMetrics(metrics), fieldRecorder?.notifyEvaluation();
      },
      void 0,
      (conversationId, dom) => statsBridge.observeEvaluation(conversationId, dom)
    ), controller.start(), chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local") return;
      let changed = !1;
      if (changes[globalThis.ChatXFeatures.KEY]) {
        sessionGuardEnabled = globalThis.ChatXFeatures.normalize(changes[globalThis.ChatXFeatures.KEY].newValue).sessionGuard;
        changed = !0;
      }
      if (changes[STORAGE_KEY]) {
        config = normalizeConfig(changes[STORAGE_KEY]?.newValue);
        changed = !0;
      }
      if (!changed) return;
      let runtime = runtimeConfig();
      dispatchStringEvent(EVENTS.config, runtime), controller?.updateConfig(runtime);
    }), setupRuntimeMessages(), window.addEventListener("pagehide", () => {
      benchmarkRunner?.destroy(), fieldRecorder?.destroy(), controller?.destroy(), statsBridge.destroy();
    }, { once: !0 });
  }
  init();
})();
