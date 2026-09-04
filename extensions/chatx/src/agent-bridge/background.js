import "../features.js";
import "./protocol.js";

const Protocol = globalThis.ChatGptBridgeProtocol;
const Features = globalThis.ChatXFeatures;
const STATE_KEY = "runtimeProof";
const DEFAULT_MAX_ROUNDS = 6;
const DEFAULT_MAX_GENERATIONS = 3;
const DEFAULT_INITIAL_TASK = [
  "Developer/Auditor work-loop task.",
  "Produce a self-contained auditable Developer handoff, apply Auditor feedback, and continue until PASS.",
].join(" ");
const RUNNING_STATUSES = new Set(["DEVELOPING", "AUDITING", "ROLLOVER"]);
const TERMINAL_STATUSES = new Set(["COMPLETED", "FAILED", "STOPPED_MAX_GENERATIONS", "STOPPED_USER"]);

async function isFeatureEnabled() {
  return (await Features.get()).agentBridge;
}

async function assertFeatureEnabled() {
  if (!(await isFeatureEnabled())) throw new Error("AGENT_BRIDGE_DISABLED");
}

function emptyState() {
  return {
    version: 4,
    developerTabId: null,
    auditorTabId: null,
    status: null,
    round: 0,
    maxRounds: DEFAULT_MAX_ROUNDS,
    latestDeveloperHandoff: null,
    latestAuditorVerdict: null,
    runId: null,
    expected: null,
    error: null,
    startedAt: null,
    smoke: null,
    timeline: [],
    generation: 1,
    maxGenerations: DEFAULT_MAX_GENERATIONS,
    checkpointId: null,
    initialTask: null,
    checkpoint: null,
    rolloverStatus: null,
    agentTabsCreatedThisRun: 0,
    generationCreatedFor: {},
    updatedAt: Date.now(),
  };
}

function normalizeStoredState(stored) {
  if (!stored) return emptyState();
  if (stored.version === 4) return { ...emptyState(), ...stored };
  return {
    ...emptyState(),
    ...stored,
    version: 4,
    generation: Number.isInteger(stored.generation) && stored.generation > 0 ? stored.generation : 1,
    maxGenerations: Number.isInteger(stored.maxGenerations) && stored.maxGenerations > 0
      ? stored.maxGenerations
      : DEFAULT_MAX_GENERATIONS,
    checkpointId: stored.checkpointId ?? null,
    initialTask: stored.initialTask ?? null,
    checkpoint: stored.checkpoint ?? null,
    rolloverStatus: stored.rolloverStatus ?? null,
  };
}

async function getState() {
  const stored = (await chrome.storage.local.get(STATE_KEY))[STATE_KEY];
  return normalizeStoredState(stored);
}

async function putState(state) {
  const next = { ...state, updatedAt: Date.now() };
  await chrome.storage.local.set({ [STATE_KEY]: next });
  return next;
}

function addEvent(state, type, data = {}) {
  return {
    ...state,
    timeline: [...(state.timeline ?? []), { at: Date.now(), type, ...data }],
  };
}

function isChatGptTab(tab) {
  return typeof tab?.id === "number"
    && typeof tab.url === "string"
    && tab.url.startsWith("https://chatgpt.com/");
}

async function getTabOrNull(tabId) {
  if (typeof tabId !== "number") return null;
  try {
    return await chrome.tabs.get(tabId);
  } catch {
    return null;
  }
}

async function captureForeground(windowId) {
  const focusedWindow = await chrome.windows.getLastFocused();
  const [activeTab] = await chrome.tabs.query({ active: true, windowId });
  return {
    at: Date.now(),
    focusedWindowId: focusedWindow.id ?? null,
    focused: focusedWindow.focused === true,
    activeTabId: activeTab?.id ?? null,
  };
}

async function setActionTitle(state) {
  if (!(await isFeatureEnabled())) {
    await chrome.action.setTitle({ title: "ChatX" });
    return;
  }
  let title = "ChatX";
  if (state.developerTabId && !state.auditorTabId) {
    title = "ChatX — Agent Bridge";
  } else if (state.status === "DEVELOPING") {
    title = `G${state.generation} R${state.round}/${state.maxRounds}: Developer working`;
  } else if (state.status === "AUDITING") {
    title = `G${state.generation} R${state.round}/${state.maxRounds}: Auditor reviewing`;
  } else if (state.status === "ROLLOVER") {
    title = `Generation rollover: ${state.rolloverStatus?.phase ?? "starting"}`;
  } else if (state.status === "COMPLETED") {
    title = "ChatX — Agent Bridge completed";
  } else if (state.status === "STOPPED_MAX_GENERATIONS") {
    title = "Work loop STOPPED_MAX_GENERATIONS";
  } else if (state.status === "STOPPED_USER") {
    title = "Work loop STOPPED_USER";
  } else if (state.status === "FAILED") {
    title = `Work loop FAILED: ${state.error ?? "unknown"}`;
  } else if (state.developerTabId && state.auditorTabId) {
    title = "ChatX — Agent Bridge ready";
  }
  await chrome.action.setTitle({ title });
}

async function fail(reason, data = {}) {
  const state = await getState();
  if (TERMINAL_STATUSES.has(state.status)) {
    await setActionTitle(state);
    return state;
  }
  let after = null;
  if (state.smoke?.foregroundWindowId) {
    try {
      after = await captureForeground(state.smoke.foregroundWindowId);
    } catch {
      after = null;
    }
  }
  const failed = await putState(addEvent({
    ...state,
    status: "FAILED",
    expected: null,
    error: reason,
    smoke: state.smoke ? { ...state.smoke, after } : state.smoke,
  }, "FAILED", { reason, ...data }));
  await setActionTitle(failed);
  console.error("[work-loop] FAILED", failed);
}

async function readAgentTabs(state) {
  const [developer, auditor] = await Promise.all([
    chrome.tabs.get(state.developerTabId),
    chrome.tabs.get(state.auditorTabId),
  ]);
  if (!isChatGptTab(developer) || !isChatGptTab(auditor)) {
    throw new Error("AGENT_TAB_NOT_CHATGPT");
  }
  return { developer, auditor };
}

async function assertForegroundStable(state) {
  const smoke = state.smoke;
  if (!smoke) throw new Error("SMOKE_EVIDENCE_MISSING");
  const foreground = await captureForeground(smoke.foregroundWindowId);
  if (!foreground.focused || foreground.focusedWindowId !== smoke.initial.focusedWindowId) {
    throw new Error("FOCUSED_WINDOW_CHANGED");
  }
  if (smoke.sameWindow && foreground.activeTabId !== smoke.initial.activeTabId) {
    throw new Error("FOREGROUND_ACTIVE_TAB_CHANGED");
  }
  return foreground;
}

async function assertRuntimeSurface(state) {
  const { developer, auditor } = await readAgentTabs(state);
  const foreground = await assertForegroundStable(state);
  if (state.smoke?.sameWindow && (developer.active || auditor.active)) {
    throw new Error("AGENT_TAB_BECAME_ACTIVE");
  }
  return foreground;
}

async function assertNewRolloverTabsInactive(state) {
  const rollover = state.rolloverStatus;
  if (!rollover) throw new Error("ROLLOVER_STATE_MISSING");
  const [developer, auditor] = await Promise.all([
    getTabOrNull(rollover.newDeveloperTabId),
    getTabOrNull(rollover.newAuditorTabId),
  ]);
  if (!isChatGptTab(developer) || !isChatGptTab(auditor)) {
    throw new Error("NEW_AGENT_TAB_NOT_CHATGPT");
  }
  if (developer.active || auditor.active) throw new Error("NEW_AGENT_TAB_BECAME_ACTIVE");
  await assertForegroundStable(state);
  return { developer, auditor };
}

