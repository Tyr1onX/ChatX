(() => {
  if (globalThis.ChatXUiPrefs) return;

  const KEY = "uiPrefs";
  const DEFAULTS = Object.freeze({
    language: "zh-CN",
    bubblePosition: null,
  });
  const LANGUAGES = new Set(["zh-CN", "en"]);
  const TEXT = Object.freeze({
    "zh-CN": Object.freeze({
      watcher: "任务监听",
      watcherDescription: "后台任务完成提醒",
      sessionGuard: "会话保护",
      sessionGuardDescription: "长会话性能保护",
      agentBridge: "Agent Bridge / 智能协作",
      agentBridgeDescription: "开发者 / 审计者自动协作",
      developer: "开发者",
      auditor: "审计者",
      task: "任务",
      maxRounds: "最大轮数",
      maxGenerations: "最大代数",
      assignDeveloper: "指定开发者",
      assignAuditor: "指定审计者",
      start: "开始",
      stop: "停止",
      status: "状态",
      generation: "第几代",
      round: "第几轮",
      error: "错误",
      assigned: "已指定",
      missing: "未指定",
      openChatX: "打开 ChatX",
      closeChatX: "关闭 ChatX",
      "status.IDLE": "空闲",
      "status.DEVELOPING": "开发中",
      "status.AUDITING": "审计中",
      "status.COMPLETED": "已完成",
      "status.FAILED": "失败",
      "status.STOPPED_USER": "已停止",
      "status.STOPPED_MAX_GENERATIONS": "已达到最大代数",
      "status.ROLLOVER": "切换会话中",
      "error.CURRENT_TAB_NOT_CHATGPT": "请在 ChatGPT 标签页中指定此角色。",
      "error.DEVELOPER_AND_AUDITOR_MUST_DIFFER": "开发者和审计者必须使用不同的 ChatGPT 标签页。",
      "error.STOP_CURRENT_RUN_BEFORE_REASSIGN": "更换 Agent 标签页前请先停止当前任务。",
      "error.TASK_REQUIRED": "请填写任务。",
      "error.AGENTS_MISSING": "请先指定开发者和审计者。",
      "error.START_FROM_NON_AGENT_TAB": "请从非 Agent 标签页开始任务。",
      "error.TRIGGER_TAB_NOT_FOREGROUND": "请从当前前台的非 Agent 标签页开始任务。",
      "error.AGENT_TAB_ACTIVE_AT_START": "开始前开发者和审计者标签页都必须处于非活动状态。",
      "error.RUN_ALREADY_ACTIVE": "已有任务正在运行。",
      "error.AGENT_BRIDGE_DISABLED": "Agent Bridge 已关闭。",
    }),
    en: Object.freeze({
      watcher: "Watcher",
      watcherDescription: "Background task completion alerts",
      sessionGuard: "Session Guard",
      sessionGuardDescription: "Long-session performance protection",
      agentBridge: "Agent Bridge",
      agentBridgeDescription: "Developer / Auditor collaboration",
      developer: "Developer",
      auditor: "Auditor",
      task: "Task",
      maxRounds: "Max rounds",
      maxGenerations: "Max generations",
      assignDeveloper: "Assign Developer",
      assignAuditor: "Assign Auditor",
      start: "Start",
      stop: "Stop",
      status: "Status",
      generation: "Generation",
      round: "Round",
      error: "Error",
      assigned: "assigned",
      missing: "missing",
      openChatX: "Open ChatX",
      closeChatX: "Close ChatX",
      "status.IDLE": "Idle",
      "status.DEVELOPING": "Developing",
      "status.AUDITING": "Auditing",
      "status.COMPLETED": "Completed",
      "status.FAILED": "Failed",
      "status.STOPPED_USER": "Stopped",
      "status.STOPPED_MAX_GENERATIONS": "Max generations reached",
      "status.ROLLOVER": "Switching conversation",
      "error.CURRENT_TAB_NOT_CHATGPT": "Open a ChatGPT tab to assign this role.",
      "error.DEVELOPER_AND_AUDITOR_MUST_DIFFER": "Developer and Auditor must use different ChatGPT tabs.",
      "error.STOP_CURRENT_RUN_BEFORE_REASSIGN": "Stop the current run before changing Agent tabs.",
      "error.TASK_REQUIRED": "Task is required.",
      "error.AGENTS_MISSING": "Assign both Developer and Auditor first.",
      "error.START_FROM_NON_AGENT_TAB": "Start from a non-Agent tab.",
      "error.TRIGGER_TAB_NOT_FOREGROUND": "Start from the current foreground non-Agent tab.",
      "error.AGENT_TAB_ACTIVE_AT_START": "Developer and Auditor must both be inactive before Start.",
      "error.RUN_ALREADY_ACTIVE": "A run is already active.",
      "error.AGENT_BRIDGE_DISABLED": "Agent Bridge is off.",
    }),
  });
  let writeQueue = Promise.resolve();

  function normalizePosition(value) {
    if (!value || typeof value !== "object") return null;
    const x = Number(value.x);
    const y = Number(value.y);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  }

  function clampBubblePosition(position, viewportWidth, viewportHeight, bubbleSize = 44) {
    const maxX = Math.max(0, Number(viewportWidth) - bubbleSize);
    const maxY = Math.max(0, Number(viewportHeight) - bubbleSize);
    return {
      x: Math.min(Math.max(Number(position?.x) || 0, 0), maxX),
      y: Math.min(Math.max(Number(position?.y) || 0, 0), maxY),
    };
  }

  function normalize(value) {
    const source = value && typeof value === "object" ? value : {};
    return {
      language: LANGUAGES.has(source.language) ? source.language : DEFAULTS.language,
      bubblePosition: normalizePosition(source.bubblePosition),
    };
  }

  async function get() {
    const stored = await chrome.storage.local.get(KEY);
    return normalize(stored[KEY]);
  }

  function set(patch) {
    writeQueue = writeQueue.catch(() => undefined).then(async () => {
      const current = await get();
      const next = normalize({ ...current, ...patch });
      await chrome.storage.local.set({ [KEY]: next });
      return next;
    });
    return writeQueue;
  }

  function setLanguage(language) {
    return set({ language });
  }

  function setBubblePosition(bubblePosition) {
    return set({ bubblePosition });
  }

  function t(language, key) {
    const normalizedLanguage = LANGUAGES.has(language) ? language : DEFAULTS.language;
    return TEXT[normalizedLanguage][key] ?? TEXT[DEFAULTS.language][key] ?? key;
  }

  function statusLabel(language, status) {
    return t(language, `status.${status}`) === `status.${status}` ? status : t(language, `status.${status}`);
  }

  function errorLabel(language, error) {
    const code = error instanceof Error ? error.message : String(error);
    const key = `error.${code}`;
    const translated = t(language, key);
    return translated === key ? code : translated;
  }

  globalThis.ChatXUiPrefs = Object.freeze({
    KEY,
    DEFAULTS,
    normalize,
    clampBubblePosition,
    get,
    setLanguage,
    setBubblePosition,
    t,
    statusLabel,
    errorLabel,
  });
})();
