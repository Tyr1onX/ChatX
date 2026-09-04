"use strict";
(() => {
  // src/shared/config.ts
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
  function historyTarget(config, conversationId) {
    let expansion = conversationId && config.historyExpansionConversationId === conversationId ? config.historyExpansion : 0;
    return Math.min(250, config.historyCount + expansion);
  }
  function networkHistoryTarget(config, conversationId) {
    return Math.max(4, historyTarget(config, conversationId));
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

  // src/main-world/request-classifier.ts
  var LEGACY_PATH = /^\/backend-api\/conversation\/([^/]+)\/?$/, SHARED_PATH = /^\/backend-api\/shared_conversation\/([^/]+)\/?$/, PAGINATED_PATH = /^\/backend-api\/conversations\/([^/]+)\/?$/, PAGINATED_PAGE_PATH = /^\/backend-api\/conversations\/([^/]+)\/messages\/?$/;
  function classifyRequest(input, init) {
    let rawUrl, method;
    input instanceof Request ? (rawUrl = input.url, method = (init?.method ?? input.method ?? "GET").toUpperCase()) : input instanceof URL ? (rawUrl = input.href, method = (init?.method ?? "GET").toUpperCase()) : (rawUrl = String(input), method = (init?.method ?? "GET").toUpperCase());
    let url = new URL(rawUrl, location.href);
    if (method !== "GET" || url.origin !== location.origin)
      return { kind: "other", method, url, conversationId: null };
    let paginatedPageMatch = url.pathname.match(PAGINATED_PAGE_PATH);
    if (paginatedPageMatch?.[1])
      return {
        kind: "paginated-conversation-page",
        method,
        url,
        conversationId: paginatedPageMatch[1]
      };
    let paginatedMatch = url.pathname.match(PAGINATED_PATH);
    if (paginatedMatch?.[1])
      return {
        kind: "paginated-conversation-history",
        method,
        url,
        conversationId: paginatedMatch[1]
      };
    let legacyMatch = url.pathname.match(LEGACY_PATH);
    if (legacyMatch?.[1])
      return {
        kind: "legacy-conversation-history",
        method,
        url,
        conversationId: legacyMatch[1]
      };
    let sharedMatch = url.pathname.match(SHARED_PATH);
    return sharedMatch?.[1] ? {
      kind: "shared-conversation-history",
      method,
      url,
      conversationId: sharedMatch[1]
    } : { kind: "other", method, url, conversationId: null };
  }

  // src/main-world/history-single-flight.ts
  var DEFAULT_RATE_LIMIT_COOLDOWN_MS = 1500, MIN_RATE_LIMIT_COOLDOWN_MS = 500, MAX_RATE_LIMIT_COOLDOWN_MS = 3e4, MAX_COOLDOWN_ENTRIES = 64;
  function classifyHistoryRequest(args) {
    let [input, init] = args;
    try {
      let classification = classifyRequest(input, init);
      return classification.kind === "other" ? null : classification;
    } catch {
      return null;
    }
  }
  function emitStats(type) {
    dispatchStringEvent(EVENTS.stats, { type });
  }
  function isSessionOpenRequest(classification) {
    return classification.kind === "legacy-conversation-history" || classification.kind === "paginated-conversation-history";
  }
  function emitHistoryRequestStats(classification) {
    emitStats("history-request"), isSessionOpenRequest(classification) && emitStats("session-open-attempt");
  }
  function emitHistoryResponseStats(classification, response) {
    isSessionOpenRequest(classification) && (response.status === 429 ? emitStats("failed-open-429") : response.ok && emitStats("session-open-success"));
  }
  function requestFingerprint(args) {
    let [input, init] = args;
    if (input instanceof Request || init?.signal) return null;
    let classification = classifyHistoryRequest(args);
    if (!classification || classification.method !== "GET") return null;
    let headers = [...new Headers(init?.headers).entries()].sort(([a], [b]) => a.localeCompare(b));
    return JSON.stringify({
      method: classification.method,
      url: classification.url.toString(),
      headers,
      credentials: init?.credentials ?? null,
      cache: init?.cache ?? null,
      mode: init?.mode ?? null,
      redirect: init?.redirect ?? null,
      referrer: init?.referrer ?? null,
      referrerPolicy: init?.referrerPolicy ?? null,
      integrity: init?.integrity ?? null,
      keepalive: init?.keepalive ?? null
    });
  }
  function clampCooldown(value) {
    return Math.min(MAX_RATE_LIMIT_COOLDOWN_MS, Math.max(MIN_RATE_LIMIT_COOLDOWN_MS, value));
  }
  function rateLimitCooldownMs(response, timestamp) {
    let retryAfter = response.headers.get("retry-after")?.trim();
    if (!retryAfter) return DEFAULT_RATE_LIMIT_COOLDOWN_MS;
    let seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return clampCooldown(seconds * 1e3);
    let retryAt = Date.parse(retryAfter);
    return Number.isFinite(retryAt) ? clampCooldown(retryAt - timestamp) : DEFAULT_RATE_LIMIT_COOLDOWN_MS;
  }
  function createHistorySingleFlightFetch(nativeFetch2, resolveConfig, now = Date.now) {
    let inFlight = /* @__PURE__ */ new Map(), rateLimitCooldowns = /* @__PURE__ */ new Map(), pruneCooldowns = (timestamp) => {
      for (let [key, cooldown] of rateLimitCooldowns)
        cooldown.expiresAt <= timestamp && rateLimitCooldowns.delete(key);
    }, rememberRateLimit = (key, response, timestamp, args) => {
      if (pruneCooldowns(timestamp), rateLimitCooldowns.size >= MAX_COOLDOWN_ENTRIES && !rateLimitCooldowns.has(key)) {
        let oldestKey = rateLimitCooldowns.keys().next().value;
        oldestKey && rateLimitCooldowns.delete(oldestKey);
      }
      let cooldownMs = rateLimitCooldownMs(response, timestamp);
      rateLimitCooldowns.set(key, {
        response,
        expiresAt: timestamp + cooldownMs
      }), emitStats("rate-limit-cooldown-start");
    };
    return async (...args) => {
      let config = resolveConfig();
      if (!config || !config.enabled || config.temporaryFullHistory)
        return inFlight.clear(), rateLimitCooldowns.clear(), nativeFetch2(...args);
      let classification = classifyHistoryRequest(args);
      if (!classification) return nativeFetch2(...args);
      let key = requestFingerprint(args);
      if (!key) {
        emitHistoryRequestStats(classification);
        let response = await nativeFetch2(...args);
        return emitHistoryResponseStats(classification, response), response;
      }
      let timestamp = now();
      pruneCooldowns(timestamp);
      let cooldown = rateLimitCooldowns.get(key);
      if (cooldown && cooldown.expiresAt > timestamp)
        return cooldown.expiresAt - timestamp, emitStats("rate-limit-cooldown-hit"), cooldown.response.clone();
      let shared = inFlight.get(key);
      if (shared)
        emitStats("single-flight-hit");
      else {
        emitHistoryRequestStats(classification), shared = nativeFetch2(...args), inFlight.set(key, shared);
        let owned = shared;
        owned.then(
          (response) => {
            inFlight.get(key) === owned && inFlight.delete(key), emitHistoryResponseStats(classification, response), response.status === 429 ? rememberRateLimit(key, response, now(), args) : rateLimitCooldowns.delete(key);
          },
          () => {
            inFlight.get(key) === owned && inFlight.delete(key);
          }
        );
      }
      return (await shared).clone();
    };
  }

  // src/main-world/history-single-flight-install.ts
  var runtimeConfig = null;
  window.addEventListener(EVENTS.config, (event) => {
    let parsed = parseStringEvent(event);
    parsed !== null && (runtimeConfig = normalizeConfig(parsed));
  });
  var nativeFetch = window.fetch.bind(window);
  window.fetch = createHistorySingleFlightFetch(nativeFetch, () => runtimeConfig);

  // src/main-world/legacy-adapter.ts
  var HIDDEN_CONTENT_TYPES = /* @__PURE__ */ new Set([
    "thoughts",
    "reasoning",
    "reasoning_recap",
    "computer_output",
    "tool_result",
    "execution_output",
    "model_editable_context"
  ]);
  function metadataHidesMessage(metadata) {
    return metadata ? metadata.is_visually_hidden_from_conversation === !0 || metadata.is_hidden === !0 || metadata.is_internal === !0 : !1;
  }
  function getVisibleRole(node) {
    let message = node?.message, role = message?.author?.role;
    if (role !== "user" && role !== "assistant" || metadataHidesMessage(message?.metadata)) return null;
    let contentType = message?.content?.content_type;
    return contentType && HIDDEN_CONTENT_TYPES.has(contentType) || role === "assistant" && message?.recipient && message.recipient !== "all" ? null : role;
  }
  function buildActivePath(data) {
    if (!data.mapping[data.current_node]) return null;
    let reversed = [], visited = /* @__PURE__ */ new Set(), cursor = data.current_node;
    for (; cursor; ) {
      if (visited.has(cursor)) return null;
      let node = data.mapping[cursor];
      if (!node) return null;
      visited.add(cursor), reversed.push(cursor), cursor = node.parent;
    }
    return reversed.reverse();
  }
  function buildVisibleRounds(path, mapping) {
    let rounds = [], current = null, lastVisibleRole = null;
    for (let index = 0; index < path.length; index += 1) {
      let nodeId = path[index];
      if (!nodeId) continue;
      let role = getVisibleRole(mapping[nodeId]);
      if (!role) continue;
      current === null || role === "user" || role === "assistant" && lastVisibleRole === "assistant" && current.visibleNodeIds.length === 0 ? (current = {
        startPathIndex: index,
        endPathIndex: index,
        visibleNodeIds: [nodeId]
      }, rounds.push(current)) : current && (current.endPathIndex = index, current.visibleNodeIds.push(nodeId)), lastVisibleRole = role;
    }
    return rounds;
  }
  function resolveRootId(data, path) {
    if (typeof data.root == "string" && data.mapping[data.root]) return data.root;
    let first = path[0];
    return first && data.mapping[first] ? first : null;
  }
  function trimLegacyConversation(data, keepRounds) {
    let path = buildActivePath(data);
    if (!path || path.length === 0) return null;
    let rounds = buildVisibleRounds(path, data.mapping), effectiveKeep = Math.max(1, Math.floor(keepRounds));
    if (rounds.length <= effectiveKeep)
      return { data, totalRounds: rounds.length, keptRounds: rounds.length, modified: !1 };
    let firstKeptRound = rounds[rounds.length - effectiveKeep];
    if (!firstKeptRound) return null;
    let boundaryId = path[firstKeptRound.startPathIndex], rootId = resolveRootId(data, path);
    if (!boundaryId || !rootId || boundaryId === rootId) return null;
    let rootNode = data.mapping[rootId], boundaryNode = data.mapping[boundaryId];
    if (!rootNode || !boundaryNode) return null;
    let mapping = { ...data.mapping };
    return mapping[rootId] = { ...rootNode, parent: null, children: [boundaryId] }, mapping[boundaryId] = { ...boundaryNode, parent: rootId }, {
      data: { ...data, mapping, root: rootId },
      totalRounds: rounds.length,
      keptRounds: effectiveKeep,
      modified: !0
    };
  }

  // src/main-world/paginated-adapter.ts
  function rewriteInputUrl(input, url) {
    return input instanceof Request ? new Request(url.toString(), input) : input instanceof URL ? url : url.toString();
  }
  function conversationIdFromUrl(url) {
    let match = url.pathname.match(/^\/backend-api\/conversations\/([^/]+)$/);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
  }
  function rewritePaginatedRequest(classification, config, args) {
    if (classification.kind !== "paginated-conversation-history")
      return { args, modified: !1, requestedTurns: null, effectiveTurns: null };
    let raw = classification.url.searchParams.get("num_turns");
    if (raw === null || !/^\d+$/.test(raw))
      return { args, modified: !1, requestedTurns: null, effectiveTurns: null };
    let requestedTurns = Number.parseInt(raw, 10);
    if (!Number.isSafeInteger(requestedTurns) || requestedTurns < 1 || requestedTurns > 100)
      return { args, modified: !1, requestedTurns, effectiveTurns: null };
    let conversationId = conversationIdFromUrl(classification.url), target = networkHistoryTarget(config, conversationId), effectiveTurns = Math.min(requestedTurns, target);
    if (effectiveTurns === requestedTurns)
      return { args, modified: !1, requestedTurns, effectiveTurns };
    let rewrittenUrl = new URL(classification.url.toString());
    return rewrittenUrl.searchParams.set("num_turns", String(effectiveTurns)), {
      args: [rewriteInputUrl(args[0], rewrittenUrl), args[1]],
      modified: !0,
      requestedTurns,
      effectiveTurns
    };
  }
  function isKnownOlderPageRequestShape(classification) {
    return classification.method !== "GET" || classification.kind !== "paginated-conversation-page" || !classification.url.searchParams.get("before") ? !1 : !classification.url.searchParams.has("after");
  }
  function shouldSuppressOlderHistory(classification, config) {
    if (!isKnownOlderPageRequestShape(classification) || config.autoLoadHistory || config.temporaryFullHistory) return !1;
    let conversationId = classification.conversationId;
    return !!!(conversationId && config.historyExpansionConversationId === conversationId && config.historyExpansion > 0);
  }
  function shouldPreflightSuppressOlderHistory(classification, config) {
    return shouldSuppressOlderHistory(classification, config);
  }
  function syntheticEmptyOlderHistoryPage() {
    return {
      messages: [],
      page_info: {
        start_cursor: null,
        end_cursor: null,
        has_previous_page: !1,
        has_next_page: !1
      }
    };
  }
  function suppressOlderHistoryPage(data) {
    return {
      ...data,
      messages: [],
      page_info: {
        ...data.page_info,
        has_previous_page: !1
      }
    };
  }
  function adaptPaginatedConversation(data) {
    return { data, modified: !1 };
  }

  // src/main-world/schema-validator.ts
  function isRecord(value) {
    return typeof value == "object" && value !== null && !Array.isArray(value);
  }
  function isConversationNode(value) {
    if (!isRecord(value)) return !1;
    let parent = value.parent;
    return (typeof parent == "string" || parent === null) && (value.children === void 0 || Array.isArray(value.children) && value.children.every((entry) => typeof entry == "string"));
  }
  function validOptionalString(value) {
    return value == null || typeof value == "string";
  }
  function validOptionalBoolean(value) {
    return value === void 0 || typeof value == "boolean";
  }
  function isPageInfo(value) {
    return isRecord(value) ? validOptionalString(value.start_cursor) && validOptionalString(value.end_cursor) && validOptionalBoolean(value.has_previous_page) && validOptionalBoolean(value.has_next_page) : !1;
  }
  function isPaginatedMessage(value) {
    return !(!isRecord(value) || value.id !== void 0 && typeof value.id != "string" || value.author !== void 0 && !isRecord(value.author) || value.content !== void 0 && !isRecord(value.content) || value.metadata !== void 0 && !isRecord(value.metadata));
  }
  function detectConversationSchema(value) {
    if (!isRecord(value)) return { kind: "unknown", data: value };
    if (isRecord(value.mapping) && typeof value.current_node == "string") {
      let currentNode = value.mapping[value.current_node];
      if (currentNode && isConversationNode(currentNode))
        return { kind: "legacy", data: value };
    }
    return Array.isArray(value.messages) && value.messages.every(isPaginatedMessage) && isPageInfo(value.page_info) ? value.current_node !== void 0 && typeof value.current_node != "string" ? { kind: "unknown", data: value } : { kind: "paginated", data: value } : { kind: "unknown", data: value };
  }

  // src/main-world/fetch-guard.ts
  var currentConfig = null, resolveFirstConfig = null, firstConfig = new Promise((resolve) => {
    resolveFirstConfig = resolve;
  });
  function updateConfig(config) {
    currentConfig = config, resolveFirstConfig?.(), resolveFirstConfig = null;
  }
  async function configBeforeConversationRequest(timeoutMs = 500) {
    return currentConfig || (window.dispatchEvent(new Event(EVENTS.requestConfig)), currentConfig) || await Promise.race([
      firstConfig,
      new Promise((resolve) => window.setTimeout(resolve, timeoutMs))
    ]), currentConfig;
  }
  function emitNetworkStatus(status) {
    dispatchStringEvent(EVENTS.networkStatus, status);
  }
  function emitStats2(type) {
    dispatchStringEvent(EVENTS.stats, { type });
  }
  function isJsonResponse(response) {
    return (response.headers.get("content-type") ?? "").toLowerCase().includes("application/json");
  }
  function responseWithMetadata(data, options) {
    let headers = new Headers(options.original?.headers ?? options.headers);
    headers.delete("content-length"), headers.delete("content-encoding"), headers.set("content-type", "application/json; charset=utf-8");
    let replacement = new Response(JSON.stringify(data), {
      status: options.original?.status ?? options.status ?? 200,
      statusText: options.original?.statusText ?? options.statusText ?? "OK",
      headers
    }), metadata = options.original ? [["url", options.original.url], ["redirected", options.original.redirected], ["type", options.original.type]] : [["url", options.url], ["redirected", !1], ["type", "basic"]];
    for (let [key, value] of metadata)
      try {
        Object.defineProperty(replacement, key, { value });
      } catch {
      }
    return replacement;
  }
  function modifiedResponse(original, data) {
    return responseWithMetadata(data, { original, url: original.url });
  }
  function syntheticOlderResponse(classification) {
    return responseWithMetadata(syntheticEmptyOlderHistoryPage(), { url: classification.url.toString() });
  }
  function setupConfigBridge() {
    window.addEventListener(EVENTS.config, (event) => {
      let parsed = parseStringEvent(event);
      parsed !== null && updateConfig(normalizeConfig(parsed));
    }), window.dispatchEvent(new Event(EVENTS.requestConfig));
  }
  function setupNavigationBridge() {
    if (window.__CSG_NAV_PATCHED__) return;
    window.__CSG_NAV_PATCHED__ = !0;
    let notify = () => {
      window.dispatchEvent(new Event(EVENTS.navigation));
    }, pushState = history.pushState.bind(history), replaceState = history.replaceState.bind(history);
    history.pushState = (...args) => {
      pushState(...args), notify();
    }, history.replaceState = (...args) => {
      replaceState(...args), notify();
    }, window.addEventListener("popstate", notify);
  }
  async function parseConversationResponse(response) {
    if (!response.ok || !isJsonResponse(response)) return null;
    try {
      return detectConversationSchema(await response.clone().json());
    } catch {
      return null;
    }
  }
  function createGuardedFetch(nativeFetch2, resolveConfig = configBeforeConversationRequest, statusSink = emitNetworkStatus, traceSink) {
    return async (...args) => {
      let classification;
      try {
        classification = classifyRequest(args[0], args[1]);
      } catch {
        return nativeFetch2(...args);
      }
      if (classification.kind === "other")
        return nativeFetch2(...args);
      let reportStatus = (status) => {
        statusSink({ ...status, conversationId: classification.conversationId });
      }, config = await resolveConfig();
      if (!config || !config.enabled || config.temporaryFullHistory) {
        let response2 = await nativeFetch2(...args);
        return reportStatus({ mode: config ? "disabled" : "unknown", modified: !1 }), response2;
      }
      if (classification.kind === "paginated-conversation-page" && shouldPreflightSuppressOlderHistory(classification, config))
        return emitStats2("older-page-suppressed"), reportStatus({ mode: "paginated", modified: !0, olderHistoryAvailable: !0 }), syntheticOlderResponse(classification);
      if (classification.kind === "paginated-conversation-history" || classification.kind === "paginated-conversation-page") {
        let rewrite = rewritePaginatedRequest(classification, config, args), timing2 = null, response2 = await nativeFetch2(...rewrite.args), schema2 = await parseConversationResponse(response2);
        if (schema2?.kind !== "paginated")
          return reportStatus({ mode: "unknown", modified: !1 }), response2;
        adaptPaginatedConversation(schema2.data);
        let suppressOlder = shouldSuppressOlderHistory(classification, config);
        return reportStatus({
          mode: "paginated",
          modified: rewrite.modified || suppressOlder,
          olderHistoryAvailable: schema2.data.page_info.has_previous_page === !0,
          ...rewrite.requestedTurns === null ? {} : { requestedTurns: rewrite.requestedTurns },
          ...rewrite.effectiveTurns === null ? {} : { effectiveTurns: rewrite.effectiveTurns }
        }), suppressOlder ? modifiedResponse(response2, suppressOlderHistoryPage(schema2.data)) : response2;
      }
      let timing = null, response = await nativeFetch2(...args), schema = await parseConversationResponse(response);
      if (schema?.kind !== "legacy")
        return reportStatus({ mode: "unknown", modified: !1 }), response;
      let result = trimLegacyConversation(schema.data, historyTarget(config));
      return result ? (reportStatus({
        mode: "legacy",
        modified: result.modified,
        olderHistoryAvailable: result.totalRounds > result.keptRounds,
        totalRounds: result.totalRounds,
        keptRounds: result.keptRounds
      }), result.modified ? modifiedResponse(response, result.data) : response) : (reportStatus({ mode: "unknown", modified: !1 }), response);
    };
  }
  function patchFetch() {
    if (window.__CSG_FETCH_PATCHED__) return;
    window.__CSG_FETCH_PATCHED__ = !0;
    let nativeFetch2 = window.fetch.bind(window);
    window.fetch = createGuardedFetch(
      nativeFetch2,
      configBeforeConversationRequest,
      emitNetworkStatus,
      void 0
    );
  }
  function initializeFetchGuard() {
    setupConfigBridge(), setupNavigationBridge(), patchFetch();
  }
  initializeFetchGuard();
})();