async function sendPrompt(tabId, requestId, prompt, completionMarker) {
  await assertFeatureEnabled();
  const current = await getState();
  if (TERMINAL_STATUSES.has(current.status)) throw new Error("RUN_TERMINATED_NO_SEND");
  if (typeof completionMarker !== "string" || !completionMarker.trim()) throw new Error("COMPLETION_MARKER_MISSING");
  await assertFeatureEnabled();
  const response = await chrome.tabs.sendMessage(tabId, {
    type: "RUN_PROMPT",
    requestId,
    prompt,
    completionMarker,
  });
  if (!response?.accepted) throw new Error("CONTENT_SCRIPT_REJECTED_PROMPT");
  return response;
}

function proofToken(state) {
  return state.runId.slice(0, 8);
}

function developerCompletionMarker(state) {
  return Protocol.developerCompletionMarker(proofToken(state), state.generation, state.round);
}

function auditorCompletionMarker(state) {
  return Protocol.auditorCompletionMarker(proofToken(state), state.generation, state.round);
}

function bootstrapCompletionMarker(state, role) {
  return Protocol.readyCompletionMarker(role, state.rolloverStatus.targetGeneration);
}

function developerPrompt(state) {
  const token = proofToken(state);
  const task = state.initialTask || DEFAULT_INITIAL_TASK;
  const inheritedFeedback = state.latestAuditorVerdict?.feedback ?? null;
  const candidate = state.generation === 1 && state.round === 1 ? 1 : 2;
  const evidence = state.generation > 1
    ? `Inherited checkpoint ${state.checkpointId}; previous Auditor feedback: ${inheritedFeedback ?? "none"}`
    : state.round === 1
      ? "Initial candidate prepared from the original task."
      : `Applied previous Auditor feedback: ${inheritedFeedback ?? "none"}`;
  const pending = state.generation === 1 && state.round >= state.maxRounds
    ? "Re-audit this state; if it still fails, preserve it through generation rollover."
    : "Independent Auditor review required.";

  return [
    `WORK_LOOP_DEVELOPER ${token} GENERATION ${state.generation} ROUND ${state.round}`,
    `Original task: ${task}`,
    inheritedFeedback ? `Latest Auditor feedback: ${inheritedFeedback}` : "Latest Auditor feedback: none",
    "Prepare a self-contained handoff that states current state, evidence, and the pending issue.",
    "Reply with exactly these three lines:",
    `DEVELOPER_HANDOFF ${token} ROUND ${state.round}`,
    `GENERATION: ${state.generation} | STATE: CANDIDATE: ${candidate} | EVIDENCE: ${evidence} | PENDING: ${pending}`,
    developerCompletionMarker(state),
  ].join("\n");
}

function auditorPrompt(state) {
  const token = proofToken(state);
  const forceRolloverFailure = state.generation === 1
    && state.maxGenerations > 1
    && state.round >= state.maxRounds;

  const completionMarker = auditorCompletionMarker(state);
  const verdictRule = forceRolloverFailure
    ? [
        "This generation has reached maxRounds. For the rollover validation, reply with exactly:",
        `AUDIT_FAIL ${token} ROUND ${state.round}`,
        "FEEDBACK: Carry CANDIDATE: 2 and this unresolved audit state into the next generation",
        completionMarker,
      ]
    : state.latestDeveloperHandoff?.includes("CANDIDATE: 1")
      ? [
          "Reply with exactly:",
          `AUDIT_FAIL ${token} ROUND ${state.round}`,
          "FEEDBACK: Change CANDIDATE to 2",
          completionMarker,
        ]
      : [
          "Reply with exactly:",
          `AUDIT_PASS ${token} ROUND ${state.round}`,
          completionMarker,
        ];

  return [
    `WORK_LOOP_AUDITOR ${token} GENERATION ${state.generation} ROUND ${state.round}`,
    `Original task: ${state.initialTask || DEFAULT_INITIAL_TASK}`,
    "Audit the self-contained Developer handoff below.",
    state.latestDeveloperHandoff ?? "",
    ...verdictRule,
  ].join("\n");
}

function parseDeveloperHandoff(state, text) {
  return Protocol.parseDeveloperHandoffText({
    text,
    token: proofToken(state),
    generation: state.generation,
    round: state.round,
  });
}

function parseAuditorVerdict(state, text) {
  return Protocol.parseAuditorVerdictText({
    text,
    token: proofToken(state),
    generation: state.generation,
    round: state.round,
  });
}

function bootstrapPrompt(state, role) {
  const rollover = state.rolloverStatus;
  const checkpoint = state.checkpoint;
  if (!rollover || !checkpoint || !state.checkpointId) throw new Error("CHECKPOINT_MISSING");
  const roleName = role === "developer" ? "DEVELOPER" : "AUDITOR";
  const instructions = role === "developer"
    ? [
        "继续修复 Auditor 指出的当前问题。",
        "完成下一次可审计阶段后，继续使用现有 HANDOFF 协议。",
        "你的整个回复必须精确等于下一行 ASCII 文本；不得省略 DEVELOPER、generation，不得添加标点、解释或其它文字：",
        bootstrapCompletionMarker(state, "developer"),
      ]
    : [
        "接替上一代 Auditor。",
        "等待新 Developer 的下一次 HANDOFF 后继续独立审计。",
        "你的整个回复必须精确等于下一行 ASCII 文本；不得省略 AUDITOR、generation，不得添加标点、解释或其它文字：",
        bootstrapCompletionMarker(state, "auditor"),
      ];

  return [
    `ROLE = ${roleName}`,
    `GENERATION = ${rollover.targetGeneration}`,
    `CHECKPOINT_ID = ${state.checkpointId}`,
    "",
    "原始任务：",
    checkpoint.initialTask ?? "",
    "",
    "上一代最新 Developer handoff：",
    checkpoint.latestDeveloperHandoff ?? "",
    "",
    "上一代最新 Auditor verdict：",
    checkpoint.latestAuditorVerdict?.text ?? "",
    "",
    "要求：",
    ...instructions,
  ].join("\n");
}

function bootstrapRequestId(state, role) {
  return `${state.runId}:g${state.rolloverStatus.targetGeneration}:bootstrap:${role}`;
}

async function dispatchDeveloper(state, { rolloverContinuation = false } = {}) {
  const requestId = `${state.runId}:g${state.generation}:developer:${state.round}`;
  const prompt = developerPrompt(state);
  const completionMarker = developerCompletionMarker(state);
  const nextRolloverStatus = rolloverContinuation && state.rolloverStatus
    ? { ...state.rolloverStatus, phase: "SWITCHED_WAITING_DEVELOPER_SEND", continuationRequestId: requestId }
    : state.rolloverStatus;
  const next = await putState(addEvent({
    ...state,
    status: "DEVELOPING",
    expected: { role: "developer", requestId, round: state.round, generation: state.generation, completionMarker },
    rolloverStatus: nextRolloverStatus,
  }, "DISPATCH", {
    role: "developer",
    generation: state.generation,
    round: state.round,
    tabId: state.developerTabId,
    requestId,
    prompt,
    completionMarker,
  }));
  await setActionTitle(next);
  try {
    await sendPrompt(next.developerTabId, requestId, prompt, completionMarker);
    return true;
  } catch (error) {
    await fail(`DEVELOPER_DISPATCH_FAILED: ${error.message}`);
    return false;
  }
}

