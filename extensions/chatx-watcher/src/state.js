export const RunState = Object.freeze({
  IDLE: "IDLE",
  RUNNING: "RUNNING",
  FINISH_CANDIDATE: "FINISH_CANDIDATE",
  DONE: "DONE",
  ACKNOWLEDGED: "ACKNOWLEDGED",
});

export const MIN_STABLE_MS = 3000;
export const CONFIRMATION_MS = 1500;
export const MAX_RUNS = 80;
export const RUN_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export function createEmptyWatcherState() {
  return {
    version: 1,
    runs: [],
    currentByConversation: {},
  };
}

export function normalizeWatcherState(value) {
  if (!value || typeof value !== "object") return createEmptyWatcherState();
  const runs = Array.isArray(value.runs) ? value.runs.filter(Boolean) : [];
  const currentByConversation =
    value.currentByConversation && typeof value.currentByConversation === "object"
      ? { ...value.currentByConversation }
      : {};
  return { version: 1, runs, currentByConversation };
}

export function getRun(state, runId) {
  return state.runs.find((run) => run.runId === runId) ?? null;
}

export function getCurrentRun(state, conversationId) {
  const runId = state.currentByConversation[conversationId];
  return runId ? getRun(state, runId) : null;
}

function mergeMetadata(run, metadata) {
  if (metadata.tabId !== undefined) run.tabId = metadata.tabId;
  if (metadata.windowId !== undefined) run.windowId = metadata.windowId;
  if (metadata.url) run.url = metadata.url;
  if (metadata.title) run.title = metadata.title;
}

export function startRun(state, metadata, now, runId) {
  const current = getCurrentRun(state, metadata.conversationId);
  if (
    current &&
    (current.state === RunState.RUNNING || current.state === RunState.FINISH_CANDIDATE)
  ) {
    mergeMetadata(current, metadata);
    return { run: current, started: false };
  }

  const run = {
    conversationId: metadata.conversationId,
    runId,
    state: RunState.RUNNING,
    startedAt: now,
    lastMutationAt: metadata.lastMutationAt ?? now,
    completedAt: null,
    acknowledgedAt: null,
    notifiedAt: null,
    tabId: metadata.tabId ?? null,
    windowId: metadata.windowId ?? null,
    url: metadata.url ?? "",
    title: metadata.title ?? "",
  };

  state.runs.push(run);
  state.currentByConversation[metadata.conversationId] = run.runId;
  return { run, started: true };
}

export function recordActivity(state, runId, metadata, now) {
  const run = getRun(state, runId);
  if (!run) return null;
  if (run.state !== RunState.RUNNING && run.state !== RunState.FINISH_CANDIDATE) return run;

  run.state = RunState.RUNNING;
  run.lastMutationAt = metadata.lastMutationAt ?? now;
  mergeMetadata(run, metadata);
  return run;
}

export function canEnterFinishCandidate(signals) {
  return Boolean(
    signals.sawAssistantMutation &&
      signals.stableForMs >= MIN_STABLE_MS &&
      !signals.generationActive &&
      !signals.generationBusy &&
      signals.composerIdle
  );
}

export function markFinishCandidate(state, runId, metadata, now) {
  const run = getRun(state, runId);
  if (!run || run.state !== RunState.RUNNING) return { run, accepted: false };
  if (!canEnterFinishCandidate(metadata.signals)) return { run, accepted: false };

  run.state = RunState.FINISH_CANDIDATE;
  run.lastMutationAt = metadata.lastMutationAt ?? run.lastMutationAt;
  run.candidateAt = now;
  mergeMetadata(run, metadata);
  return { run, accepted: true };
}

export function canConfirmFinish(run, signals, now) {
  if (!run || run.state !== RunState.FINISH_CANDIDATE) return false;
  if (!canEnterFinishCandidate(signals)) return false;
  const candidateAt = run.candidateAt ?? now;
  return now - candidateAt >= CONFIRMATION_MS;
}

export function confirmDone(state, runId, metadata, now) {
  const run = getRun(state, runId);
  if (!canConfirmFinish(run, metadata.signals, now)) {
    return { run, completed: false, shouldNotify: false };
  }

  run.state = RunState.DONE;
  run.completedAt = now;
  run.lastMutationAt = metadata.lastMutationAt ?? run.lastMutationAt;
  mergeMetadata(run, metadata);

  // Reserve notification delivery before the side effect. This deliberately
  // favors "never notify the same run twice" over automatic retry after a
  // platform notification failure.
  const shouldNotify = run.notifiedAt == null;
  if (shouldNotify) run.notifiedAt = now;

  return { run, completed: true, shouldNotify };
}

export function acknowledgeRun(state, conversationId, now) {
  const run = getCurrentRun(state, conversationId);
  if (!run || run.state !== RunState.DONE) return { run, acknowledged: false };
  run.state = RunState.ACKNOWLEDGED;
  run.acknowledgedAt = now;
  return { run, acknowledged: true };
}

export function cleanupWatcherState(
  state,
  now,
  { maxRuns = MAX_RUNS, ttlMs = RUN_TTL_MS } = {}
) {
  const cutoff = now - ttlMs;
  const eligible = state.runs.filter((run) => {
    if (run.state === RunState.RUNNING || run.state === RunState.FINISH_CANDIDATE) {
      return true;
    }
    const anchor = run.acknowledgedAt ?? run.completedAt ?? run.lastMutationAt ?? run.startedAt ?? 0;
    return anchor >= cutoff;
  });

  eligible.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
  const allowed = new Set(eligible.slice(0, maxRuns).map((run) => run.runId));

  // Never evict an in-flight run merely because many conversations are open.
  for (const run of eligible) {
    if (run.state === RunState.RUNNING || run.state === RunState.FINISH_CANDIDATE) {
      allowed.add(run.runId);
    }
  }

  state.runs = state.runs.filter((run) => allowed.has(run.runId));

  const validIds = new Set(state.runs.map((run) => run.runId));
  for (const [conversationId, runId] of Object.entries(state.currentByConversation)) {
    if (!validIds.has(runId)) delete state.currentByConversation[conversationId];
  }
  return state;
}

export function reduceIgnoredUiEvent(state) {
  // Sidebar dots/spinners are intentionally not part of the state machine.
  return state;
}
