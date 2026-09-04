"use strict";
(() => {
  // src/shared/benchmark.ts
  var BENCHMARK_SESSION_KEY = "csg.benchmark.session.v1";

  // src/shared/stats.ts
  var STATS_STORAGE_KEY = "csg.stats.v1";
  function record(value) {
    return value !== null && typeof value == "object" && !Array.isArray(value) ? value : null;
  }
  function nonNegativeInteger(value, fallback = 0) {
    return typeof value == "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
  }
  function nonNegativeNumber(value) {
    return typeof value == "number" && Number.isFinite(value) && value >= 0 ? value : null;
  }
  function validTimestamp(value, fallback, now) {
    return typeof value == "number" && Number.isFinite(value) && value > 0 && value <= now + 6e4 ? value : fallback;
  }
  function sanitizedSamples(value) {
    return Array.isArray(value) ? value.map(nonNegativeNumber).filter((sample) => sample !== null).slice(-200) : [];
  }
  function percentile(values, p) {
    if (values.length === 0) return null;
    let sorted = [...values].sort((a, b) => a - b), index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p)), value = sorted[index];
    return value === void 0 ? null : Math.round(value * 10) / 10;
  }
  function withPercentiles(stats) {
    return {
      ...stats,
      switchLatencyP50: percentile(stats.switchLatencySamples, 0.5),
      switchLatencyP95: percentile(stats.switchLatencySamples, 0.95)
    };
  }
  function createDefaultStats(buildId, now = Date.now()) {
    return withPercentiles({
      statsVersion: 1,
      buildId,
      firstSeenAt: now,
      lastUpdatedAt: now,
      guardStartedAt: now,
      sessionOpenAttemptCount: 0,
      sessionOpenSuccessCount: 0,
      failedOpen429Count: 0,
      historyRequestCount: 0,
      singleFlightHitCount: 0,
      olderPageSuppressedCount: 0,
      rateLimitCooldownStartCount: 0,
      rateLimitCooldownHitCount: 0,
      spaSwitchCount: 0,
      windowFlappingDetectedCount: 0,
      switchLatencySamples: [],
      maxActiveConversationDomNodes: 0,
      maxDocumentDomNodes: 0
    });
  }
  function normalizeStats(value, buildId, now = Date.now()) {
    let source = record(value);
    if (!source) return createDefaultStats(buildId, now);
    let firstSeenAt = validTimestamp(source.firstSeenAt, now, now), guardStartedAt = validTimestamp(source.guardStartedAt, firstSeenAt, now), samples = sanitizedSamples(source.switchLatencySamples);
    return withPercentiles({
      statsVersion: 1,
      buildId,
      firstSeenAt,
      lastUpdatedAt: validTimestamp(source.lastUpdatedAt, now, now),
      guardStartedAt,
      sessionOpenAttemptCount: nonNegativeInteger(source.sessionOpenAttemptCount),
      sessionOpenSuccessCount: nonNegativeInteger(source.sessionOpenSuccessCount),
      failedOpen429Count: nonNegativeInteger(source.failedOpen429Count),
      historyRequestCount: nonNegativeInteger(source.historyRequestCount),
      singleFlightHitCount: nonNegativeInteger(source.singleFlightHitCount),
      olderPageSuppressedCount: nonNegativeInteger(source.olderPageSuppressedCount),
      rateLimitCooldownStartCount: nonNegativeInteger(source.rateLimitCooldownStartCount),
      rateLimitCooldownHitCount: nonNegativeInteger(source.rateLimitCooldownHitCount),
      spaSwitchCount: nonNegativeInteger(source.spaSwitchCount),
      windowFlappingDetectedCount: nonNegativeInteger(source.windowFlappingDetectedCount),
      switchLatencySamples: samples,
      maxActiveConversationDomNodes: nonNegativeInteger(source.maxActiveConversationDomNodes),
      maxDocumentDomNodes: nonNegativeInteger(source.maxDocumentDomNodes)
    });
  }
  function increment(value) {
    return nonNegativeInteger(value);
  }
  function applyStatsDelta(current, delta, buildId, now = Date.now()) {
    let stats = normalizeStats(current, buildId, now), samples = [
      ...stats.switchLatencySamples,
      ...sanitizedSamples(delta.switchLatencySamples)
    ].slice(-200);
    return withPercentiles({
      ...stats,
      statsVersion: 1,
      buildId,
      lastUpdatedAt: now,
      sessionOpenAttemptCount: stats.sessionOpenAttemptCount + increment(delta.sessionOpenAttemptCount),
      sessionOpenSuccessCount: stats.sessionOpenSuccessCount + increment(delta.sessionOpenSuccessCount),
      failedOpen429Count: stats.failedOpen429Count + increment(delta.failedOpen429Count),
      historyRequestCount: stats.historyRequestCount + increment(delta.historyRequestCount),
      singleFlightHitCount: stats.singleFlightHitCount + increment(delta.singleFlightHitCount),
      olderPageSuppressedCount: stats.olderPageSuppressedCount + increment(delta.olderPageSuppressedCount),
      rateLimitCooldownStartCount: stats.rateLimitCooldownStartCount + increment(delta.rateLimitCooldownStartCount),
      rateLimitCooldownHitCount: stats.rateLimitCooldownHitCount + increment(delta.rateLimitCooldownHitCount),
      spaSwitchCount: stats.spaSwitchCount + increment(delta.spaSwitchCount),
      windowFlappingDetectedCount: stats.windowFlappingDetectedCount + increment(delta.windowFlappingDetectedCount),
      switchLatencySamples: samples,
      maxActiveConversationDomNodes: Math.max(
        stats.maxActiveConversationDomNodes,
        nonNegativeInteger(delta.maxActiveConversationDomNodes)
      ),
      maxDocumentDomNodes: Math.max(stats.maxDocumentDomNodes, nonNegativeInteger(delta.maxDocumentDomNodes))
    });
  }
  function resetStats(buildId, now = Date.now()) {
    return createDefaultStats(buildId, now);
  }

  // src/background/index.ts
  var HISTORY_SESSION_KEY = "csg.history.expansion.v1", statsQueue = Promise.resolve();
  function queueStats(task) {
    let run = statsQueue.then(task, task);
    return statsQueue = run.then(() => {
    }, () => {
    }), run;
  }
  async function readStats() {
    let stored = await chrome.storage.local.get(STATS_STORAGE_KEY);
    return normalizeStats(stored[STATS_STORAGE_KEY], "28e89b0e8c66-dirty");
  }
  async function readAndRepairStats() {
    let stats = await readStats();
    return await chrome.storage.local.set({ [STATS_STORAGE_KEY]: stats }), stats;
  }
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    let request = message;
    if (request.type === "csg:stats-get")
      return queueStats(readAndRepairStats).then((state) => sendResponse({ state })).catch(() => sendResponse({ state: normalizeStats(null, "28e89b0e8c66-dirty") })), !0;
    if (request.type === "csg:stats-apply-delta") {
      let delta = "delta" in request ? request.delta : void 0;
      return !delta || typeof delta != "object" ? !1 : (queueStats(async () => {
        let current = await readStats(), state = applyStatsDelta(current, delta, "28e89b0e8c66-dirty");
        return await chrome.storage.local.set({ [STATS_STORAGE_KEY]: state }), state;
      }).then((state) => sendResponse({ ok: !0, state })).catch(() => sendResponse({ ok: !1 })), !0);
    }
    if (request.type === "csg:stats-reset")
      return queueStats(async () => {
        let state = resetStats("28e89b0e8c66-dirty");
        return await chrome.storage.local.set({ [STATS_STORAGE_KEY]: state }), state;
      }).then((state) => sendResponse({ ok: !0, state })).catch(() => sendResponse({ ok: !1 })), !0;
    if (request.type === "csg:history-session-get")
      return chrome.storage.session.get(HISTORY_SESSION_KEY).then((stored) => sendResponse({ state: stored[HISTORY_SESSION_KEY] ?? null })).catch(() => sendResponse({ state: null })), !0;
    if (request.type === "csg:history-session-set") {
      if (!("state" in request) || !request.state) return !1;
      let state = request.state;
      return typeof state.conversationId != "string" || !Number.isFinite(state.amount) ? !1 : (chrome.storage.session.set({
        [HISTORY_SESSION_KEY]: {
          conversationId: state.conversationId,
          amount: Math.max(0, Math.min(200, Math.round(state.amount)))
        }
      }).then(() => sendResponse({ ok: !0 })).catch(() => sendResponse({ ok: !1 })), !0);
    }
    return request.type === "csg:history-session-clear" ? (chrome.storage.session.remove(HISTORY_SESSION_KEY).then(() => sendResponse({ ok: !0 })).catch(() => sendResponse({ ok: !1 })), !0) : !1;
  });
})();