async function dispatchAuditor(state) {
  const requestId = `${state.runId}:g${state.generation}:auditor:${state.round}`;
  const prompt = auditorPrompt(state);
  const completionMarker = auditorCompletionMarker(state);
  const next = await putState(addEvent({
    ...state,
    status: "AUDITING",
    expected: { role: "auditor", requestId, round: state.round, generation: state.generation, completionMarker },
  }, "DISPATCH", {
    role: "auditor",
    generation: state.generation,
    round: state.round,
    tabId: state.auditorTabId,
    requestId,
    prompt,
    completionMarker,
  }));
  await setActionTitle(next);
  try {
    await sendPrompt(next.auditorTabId, requestId, prompt, completionMarker);
    return true;
  } catch (error) {
    await fail(`AUDITOR_DISPATCH_FAILED: ${error.message}`);
    return false;
  }
}

async function startWorkLoop(triggerTab, { userInitiated = false } = {}) {
  await assertFeatureEnabled();
  if (!userInitiated) return;
  let state = await getState();
  if (!state.developerTabId || !state.auditorTabId) return;
  if (triggerTab.id === state.developerTabId || triggerTab.id === state.auditorTabId) return;

  let developer;
  let auditor;
  try {
    ({ developer, auditor } = await readAgentTabs(state));
  } catch (error) {
    await fail(error.message);
    return;
  }

  const initial = await captureForeground(triggerTab.windowId);
  if (!initial.focused || initial.focusedWindowId !== triggerTab.windowId || initial.activeTabId !== triggerTab.id) {
    await fail("TRIGGER_TAB_NOT_FOREGROUND");
    return;
  }

  const sameWindow = developer.windowId === auditor.windowId && auditor.windowId === triggerTab.windowId;
  if (sameWindow && (developer.active || auditor.active)) {
    await fail("AGENT_TAB_ACTIVE_AT_START");
    return;
  }

  const runId = crypto.randomUUID();
  const maxRounds = Number.isInteger(state.maxRounds) && state.maxRounds > 0 ? state.maxRounds : DEFAULT_MAX_ROUNDS;
  const maxGenerations = Number.isInteger(state.maxGenerations) && state.maxGenerations > 0
    ? state.maxGenerations
    : DEFAULT_MAX_GENERATIONS;
  const initialTask = typeof state.initialTask === "string" && state.initialTask.trim()
    ? state.initialTask.trim()
    : DEFAULT_INITIAL_TASK;

  state = await putState(addEvent({
    ...state,
    status: "DEVELOPING",
    round: 1,
    maxRounds,
    generation: 1,
    maxGenerations,
    checkpointId: null,
    checkpoint: null,
    rolloverStatus: null,
    agentTabsCreatedThisRun: 0,
    generationCreatedFor: {},
    initialTask,
    latestDeveloperHandoff: null,
    latestAuditorVerdict: null,
    runId,
    expected: null,
    error: null,
    startedAt: Date.now(),
    timeline: [],
    smoke: {
      developerTabId: developer.id,
      developerWindowId: developer.windowId,
      auditorTabId: auditor.id,
      auditorWindowId: auditor.windowId,
      foregroundWindowId: triggerTab.windowId,
      sameWindow,
      initial,
      after: null,
      focusViolation: false,
      activationViolation: false,
    },
  }, "START", {
    runId,
    generation: 1,
    round: 1,
    maxRounds,
    maxGenerations,
    initialTask,
    developerTabId: developer.id,
    developerWindowId: developer.windowId,
    auditorTabId: auditor.id,
    auditorWindowId: auditor.windowId,
    foregroundWindowId: triggerTab.windowId,
    foregroundTabId: triggerTab.id,
    sameWindow,
  }));

  await dispatchDeveloper(state);
}

async function stopMaxGenerations(state) {
  let after;
  try {
    after = await assertRuntimeSurface(state);
  } catch (error) {
    await fail(error.message);
    return;
  }
  const stopped = await putState(addEvent({
    ...state,
    status: "STOPPED_MAX_GENERATIONS",
    expected: null,
    error: null,
    smoke: { ...state.smoke, after },
  }, "STOPPED_MAX_GENERATIONS", {
    runId: state.runId,
    generation: state.generation,
    maxGenerations: state.maxGenerations,
    round: state.round,
    focusedWindowId: after.focusedWindowId,
    activeTabId: after.activeTabId,
  }));
  await setActionTitle(stopped);
}

async function beginRollover(state) {
  await assertFeatureEnabled();
  const targetGeneration = state.generation + 1;
  const alreadyBudgetedForTarget = Number(state.generationCreatedFor?.[targetGeneration] ?? 0);
  const existingTargetRollover = state.rolloverStatus?.targetGeneration === targetGeneration
    && (state.rolloverStatus.newDeveloperTabId != null
      || state.rolloverStatus.newAuditorTabId != null
      || state.rolloverStatus.phase !== "COMPLETE");
  if (state.status !== "AUDITING"
      || state.latestAuditorVerdict?.verdict !== "FAIL"
      || state.round !== state.maxRounds
      || state.generation >= state.maxGenerations
      || existingTargetRollover
      || alreadyBudgetedForTarget !== 0) {
    await fail("ROLLOVER_TRIGGER_INVALID");
    return;
  }

  try {
    await assertRuntimeSurface(state);
  } catch (error) {
    await fail(error.message);
    return;
  }

  const checkpointId = crypto.randomUUID();
  const checkpoint = {
    initialTask: state.initialTask,
    latestDeveloperHandoff: state.latestDeveloperHandoff,
    latestAuditorVerdict: state.latestAuditorVerdict,
    generation: state.generation,
    round: state.round,
  };
  const rolloverStatus = {
    phase: "CHECKPOINTED",
    checkpointId,
    targetGeneration: state.generation + 1,
    oldDeveloperTabId: state.developerTabId,
    oldAuditorTabId: state.auditorTabId,
    newDeveloperTabId: null,
    newAuditorTabId: null,
    developerReady: false,
    auditorReady: false,
    developerBootstrapRequestId: null,
    auditorBootstrapRequestId: null,
    continuationRequestId: null,
    oldTabsClosed: false,
  };

  const next = await putState(addEvent({
    ...state,
    status: "ROLLOVER",
    expected: null,
    checkpointId,
    checkpoint,
    rolloverStatus,
  }, "CHECKPOINT", {
    checkpointId,
    generation: state.generation,
    round: state.round,
    targetGeneration: state.generation + 1,
    checkpoint,
  }));
  await setActionTitle(next);
  await resumeRollover({ allowCreate: true });
}

function generationCreateCount(state, generation) {
  return Number(state.generationCreatedFor?.[generation] ?? 0);
}

async function claimRolloverTabCreation(state, role) {
  const rollover = state.rolloverStatus;
  const targetGeneration = rollover?.targetGeneration;
  const expectedPhase = role === "developer" ? "CHECKPOINTED" : "DEVELOPER_CREATED";
  const claimedPhase = role === "developer" ? "DEVELOPER_CREATE_CLAIMED" : "AUDITOR_CREATE_CLAIMED";
  const tabField = role === "developer" ? "newDeveloperTabId" : "newAuditorTabId";

  if (state.status !== "ROLLOVER"
      || !rollover
      || rollover.phase !== expectedPhase
      || rollover.checkpointId !== state.checkpointId
      || targetGeneration !== state.generation + 1
      || state.latestAuditorVerdict?.verdict !== "FAIL"
      || state.round !== state.maxRounds
      || state.generation >= state.maxGenerations
      || rollover[tabField] != null) {
    throw new Error(`ROLLOVER_${role.toUpperCase()}_CREATE_NOT_ALLOWED`);
  }

  const generationCount = generationCreateCount(state, targetGeneration);
  const expectedGenerationCount = role === "developer" ? 0 : 1;
  const totalCreated = Number(state.agentTabsCreatedThisRun ?? 0);
  const maxAutoCreatedThisRun = Math.max(0, 2 * (state.maxGenerations - 1));
  if (generationCount !== expectedGenerationCount || generationCount >= 2) {
    throw new Error("ROLLOVER_GENERATION_CREATE_BUDGET_STATE_INVALID");
  }
  if (totalCreated >= maxAutoCreatedThisRun) throw new Error("ROLLOVER_RUN_CREATE_BUDGET_EXHAUSTED");

  return await putState(addEvent({
    ...state,
    agentTabsCreatedThisRun: Number(state.agentTabsCreatedThisRun ?? 0) + 1,
    generationCreatedFor: {
      ...(state.generationCreatedFor ?? {}),
      [targetGeneration]: generationCount + 1,
    },
    rolloverStatus: { ...rollover, phase: claimedPhase },
  }, "ROLLOVER_TAB_CREATE_CLAIMED", {
    role,
    targetGeneration,
    agentTabsCreatedThisRun: Number(state.agentTabsCreatedThisRun ?? 0) + 1,
    generationCreateCount: generationCount + 1,
  }));
}

async function createRolloverTab(state, role) {
  await assertFeatureEnabled();
  let claimed = await claimRolloverTabCreation(state, role);
  const claimPhase = role === "developer" ? "DEVELOPER_CREATE_CLAIMED" : "AUDITOR_CREATE_CLAIMED";
  const nextPhase = role === "developer" ? "DEVELOPER_CREATED" : "WAITING_DEVELOPER_CONTENT";
  const tabField = role === "developer" ? "newDeveloperTabId" : "newAuditorTabId";
  const oldTabId = role === "developer"
    ? claimed.rolloverStatus.oldDeveloperTabId
    : claimed.rolloverStatus.oldAuditorTabId;
  const oldTab = await getTabOrNull(oldTabId);
  if (!oldTab) throw new Error(`OLD_${role.toUpperCase()}_TAB_MISSING`);

  const current = await getState();
  if (current.runId !== claimed.runId
      || current.status !== "ROLLOVER"
      || current.rolloverStatus?.phase !== claimPhase) {
    throw new Error(`ROLLOVER_${role.toUpperCase()}_CREATE_ABORTED_STATE_CHANGED`);
  }

  await assertFeatureEnabled();
  const created = await chrome.tabs.create({
    windowId: oldTab.windowId,
    url: "https://chatgpt.com/",
    active: false,
  });

  if (typeof created?.id === "number") {
    const latest = await getState();
    claimed = await putState(addEvent({
      ...latest,
      rolloverStatus: {
        ...latest.rolloverStatus,
        phase: latest.status === "ROLLOVER" ? nextPhase : latest.rolloverStatus?.phase,
        [tabField]: created.id,
      },
    }, "ROLLOVER_TAB_CREATED", {
      role,
      generation: claimed.rolloverStatus.targetGeneration,
      tabId: created.id,
      windowId: created.windowId,
      active: created.active,
    }));
  }

  if (typeof created?.id !== "number" || created.active || created.windowId !== oldTab.windowId) {
    throw new Error(`NEW_${role.toUpperCase()}_TAB_CREATE_INVALID`);
  }
  if (claimed.status !== "ROLLOVER") {
    throw new Error(`ROLLOVER_${role.toUpperCase()}_CREATE_FINISHED_AFTER_TERMINAL`);
  }
  await assertForegroundStable(claimed);
  return claimed;
}

async function dispatchBootstrap(state, role) {
  const rollover = state.rolloverStatus;
  const tabId = role === "developer" ? rollover.newDeveloperTabId : rollover.newAuditorTabId;
  const requestId = bootstrapRequestId(state, role);
  const prompt = bootstrapPrompt(state, role);
  const completionMarker = bootstrapCompletionMarker(state, role);
  const requestField = role === "developer" ? "developerBootstrapRequestId" : "auditorBootstrapRequestId";
  const dispatchPhase = role === "developer" ? "DEVELOPER_BOOTSTRAP_DISPATCHING" : "AUDITOR_BOOTSTRAP_DISPATCHING";
  const waitPhase = role === "developer" ? "WAITING_DEVELOPER_READY" : "WAITING_AUDITOR_READY";

  let next = await putState(addEvent({
    ...state,
    rolloverStatus: {
      ...rollover,
      phase: dispatchPhase,
      [requestField]: requestId,
    },
  }, "BOOTSTRAP_DISPATCH", {
    role,
    generation: rollover.targetGeneration,
    tabId,
    requestId,
    checkpointId: state.checkpointId,
    prompt,
    completionMarker,
  }));
  await setActionTitle(next);

  try {
    await sendPrompt(tabId, requestId, prompt, completionMarker);
  } catch (error) {
    await fail(`ROLLOVER_${role.toUpperCase()}_BOOTSTRAP_DISPATCH_FAILED: ${error.message}`);
    return;
  }

  const latest = await getState();
  if (latest.status !== "ROLLOVER" || latest.rolloverStatus?.[requestField] !== requestId) return;
  const alreadyReady = role === "developer"
    ? latest.rolloverStatus.developerReady
    : latest.rolloverStatus.auditorReady;
  if (alreadyReady) return;
  next = await putState({
    ...latest,
    rolloverStatus: { ...latest.rolloverStatus, phase: waitPhase },
  });
  await setActionTitle(next);
}

async function performAtomicSwitch(state) {
  if (state.status !== "ROLLOVER" || state.rolloverStatus?.phase !== "READY_BOTH") return;
  const rollover = state.rolloverStatus;
  if (!rollover.developerReady || !rollover.auditorReady) return;

  let developer;
  let auditor;
  try {
    ({ developer, auditor } = await assertNewRolloverTabsInactive(state));
  } catch (error) {
    await fail(error.message);
    return;
  }

  const targetGeneration = rollover.targetGeneration;
  if (targetGeneration !== state.generation + 1) {
    await fail("ROLLOVER_TARGET_GENERATION_MISMATCH");
    return;
  }

  const switched = await putState(addEvent({
    ...state,
    developerTabId: developer.id,
    auditorTabId: auditor.id,
    generation: targetGeneration,
    round: 1,
    status: "DEVELOPING",
    expected: null,
    error: null,
    smoke: {
      ...state.smoke,
      developerTabId: developer.id,
      developerWindowId: developer.windowId,
      auditorTabId: auditor.id,
      auditorWindowId: auditor.windowId,
      sameWindow: developer.windowId === auditor.windowId && auditor.windowId === state.smoke.foregroundWindowId,
    },
    rolloverStatus: {
      ...rollover,
      phase: "SWITCHED_WAITING_DEVELOPER_SEND",
      switchedAt: Date.now(),
    },
  }, "GENERATION_SWITCH", {
    checkpointId: state.checkpointId,
    fromGeneration: state.generation,
    toGeneration: targetGeneration,
    oldDeveloperTabId: rollover.oldDeveloperTabId,
    oldAuditorTabId: rollover.oldAuditorTabId,
    newDeveloperTabId: developer.id,
    newAuditorTabId: auditor.id,
    round: 1,
  }));
  await setActionTitle(switched);
  await dispatchDeveloper(switched, { rolloverContinuation: true });
}

async function closeOldAgentTabsAfterSend() {
  let state = await getState();
  const rollover = state.rolloverStatus;
  if (!rollover || rollover.phase !== "SWITCHED_WAITING_DEVELOPER_SEND") return;

  state = await putState(addEvent({
    ...state,
    rolloverStatus: { ...rollover, phase: "CLOSING_OLD_TABS" },
  }, "OLD_TABS_CLOSE_START", {
    oldDeveloperTabId: rollover.oldDeveloperTabId,
    oldAuditorTabId: rollover.oldAuditorTabId,
    continuationRequestId: rollover.continuationRequestId,
  }));

  for (const tabId of [rollover.oldDeveloperTabId, rollover.oldAuditorTabId]) {
    if (await getTabOrNull(tabId)) {
      try {
        await chrome.tabs.remove(tabId);
      } catch (error) {
        await fail(`OLD_AGENT_TAB_CLOSE_FAILED: ${tabId}: ${error.message}`);
        return;
      }
    }
  }

  state = await getState();
  if (state.status === "FAILED") return;
  const completedRollover = await putState(addEvent({
    ...state,
    rolloverStatus: {
      ...state.rolloverStatus,
      phase: "COMPLETE",
      oldTabsClosed: true,
      completedAt: Date.now(),
    },
  }, "ROLLOVER_COMPLETE", {
    generation: state.generation,
    checkpointId: state.checkpointId,
    developerTabId: state.developerTabId,
    auditorTabId: state.auditorTabId,
  }));
  await setActionTitle(completedRollover);
}

function hasSendEvidence(state, requestId) {
  return typeof requestId === "string"
    && (state.timeline ?? []).some((event) => event.type === "SEND" && event.requestId === requestId);
}

async function requireRecordedRolloverTab(state, role) {
  const rollover = state.rolloverStatus;
  const tabId = role === "developer" ? rollover?.newDeveloperTabId : rollover?.newAuditorTabId;
  if (typeof tabId !== "number") throw new Error(`ROLLOVER_NEW_${role.toUpperCase()}_TAB_ID_MISSING`);
  const tab = await getTabOrNull(tabId);
  if (!tab) throw new Error(`ROLLOVER_NEW_${role.toUpperCase()}_TAB_MISSING`);
  if (!isChatGptTab(tab)) throw new Error(`ROLLOVER_NEW_${role.toUpperCase()}_TAB_NOT_CHATGPT`);
  if (tab.active) throw new Error(`ROLLOVER_NEW_${role.toUpperCase()}_TAB_BECAME_ACTIVE`);
  return tab;
}

async function resumeRollover({ allowCreate = false } = {}) {
  if (!(await isFeatureEnabled())) return;
  let state = await getState();
  const rollover = state.rolloverStatus;
  if (!rollover || TERMINAL_STATUSES.has(state.status)) return;

  if (state.status === "ROLLOVER") {
    try {
      await assertRuntimeSurface(state);
    } catch (error) {
      await fail(error.message);
      return;
    }

    if (rollover.phase === "CHECKPOINTED") {
      if (!allowCreate) return;
      try {
        state = await createRolloverTab(state, "developer");
      } catch (error) {
        await fail(`ROLLOVER_DEVELOPER_CREATE_FAILED: ${error.message}`);
        return;
      }
      await resumeRollover({ allowCreate: true });
      return;
    }

    if (rollover.phase === "DEVELOPER_CREATE_CLAIMED" || rollover.phase === "AUDITOR_CREATE_CLAIMED") {
      return;
    }

    if (rollover.phase === "DEVELOPER_CREATED") {
      if (!allowCreate) return;
      try {
        await requireRecordedRolloverTab(state, "developer");
        state = await createRolloverTab(state, "auditor");
      } catch (error) {
        await fail(`ROLLOVER_AUDITOR_CREATE_FAILED: ${error.message}`);
        return;
      }
      await setActionTitle(state);
      await resumeRollover();
      return;
    }

    if (rollover.phase === "WAITING_DEVELOPER_CONTENT") {
      try {
        const developer = await requireRecordedRolloverTab(state, "developer");
        await requireRecordedRolloverTab(state, "auditor");
        if (developer.status === "complete") await dispatchBootstrap(state, "developer");
      } catch (error) {
        await fail(error.message);
      }
      return;
    }

    if (rollover.phase === "DEVELOPER_BOOTSTRAP_DISPATCHING") {
      return;
    }

    if (rollover.phase === "WAITING_DEVELOPER_READY") {
      try {
        await requireRecordedRolloverTab(state, "developer");
        await requireRecordedRolloverTab(state, "auditor");
      } catch (error) {
        await fail(error.message);
      }
      return;
    }

    if (rollover.phase === "WAITING_AUDITOR_CONTENT") {
      try {
        await requireRecordedRolloverTab(state, "developer");
        const auditor = await requireRecordedRolloverTab(state, "auditor");
        if (auditor.status === "complete") await dispatchBootstrap(state, "auditor");
      } catch (error) {
        await fail(error.message);
      }
      return;
    }

    if (rollover.phase === "AUDITOR_BOOTSTRAP_DISPATCHING") {
      return;
    }

    if (rollover.phase === "WAITING_AUDITOR_READY") {
      try {
        await requireRecordedRolloverTab(state, "developer");
        await requireRecordedRolloverTab(state, "auditor");
      } catch (error) {
        await fail(error.message);
      }
      return;
    }

    if (rollover.phase === "READY_BOTH") {
      await performAtomicSwitch(state);
    }
    return;
  }

  if (state.status === "DEVELOPING" && rollover.phase === "SWITCHED_WAITING_DEVELOPER_SEND") {
    if (!state.expected) {
      await dispatchDeveloper(state, { rolloverContinuation: true });
    }
    return;
  }

  if (state.status === "DEVELOPING" && rollover.phase === "CLOSING_OLD_TABS") {
    await closeOldAgentTabsAfterSend();
  }
}

async function restoreRolloverSafely(state) {
  if (!(await isFeatureEnabled())) return;
  const rollover = state.rolloverStatus;
  if (!rollover || TERMINAL_STATUSES.has(state.status)) return;

  if (state.status === "ROLLOVER"
      && (rollover.phase === "DEVELOPER_CREATE_CLAIMED" || rollover.phase === "AUDITOR_CREATE_CLAIMED")) {
    await fail(`ROLLOVER_CREATE_INTERRUPTED_NO_RETRY: ${rollover.phase}`);
    return;
  }

  if (state.status === "ROLLOVER" && rollover.phase === "DEVELOPER_BOOTSTRAP_DISPATCHING") {
    if (hasSendEvidence(state, rollover.developerBootstrapRequestId)) {
      const next = await putState({
        ...state,
        rolloverStatus: { ...rollover, phase: "WAITING_DEVELOPER_READY" },
      });
      await resumeRollover();
    } else {
      await fail("ROLLOVER_DEVELOPER_BOOTSTRAP_DISPATCH_INTERRUPTED_NO_RETRY");
    }
    return;
  }

  if (state.status === "ROLLOVER" && rollover.phase === "AUDITOR_BOOTSTRAP_DISPATCHING") {
    if (hasSendEvidence(state, rollover.auditorBootstrapRequestId)) {
      const next = await putState({
        ...state,
        rolloverStatus: { ...rollover, phase: "WAITING_AUDITOR_READY" },
      });
      await resumeRollover();
    } else {
      await fail("ROLLOVER_AUDITOR_BOOTSTRAP_DISPATCH_INTERRUPTED_NO_RETRY");
    }
    return;
  }

  if (state.status === "DEVELOPING" && rollover.phase === "SWITCHED_WAITING_DEVELOPER_SEND" && state.expected) {
    if (hasSendEvidence(state, rollover.continuationRequestId)) {
      await closeOldAgentTabsAfterSend();
    } else {
      await fail("ROLLOVER_CONTINUATION_DISPATCH_INTERRUPTED_NO_RETRY");
    }
    return;
  }

  await resumeRollover({ allowCreate: true });
}

function completionEvidenceValid(message) {
  return message.finalAssistantCount > message.baselineAssistantCount
    && message.generationInactive === true
    && message.quietSettleMs >= 1000;
}

function rawTurnEvidence(message, sender) {
  return {
    requestId: message.requestId ?? null,
    senderTabId: sender.tab?.id ?? null,
    baselineAssistantCount: message.baselineAssistantCount ?? null,
    finalAssistantCount: message.finalAssistantCount ?? null,
    generationInactive: message.generationInactive ?? null,
    quietSettleMs: message.quietSettleMs ?? null,
    completionMarker: message.completionMarker ?? null,
  };
}

function validateBootstrapIdentity(state, role, message, sender) {
  const rollover = state.rolloverStatus;
  if (!rollover || state.status !== "ROLLOVER") return "ROLLOVER_STATE_INVALID";
  const expectedRequestId = role === "developer"
    ? rollover.developerBootstrapRequestId
    : rollover.auditorBootstrapRequestId;
  const expectedTabId = role === "developer"
    ? rollover.newDeveloperTabId
    : rollover.newAuditorTabId;
  if (rollover.targetGeneration !== state.generation + 1) return "TARGET_GENERATION_MISMATCH";
  if (!state.checkpointId || rollover.checkpointId !== state.checkpointId) return "CHECKPOINT_ID_MISMATCH";
  if (expectedRequestId !== message.requestId || expectedRequestId !== bootstrapRequestId(state, role)) {
    return "REQUEST_ID_MISMATCH";
  }
  if (message.completionMarker !== bootstrapCompletionMarker(state, role)) return "COMPLETION_MARKER_MISMATCH";
  if (sender.tab?.id !== expectedTabId) return "SENDER_TAB_MISMATCH";
  return null;
}

function bootstrapRoleForRequest(state, requestId) {
  const rollover = state.rolloverStatus;
  if (!rollover) return null;
  if (rollover.developerBootstrapRequestId === requestId) return "developer";
  if (rollover.auditorBootstrapRequestId === requestId) return "auditor";
  return null;
}

async function onBootstrapTurnSent(message, sender, state, role) {
  const rollover = state.rolloverStatus;
  const expectedTabId = role === "developer" ? rollover.newDeveloperTabId : rollover.newAuditorTabId;
  if (sender.tab?.id !== expectedTabId) return;
  await putState(addEvent(state, "SEND", {
    role: `bootstrap-${role}`,
    generation: rollover.targetGeneration,
    tabId: expectedTabId,
    requestId: message.requestId,
    baselineAssistantCount: message.baselineAssistantCount,
  }));
}

async function onBootstrapTurnComplete(message, sender, state, role) {
  const rollover = state.rolloverStatus;
  const expectedTabId = role === "developer" ? rollover.newDeveloperTabId : rollover.newAuditorTabId;
  const identityError = validateBootstrapIdentity(state, role, message, sender);
  if (identityError) {
    await fail(`ROLLOVER_${role.toUpperCase()}_READY_IDENTITY_INVALID: ${identityError}`, {
      role,
      targetGeneration: rollover?.targetGeneration ?? null,
      checkpointId: state.checkpointId ?? null,
      expectedRequestId: role === "developer" ? rollover?.developerBootstrapRequestId ?? null : rollover?.auditorBootstrapRequestId ?? null,
      ...rawTurnEvidence(message, sender),
    });
    return;
  }
  if (!completionEvidenceValid(message)) {
    await fail(`ROLLOVER_${role.toUpperCase()}_READY_EVIDENCE_INVALID`, {
      role,
      targetGeneration: rollover.targetGeneration,
      checkpointId: state.checkpointId,
      ...rawTurnEvidence(message, sender),
    });
    return;
  }

  const ready = Protocol.parseReadyText(message.text, role, rollover.targetGeneration);
  if (!ready) {
    await fail(`ROLLOVER_${role.toUpperCase()}_READY_MISMATCH`);
    return;
  }

  let next = await putState(addEvent(state, "RESPONSE_COMPLETE", {
    role: `bootstrap-${role}`,
    generation: rollover.targetGeneration,
    tabId: expectedTabId,
    requestId: message.requestId,
    baselineAssistantCount: message.baselineAssistantCount,
    finalAssistantCount: message.finalAssistantCount,
    quietSettleMs: message.quietSettleMs,
    generationInactive: message.generationInactive,
    text: message.text,
  }));

  try {
    await assertNewRolloverTabsInactive(next);
  } catch (error) {
    await fail(error.message);
    return;
  }

  if (role === "developer") {
    next = await putState(addEvent({
      ...next,
      rolloverStatus: {
        ...next.rolloverStatus,
        phase: "WAITING_AUDITOR_CONTENT",
        developerReady: true,
      },
    }, "READY", {
      role: "developer",
      generation: rollover.targetGeneration,
      tabId: expectedTabId,
      checkpointId: next.checkpointId,
    }));
    await setActionTitle(next);
    await resumeRollover();
    return;
  }

  next = await putState(addEvent({
    ...next,
    rolloverStatus: {
      ...next.rolloverStatus,
      phase: "READY_BOTH",
      auditorReady: true,
    },
  }, "READY", {
    role: "auditor",
    generation: rollover.targetGeneration,
    tabId: expectedTabId,
    checkpointId: next.checkpointId,
  }));
  await setActionTitle(next);
  await performAtomicSwitch(next);
}

async function onTurnSent(message, sender) {
  if (!(await isFeatureEnabled())) return;
  const senderTabId = sender.tab?.id;
  if (typeof senderTabId !== "number") return;
  let state = await getState();

  const bootstrapRole = bootstrapRoleForRequest(state, message.requestId);
  if (state.status === "ROLLOVER" && bootstrapRole) {
    await onBootstrapTurnSent(message, sender, state, bootstrapRole);
    return;
  }

  if (!RUNNING_STATUSES.has(state.status) || state.expected?.requestId !== message.requestId) return;
  const expectedTabId = state.expected.role === "auditor" ? state.auditorTabId : state.developerTabId;
  if (senderTabId !== expectedTabId) return;
  state = await putState(addEvent(state, "SEND", {
    role: state.expected.role,
    generation: state.generation,
    round: state.round,
    tabId: senderTabId,
    requestId: message.requestId,
    baselineAssistantCount: message.baselineAssistantCount,
  }));

  if (state.expected.role === "developer"
      && state.rolloverStatus?.phase === "SWITCHED_WAITING_DEVELOPER_SEND"
      && state.rolloverStatus.continuationRequestId === message.requestId) {
    await closeOldAgentTabsAfterSend();
  }
}

async function onTurnComplete(message, sender) {
  if (!(await isFeatureEnabled())) return;
  const senderTabId = sender.tab?.id;
  if (typeof senderTabId !== "number") return;

  let state = await getState();
  const bootstrapRole = bootstrapRoleForRequest(state, message.requestId);
  if (state.status === "ROLLOVER" && bootstrapRole) {
    await onBootstrapTurnComplete(message, sender, state, bootstrapRole);
    return;
  }

  const expected = state.expected;
  if (!RUNNING_STATUSES.has(state.status) || !expected || expected.requestId !== message.requestId) return;
  if (expected.round !== state.round || expected.generation !== state.generation) return;

  const expectedTabId = expected.role === "auditor" ? state.auditorTabId : state.developerTabId;
  if (senderTabId !== expectedTabId) {
    await fail(`${expected.role.toUpperCase()}_REPLY_FROM_WRONG_TAB`);
    return;
  }
  if (message.completionMarker !== expected.completionMarker) {
    await fail(`${expected.role.toUpperCase()}_COMPLETION_MARKER_MISMATCH`, {
      expectedCompletionMarker: expected.completionMarker ?? null,
      ...rawTurnEvidence(message, sender),
    });
    return;
  }
  if (!completionEvidenceValid(message)) {
    await fail(`${expected.role.toUpperCase()}_COMPLETION_EVIDENCE_INVALID`, {
      completionEvidence: rawTurnEvidence(message, sender),
    });
    return;
  }

  state = await putState(addEvent(state, "RESPONSE_COMPLETE", {
    role: expected.role,
    generation: state.generation,
    round: state.round,
    tabId: senderTabId,
    requestId: message.requestId,
    baselineAssistantCount: message.baselineAssistantCount,
    finalAssistantCount: message.finalAssistantCount,
    quietSettleMs: message.quietSettleMs,
    generationInactive: message.generationInactive,
    text: message.text,
  }));

  try {
    await assertRuntimeSurface(state);
  } catch (error) {
    await fail(error.message);
    return;
  }

  if (expected.role === "developer") {
    const handoff = parseDeveloperHandoff(state, message.text);
    if (!handoff) {
      await fail("DEVELOPER_HANDOFF_MISMATCH");
      return;
    }
    state = await putState(addEvent({
      ...state,
      latestDeveloperHandoff: handoff,
      expected: null,
    }, "HANDOFF", {
      generation: state.generation,
      round: state.round,
      from: "developer",
      fromTabId: state.developerTabId,
      to: "auditor",
      toTabId: state.auditorTabId,
      text: handoff,
    }));
    await dispatchAuditor(state);
    return;
  }

  const verdict = parseAuditorVerdict(state, message.text);
  if (!verdict) {
    await fail("AUDITOR_VERDICT_MISMATCH");
    return;
  }

  state = await putState(addEvent({
    ...state,
    latestAuditorVerdict: verdict,
    expected: null,
  }, "VERDICT", {
    generation: state.generation,
    round: state.round,
    verdict: verdict.verdict,
    feedback: verdict.feedback,
    text: verdict.text,
  }));

  if (verdict.verdict === "PASS") {
    let after;
    try {
      after = await assertRuntimeSurface(state);
    } catch (error) {
      await fail(error.message);
      return;
    }
    const completed = await putState(addEvent({
      ...state,
      status: "COMPLETED",
      expected: null,
      error: null,
      smoke: { ...state.smoke, after },
    }, "COMPLETED", {
      runId: state.runId,
      generation: state.generation,
      round: state.round,
      focusedWindowId: after.focusedWindowId,
      activeTabId: after.activeTabId,
    }));
    await setActionTitle(completed);
    return;
  }

  if (state.round > state.maxRounds) {
    await fail("ROUND_BUDGET_EXCEEDED");
    return;
  }

  if (state.round === state.maxRounds) {
    if (state.generation < state.maxGenerations) {
      await beginRollover(state);
    } else {
      await stopMaxGenerations(state);
    }
    return;
  }

  state = await putState(addEvent({
    ...state,
    status: "DEVELOPING",
    round: state.round + 1,
    expected: null,
  }, "ROUTE", {
    generation: state.generation,
    from: "auditor",
    fromTabId: state.auditorTabId,
    to: "developer",
    toTabId: state.developerTabId,
    completedRound: state.round,
    nextRound: state.round + 1,
    feedback: verdict.feedback,
  }));
  await dispatchDeveloper(state);
}

async function getPublicUiState() {
  const state = await getState();
  const [developer, auditor] = await Promise.all([
    getTabOrNull(state.developerTabId),
    getTabOrNull(state.auditorTabId),
  ]);
  return {
    developerAssigned: isChatGptTab(developer),
    auditorAssigned: isChatGptTab(auditor),
    status: state.status ?? "IDLE",
    generation: state.generation ?? 1,
    round: state.round ?? 0,
    error: state.status === "FAILED" ? state.error ?? "unknown" : null,
    task: state.initialTask ?? "",
    maxRounds: Number.isInteger(state.maxRounds) && state.maxRounds > 0 ? state.maxRounds : DEFAULT_MAX_ROUNDS,
    maxGenerations: Number.isInteger(state.maxGenerations) && state.maxGenerations > 0
      ? state.maxGenerations
      : DEFAULT_MAX_GENERATIONS,
    running: RUNNING_STATUSES.has(state.status),
  };
}

async function assignAgent(role, tabId) {
  await assertFeatureEnabled();
  if (role !== "developer" && role !== "auditor") throw new Error("INVALID_AGENT_ROLE");
  const state = await getState();
  if (RUNNING_STATUSES.has(state.status)) throw new Error("STOP_CURRENT_RUN_BEFORE_REASSIGN");
  const tab = await getTabOrNull(tabId);
  if (!isChatGptTab(tab)) throw new Error("CURRENT_TAB_NOT_CHATGPT");
  const otherTabId = role === "developer" ? state.auditorTabId : state.developerTabId;
  if (tab.id === otherTabId) throw new Error("DEVELOPER_AND_AUDITOR_MUST_DIFFER");
  const field = role === "developer" ? "developerTabId" : "auditorTabId";
  const next = await putState({ ...state, [field]: tab.id });
  await setActionTitle(next);
  return getPublicUiState();
}

async function startFromUi({ task, maxRounds, maxGenerations, triggerTabId }) {
  await assertFeatureEnabled();
  const cleanTask = typeof task === "string" ? task.trim() : "";
  if (!cleanTask) throw new Error("TASK_REQUIRED");
  if (!Number.isInteger(maxRounds) || maxRounds < 1) throw new Error("MAX_ROUNDS_INVALID");
  if (!Number.isInteger(maxGenerations) || maxGenerations < 1) throw new Error("MAX_GENERATIONS_INVALID");

  let state = await getState();
  if (RUNNING_STATUSES.has(state.status)) throw new Error("RUN_ALREADY_ACTIVE");
  if (!state.developerTabId || !state.auditorTabId) throw new Error("AGENTS_MISSING");
  const triggerTab = await getTabOrNull(triggerTabId);
  if (!triggerTab) throw new Error("TRIGGER_TAB_MISSING");
  if (triggerTab.id === state.developerTabId || triggerTab.id === state.auditorTabId) {
    throw new Error("START_FROM_NON_AGENT_TAB");
  }

  const { developer, auditor } = await readAgentTabs(state);
  const initial = await captureForeground(triggerTab.windowId);
  if (!initial.focused || initial.focusedWindowId !== triggerTab.windowId || initial.activeTabId !== triggerTab.id) {
    throw new Error("TRIGGER_TAB_NOT_FOREGROUND");
  }
  const sameWindow = developer.windowId === auditor.windowId && auditor.windowId === triggerTab.windowId;
  if (sameWindow && (developer.active || auditor.active)) throw new Error("AGENT_TAB_ACTIVE_AT_START");

  state = await putState({
    ...state,
    initialTask: cleanTask,
    maxRounds,
    maxGenerations,
  });
  await startWorkLoop(triggerTab, { userInitiated: true });
  return getPublicUiState();
}

async function stopUser() {
  const state = await getState();
  if (!RUNNING_STATUSES.has(state.status)) return getPublicUiState();
  let after = null;
  if (state.smoke?.foregroundWindowId) {
    try {
      after = await captureForeground(state.smoke.foregroundWindowId);
    } catch {
      after = null;
    }
  }
  const stopped = await putState(addEvent({
    ...state,
    status: "STOPPED_USER",
    expected: null,
    error: null,
    smoke: state.smoke ? { ...state.smoke, after } : state.smoke,
  }, "STOPPED_USER", {
    generation: state.generation,
    round: state.round,
  }));
  await setActionTitle(stopped);
  return getPublicUiState();
}

async function onTurnFailed(message, sender) {
  if (!(await isFeatureEnabled())) return;
  const state = await getState();
  const bootstrapRole = bootstrapRoleForRequest(state, message.requestId);
  if (state.status === "ROLLOVER" && bootstrapRole) {
    const expectedTabId = bootstrapRole === "developer"
      ? state.rolloverStatus.newDeveloperTabId
      : state.rolloverStatus.newAuditorTabId;
    if (sender.tab?.id !== expectedTabId) return;
    await fail(`ROLLOVER_${bootstrapRole.toUpperCase()}_BOOTSTRAP_FAILED: ${message.error}`);
    return;
  }

  if (!RUNNING_STATUSES.has(state.status) || state.expected?.requestId !== message.requestId) return;
  const senderTabId = sender.tab?.id;
  const expectedTabId = state.expected.role === "auditor" ? state.auditorTabId : state.developerTabId;
  if (senderTabId !== expectedTabId) return;
  await fail(`${state.expected.role.toUpperCase()}_TURN_FAILED: ${message.error}`);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (typeof message?.type === "string" && message.type.startsWith("BRIDGE_")) {
    const isPopup = sender.id === chrome.runtime.id && !sender.tab && typeof sender.url === "string" && sender.url.endsWith("/popup.html");
    const contentTabId = sender.id === chrome.runtime.id && isChatGptTab(sender.tab) ? sender.tab.id : null;
    if (!isPopup && !Number.isInteger(contentTabId)) {
      sendResponse({ ok: false, error: "UI_ONLY_ACTION" });
      return false;
    }
    void (async () => {
      try {
        let state;
        if (message.type === "BRIDGE_UI_STATE") {
          state = await getPublicUiState();
        } else if (message.type === "BRIDGE_ASSIGN") {
          state = await assignAgent(message.role, message.tabId ?? contentTabId);
        } else if (message.type === "BRIDGE_START") {
          state = await startFromUi({ ...message, triggerTabId: message.triggerTabId ?? contentTabId });
        } else if (message.type === "BRIDGE_STOP") {
          state = await stopUser();
        } else {
          throw new Error("UNKNOWN_BRIDGE_ACTION");
        }
        sendResponse({ ok: true, state });
      } catch (error) {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    })();
    return true;
  }

  if (message?.type === "TURN_SENT") {
    void onTurnSent(message, sender);
  } else if (message?.type === "TURN_COMPLETE") {
    void onTurnComplete(message, sender);
  } else if (message?.type === "TURN_FAILED") {
    void onTurnFailed(message, sender);
  } else if (message?.type === "CONTENT_READY") {
    void (async () => {
    if (!(await isFeatureEnabled())) return;
      const state = await getState();
      const tabId = sender.tab?.id;
      if (state.status !== "ROLLOVER" || typeof tabId !== "number") return;
      if (tabId !== state.rolloverStatus?.newDeveloperTabId && tabId !== state.rolloverStatus?.newAuditorTabId) return;
      await resumeRollover();
    })();
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== "complete") return;
  void (async () => {
    if (!(await isFeatureEnabled())) return;
    const state = await getState();
    if (state.status !== "ROLLOVER") return;
    if (tabId !== state.rolloverStatus?.newDeveloperTabId && tabId !== state.rolloverStatus?.newAuditorTabId) return;
    await resumeRollover();
  })();
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  void (async () => {
    if (!(await isFeatureEnabled())) return;
    const state = await getState();
    if (!RUNNING_STATUSES.has(state.status) || !state.smoke) return;
    const withEvent = await putState(addEvent(state, "WINDOW_FOCUS", { windowId }));
    if (windowId === chrome.windows.WINDOW_ID_NONE || windowId === state.smoke.initial.focusedWindowId) return;
    await putState({
      ...withEvent,
      smoke: { ...withEvent.smoke, focusViolation: true },
    });
    await fail(`FOCUSED_WINDOW_CHANGED: ${windowId}`);
  })();
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  void (async () => {
    if (!(await isFeatureEnabled())) return;
    const state = await getState();
    if (!RUNNING_STATUSES.has(state.status) || !state.smoke) return;
    let next = await putState(addEvent(state, "TAB_ACTIVATED", {
      tabId: activeInfo.tabId,
      windowId: activeInfo.windowId,
    }));
    if (!state.smoke.sameWindow || activeInfo.windowId !== state.smoke.foregroundWindowId) return;
    if (activeInfo.tabId === state.smoke.initial.activeTabId) return;
    next = await putState({
      ...next,
      smoke: { ...next.smoke, activationViolation: true },
    });
    await fail(`FOREGROUND_ACTIVE_TAB_CHANGED: ${activeInfo.tabId}`);
  })();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void (async () => {
    if (!(await isFeatureEnabled())) return;
    const state = await getState();
    const rollover = state.rolloverStatus;

    if (state.status === "ROLLOVER"
        && (tabId === rollover?.newDeveloperTabId || tabId === rollover?.newAuditorTabId)) {
      await fail(`ROLLOVER_NEW_AGENT_TAB_CLOSED: ${tabId}`);
      return;
    }

    if (tabId !== state.developerTabId && tabId !== state.auditorTabId) return;
    if (RUNNING_STATUSES.has(state.status)) {
      await fail(`AGENT_TAB_CLOSED: ${tabId}`);
      return;
    }
    if (TERMINAL_STATUSES.has(state.status)) {
      await setActionTitle(state);
      return;
    }

    const next = await putState({
      ...state,
      developerTabId: tabId === state.developerTabId ? null : state.developerTabId,
      auditorTabId: tabId === state.auditorTabId ? null : state.auditorTabId,
      status: null,
      round: 0,
      latestDeveloperHandoff: null,
      latestAuditorVerdict: null,
      expected: null,
      error: null,
    });
    await setActionTitle(next);
  })();
});

void (async () => {
  const state = await getState();
  await setActionTitle(state);
  if (RUNNING_STATUSES.has(state.status)) {
    console.log("[work-loop] restored from storage", {
      status: state.status,
      generation: state.generation,
      round: state.round,
      maxRounds: state.maxRounds,
      maxGenerations: state.maxGenerations,
      expected: state.expected,
      rolloverPhase: state.rolloverStatus?.phase ?? null,
    });
  }
  await restoreRolloverSafely(state);
})();


globalThis.ChatXAgentBridge = Object.freeze({ stopForFeatureDisable: stopUser });

void isFeatureEnabled().then((enabled) => {
  if (!enabled) void stopUser();
});
