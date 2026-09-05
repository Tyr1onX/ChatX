import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionRoot = path.join(repoRoot, "extensions", "chatx");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(extensionRoot, relativePath), "utf8");
}

function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

type Conversation = { conversationId: string; title: string; href: string };

type HarnessOptions = {
  bindings?: { developer: unknown; auditor: unknown };
  focused?: boolean;
  activeTabId?: number;
  mutateOnCreate?: (index: number, env: { setActiveTabId(id: number): void }) => void;
  createdActive?: (index: number) => boolean;
  createdUrl?: (index: number, requestedUrl: string) => string;
  contentReadyDuringCreate?: (index: number) => boolean;
  removeFailsFor?: number;
};

function createHarness(options: HarnessOptions = {}) {
  const developer: Conversation = {
    conversationId: "developer-chat",
    title: "Executor",
    href: "https://chatgpt.com/c/developer-chat",
  };
  const auditor: Conversation = {
    conversationId: "auditor-chat",
    title: "Auditor",
    href: "https://chatgpt.com/g/project/c/auditor-chat",
  };
  let state: any = {
    version: 4,
    status: null,
    bindings: options.bindings ?? { developer, auditor },
  };
  let activeTabId = options.activeTabId ?? 1;
  const tabs = new Map<number, any>([
    [1, { id: 1, windowId: 10, url: "https://chatgpt.com/c/trigger", active: activeTabId === 1, status: "complete" }],
    [2, { id: 2, windowId: 10, url: "https://chatgpt.com/c/other", active: activeTabId === 2, status: "complete" }],
  ]);
  const createCalls: any[] = [];
  const sends: any[] = [];
  const removeCalls: number[] = [];
  const storageWrites: any[] = [];
  const operations: string[] = [];
  const listeners: Record<string, Function[]> = {};
  let nextTabId = 100;
  let uuid = 0;
  let featureEnabled = true;

  const chrome = {
    storage: {
      local: {
        async get(key: string) {
          return { [key]: state };
        },
        async set(value: Record<string, unknown>) {
          state = value.runtimeProof;
          storageWrites.push(plain(state));
          operations.push(`write:${state.initialMaterialization?.phase ?? "none"}:${state.status ?? "IDLE"}`);
        },
      },
    },
    tabs: {
      async get(tabId: number) {
        const tab = tabs.get(tabId);
        if (!tab) throw new Error("TAB_NOT_FOUND");
        return { ...tab };
      },
      async query({ windowId }: { active: boolean; windowId: number }) {
        const tab = tabs.get(activeTabId);
        return tab && tab.windowId === windowId ? [{ ...tab, active: true }] : [];
      },
      async create(createOptions: { windowId: number; url: string; active: boolean }) {
        const index = createCalls.length;
        operations.push(`create:${createOptions.url}`);
        createCalls.push({ ...createOptions, phaseAtCreate: state.initialMaterialization?.phase, createCountAtCreate: state.initialMaterialization?.createCount });
        options.mutateOnCreate?.(index, { setActiveTabId(id) { activeTabId = id; } });
        const id = nextTabId++;
        const active = options.createdActive?.(index) ?? false;
        const url = options.createdUrl?.(index, createOptions.url) ?? createOptions.url;
        const tab = { id, windowId: createOptions.windowId, url, pendingUrl: createOptions.url, active, status: "loading" };
        tabs.set(id, tab);
        if (active) activeTabId = id;
        if (options.contentReadyDuringCreate?.(index)) {
          for (const listener of listeners.message ?? []) {
            listener({ type: "CONTENT_READY" }, { tab: { ...tab } }, () => {});
          }
          await Promise.resolve();
          await Promise.resolve();
        }
        return { ...tab };
      },
      async sendMessage(tabId: number, message: unknown) {
        sends.push({ tabId, message: plain(message) });
        return { accepted: true };
      },
      async remove(tabId: number) {
        operations.push(`remove:${tabId}`);
        removeCalls.push(tabId);
        if (options.removeFailsFor === tabId) throw new Error("REMOVE_FAILED");
        tabs.delete(tabId);
      },
      onUpdated: { addListener(fn: Function) { (listeners.updated ??= []).push(fn); } },
      onActivated: { addListener(fn: Function) { (listeners.activated ??= []).push(fn); } },
      onRemoved: { addListener(fn: Function) { (listeners.removed ??= []).push(fn); } },
    },
    windows: {
      WINDOW_ID_NONE: -1,
      async getLastFocused() {
        return { id: 10, focused: options.focused ?? true };
      },
      onFocusChanged: { addListener(fn: Function) { (listeners.focus ??= []).push(fn); } },
    },
    action: { async setTitle() {} },
    runtime: {
      id: "test-extension",
      onMessage: { addListener(fn: Function) { (listeners.message ??= []).push(fn); } },
    },
  };

  const context: Record<string, any> = {
    URL,
    console: { log() {}, error() {} },
    chrome,
    crypto: { randomUUID: () => `run-${++uuid}-00000000` },
    ChatXFeatures: { async get() { return { agentBridge: featureEnabled }; } },
    ChatGptBridgeProtocol: {
      developerCompletionMarker: () => "DEVELOPER_DONE",
      auditorCompletionMarker: () => "AUDITOR_DONE",
      readyCompletionMarker: () => "READY",
      parseDeveloperHandoffText: () => null,
      parseAuditorVerdictText: () => null,
      parseReadyText: () => null,
    },
  };
  context.globalThis = context;
  vm.runInNewContext(read("src/agent-bridge/bindings.js"), context);

  let background = read("src/agent-bridge/background.js").replace(/\r\n/g, "\n");
  background = background.replace(/^import .*;\n/gm, "");
  const startupStart = background.lastIndexOf("void (async () => {\n  const state = await getState();");
  const exportStart = background.indexOf("globalThis.ChatXAgentBridge =", startupStart);
  expect(startupStart).toBeGreaterThan(0);
  expect(exportStart).toBeGreaterThan(startupStart);
  background = background.slice(0, startupStart) + background.slice(exportStart);
  const disableStart = background.indexOf("void isFeatureEnabled().then");
  if (disableStart >= 0) background = background.slice(0, disableStart);
  background += `\nglobalThis.__materializationTest = {\n    startFromUi,\n    stopUser,\n    assignAgent,\n    onTurnSent,\n    markInitialContentReady,\n    resumeInitialMaterialization,\n    restoreInitialMaterializationSafely,\n    getState,\n  };\n`;
  vm.runInNewContext(background, context);

  const api = context.__materializationTest as {
    startFromUi(input: { task: string; maxRounds: number; maxGenerations: number; triggerTabId: number }): Promise<unknown>;
    stopUser(): Promise<unknown>;
    assignAgent(role: "developer" | "auditor", tabId: number): Promise<unknown>;
    onTurnSent(message: { requestId: string; baselineAssistantCount?: number }, sender: { tab: { id: number } }): Promise<void>;
    markInitialContentReady(state: unknown, tabId: number): Promise<boolean>;
    resumeInitialMaterialization(options?: { allowCreate?: boolean }): Promise<void>;
    restoreInitialMaterializationSafely(state: unknown): Promise<void>;
    getState(): Promise<any>;
  };

  return {
    api,
    developer,
    auditor,
    createCalls,
    sends,
    removeCalls,
    storageWrites,
    operations,
    tabs,
    get state() { return state; },
    set state(value: any) { state = value; },
    setActiveTabId(id: number) { activeTabId = id; },
    setFeatureEnabled(enabled: boolean) { featureEnabled = enabled; },
  };
}

async function readyAndAcknowledgeDeveloperSend(h: ReturnType<typeof createHarness>) {
  const materialization = h.state.initialMaterialization;
  const developerTabId = materialization.developerTabId;
  const auditorTabId = materialization.auditorTabId;
  await h.api.markInitialContentReady(await h.api.getState(), developerTabId);
  await h.api.markInitialContentReady(await h.api.getState(), auditorTabId);
  const requestId = h.state.expected?.requestId;
  expect(typeof requestId).toBe("string");
  await h.api.onTurnSent({ requestId, baselineAssistantCount: 0 }, { tab: { id: h.state.developerTabId } });
  return { developerTabId, auditorTabId, requestId };
}

function seedTerminalInitialMaterialization(
  h: ReturnType<typeof createHarness>,
  status: "FAILED" | "STOPPED_USER",
  { developerTabId = 98, auditorTabId = null as number | null, phase = "DEVELOPER_CREATED" } = {},
) {
  if (developerTabId != null) {
    h.tabs.set(developerTabId, {
      id: developerTabId,
      windowId: 10,
      url: h.developer.href,
      pendingUrl: h.developer.href,
      active: false,
      status: "complete",
    });
  }
  if (auditorTabId != null) {
    h.tabs.set(auditorTabId, {
      id: auditorTabId,
      windowId: 10,
      url: h.auditor.href,
      pendingUrl: h.auditor.href,
      active: false,
      status: "complete",
    });
  }
  h.state = {
    version: 4,
    status,
    error: status === "FAILED" ? "OLD_FAILURE" : null,
    developerTabId: null,
    auditorTabId: null,
    agentTabOwnership: { developer: null, auditor: null },
    bindings: { developer: h.developer, auditor: h.auditor },
    initialMaterialization: {
      phase,
      triggerTabId: 1,
      windowId: 10,
      initialForeground: { focusedWindowId: 10, focused: true, activeTabId: 1 },
      developerBinding: h.developer,
      auditorBinding: h.auditor,
      developerTabId,
      auditorTabId,
      developerReady: developerTabId != null,
      auditorReady: auditorTabId != null,
      createCount: Number(developerTabId != null) + Number(auditorTabId != null),
    },
  };
}

describe("ChatX Agent Bridge initial conversation materialization", () => {
  it("claims before each create, opens exactly the two binding hrefs inactive, and waits for content readiness", async () => {
    const h = createHarness();

    const uiState = await h.api.startFromUi({ task: "Do the task", maxRounds: 3, maxGenerations: 2, triggerTabId: 1 }) as any;

    expect(h.createCalls).toHaveLength(2);
    expect(h.createCalls.map(({ windowId, url, active }) => ({ windowId, url, active }))).toEqual([
      { windowId: 10, url: h.developer.href, active: false },
      { windowId: 10, url: h.auditor.href, active: false },
    ]);
    expect(h.createCalls[0]).toMatchObject({ phaseAtCreate: "DEVELOPER_CREATE_CLAIMED", createCountAtCreate: 1 });
    expect(h.createCalls[1]).toMatchObject({ phaseAtCreate: "AUDITOR_CREATE_CLAIMED", createCountAtCreate: 2 });
    expect(h.state.initialMaterialization).toMatchObject({
      phase: "WAITING_READY",
      createCount: 2,
      developerTabId: 100,
      auditorTabId: 101,
      developerReady: false,
      auditorReady: false,
    });
    expect(h.state.developerTabId).toBeNull();
    expect(h.state.auditorTabId).toBeNull();
    expect(h.sends).toHaveLength(0);
    expect(uiState.running).toBe(true);
  });

  it("does not create for missing, malformed, duplicate bindings, or a non-foreground trigger", async () => {
    const missing = createHarness({ bindings: { developer: null, auditor: null } });
    await expect(missing.api.startFromUi({ task: "x", maxRounds: 1, maxGenerations: 1, triggerTabId: 1 })).rejects.toThrow("AGENTS_MISSING");
    expect(missing.createCalls).toHaveLength(0);

    const malformed = createHarness({
      bindings: {
        developer: { conversationId: "developer-chat", title: "Bad", href: "https://chatgpt.com/c/not-developer-chat" },
        auditor: { conversationId: "auditor-chat", title: "Auditor", href: "https://chatgpt.com/c/auditor-chat" },
      },
    });
    await expect(malformed.api.startFromUi({ task: "x", maxRounds: 1, maxGenerations: 1, triggerTabId: 1 })).rejects.toThrow("INITIAL_BINDINGS_MISSING");
    expect(malformed.createCalls).toHaveLength(0);

    const same: Conversation = { conversationId: "same", title: "Same", href: "https://chatgpt.com/c/same" };
    const duplicate = createHarness({ bindings: { developer: same, auditor: same } });
    await expect(duplicate.api.startFromUi({ task: "x", maxRounds: 1, maxGenerations: 1, triggerTabId: 1 })).rejects.toThrow("INITIAL_BINDINGS_MUST_DIFFER");
    expect(duplicate.createCalls).toHaveLength(0);

    const foreground = createHarness({ activeTabId: 2 });
    await expect(foreground.api.startFromUi({ task: "x", maxRounds: 1, maxGenerations: 1, triggerTabId: 1 })).rejects.toThrow("TRIGGER_TAB_NOT_FOREGROUND");
    expect(foreground.createCalls).toHaveLength(0);
  });

  it("does not assign or send until both CONTENT_READY signals, then atomically assigns and starts the existing work loop", async () => {
    const h = createHarness();
    await h.api.startFromUi({ task: "Do the task", maxRounds: 3, maxGenerations: 2, triggerTabId: 1 });

    await h.api.markInitialContentReady(await h.api.getState(), 100);
    expect(h.state.initialMaterialization.developerReady).toBe(true);
    expect(h.state.initialMaterialization.auditorReady).toBe(false);
    expect(h.state.developerTabId).toBeNull();
    expect(h.state.auditorTabId).toBeNull();
    expect(h.sends).toHaveLength(0);

    await h.api.markInitialContentReady(await h.api.getState(), 101);
    expect(h.state.initialMaterialization.phase).toBe("COMPLETE");
    expect(h.state.developerTabId).toBe(100);
    expect(h.state.auditorTabId).toBe(101);
    expect(h.state.status).toBe("DEVELOPING");
    expect(h.sends).toHaveLength(1);
    expect(h.sends[0].tabId).toBe(100);
  });

  it("fails without replacement when a loaded conversation identity mismatches", async () => {
    const h = createHarness({ createdUrl: (index, requested) => index === 0 ? "https://chatgpt.com/c/wrong-chat" : requested });

    await h.api.startFromUi({ task: "x", maxRounds: 1, maxGenerations: 1, triggerTabId: 1 });

    expect(h.state.status).toBe("FAILED");
    expect(h.state.error).toContain("INITIAL_DEVELOPER_CONVERSATION_MISMATCH");
    expect(h.createCalls).toHaveLength(1);
    expect(h.state.initialMaterialization.developerTabId).toBe(100);
    expect(h.sends).toHaveLength(0);
  });

  it("fails and preserves the recorded id if an auto-created agent tab becomes active or foreground changes", async () => {
    const active = createHarness({ createdActive: (index) => index === 0 });
    await active.api.startFromUi({ task: "x", maxRounds: 1, maxGenerations: 1, triggerTabId: 1 });
    expect(active.state.status).toBe("FAILED");
    expect(active.state.initialMaterialization.developerTabId).toBe(100);
    expect(active.createCalls).toHaveLength(1);
    expect(active.sends).toHaveLength(0);

    const focus = createHarness({ mutateOnCreate: (index, env) => { if (index === 0) env.setActiveTabId(2); } });
    await focus.api.startFromUi({ task: "x", maxRounds: 1, maxGenerations: 1, triggerTabId: 1 });
    expect(focus.state.status).toBe("FAILED");
    expect(focus.state.error).toContain("FOREGROUND_ACTIVE_TAB_CHANGED");
    expect(focus.state.initialMaterialization.developerTabId).toBe(100);
    expect(focus.createCalls).toHaveLength(1);
    expect(focus.sends).toHaveLength(0);
  });

  it("restores claimed-but-unrecorded as FAILED with zero retry, and never replaces a missing recorded tab", async () => {
    const claimed = createHarness();
    claimed.state = {
      version: 4,
      status: null,
      bindings: { developer: claimed.developer, auditor: claimed.auditor },
      initialMaterialization: {
        phase: "DEVELOPER_CREATE_CLAIMED",
        triggerTabId: 1,
        windowId: 10,
        initialForeground: { focusedWindowId: 10, focused: true, activeTabId: 1 },
        developerBinding: claimed.developer,
        auditorBinding: claimed.auditor,
        developerTabId: null,
        auditorTabId: null,
        developerReady: false,
        auditorReady: false,
        createCount: 1,
      },
    };
    await claimed.api.restoreInitialMaterializationSafely(await claimed.api.getState());
    expect(claimed.state.status).toBe("FAILED");
    expect(claimed.state.error).toBe("INITIAL_DEVELOPER_CREATE_INTERRUPTED_NO_RETRY");
    expect(claimed.createCalls).toHaveLength(0);

    const missing = createHarness();
    missing.state = {
      version: 4,
      status: null,
      bindings: { developer: missing.developer, auditor: missing.auditor },
      initialMaterialization: {
        phase: "WAITING_READY",
        triggerTabId: 1,
        windowId: 10,
        initialForeground: { focusedWindowId: 10, focused: true, activeTabId: 1 },
        developerBinding: missing.developer,
        auditorBinding: missing.auditor,
        developerTabId: 100,
        auditorTabId: 101,
        developerReady: false,
        auditorReady: false,
        createCount: 2,
      },
    };
    await missing.api.restoreInitialMaterializationSafely(await missing.api.getState());
    expect(missing.state.status).toBe("FAILED");
    expect(missing.state.error).toContain("INITIAL_DEVELOPER_TAB_MISSING");
    expect(missing.createCalls).toHaveLength(0);
  });

  it("persists an early developer CONTENT_READY before auditor creation and completes exactly once", async () => {
    const h = createHarness();
    h.tabs.set(99, {
      id: 99,
      windowId: 10,
      url: h.developer.href,
      pendingUrl: h.developer.href,
      active: false,
      status: "complete",
    });
    h.state = {
      version: 4,
      status: null,
      bindings: { developer: h.developer, auditor: h.auditor },
      initialTask: "race",
      maxRounds: 2,
      maxGenerations: 1,
      initialMaterialization: {
        phase: "DEVELOPER_CREATED",
        triggerTabId: 1,
        windowId: 10,
        initialForeground: { focusedWindowId: 10, focused: true, activeTabId: 1 },
        developerBinding: h.developer,
        auditorBinding: h.auditor,
        developerTabId: 99,
        auditorTabId: null,
        developerReady: false,
        auditorReady: false,
        createCount: 1,
      },
    };

    await h.api.markInitialContentReady(await h.api.getState(), 99);
    expect(h.state.initialMaterialization).toMatchObject({
      phase: "DEVELOPER_CREATED",
      developerReady: true,
      auditorReady: false,
    });

    await h.api.resumeInitialMaterialization({ allowCreate: true });
    expect(h.createCalls).toHaveLength(1);
    expect(h.createCalls[0]).toMatchObject({
      url: h.auditor.href,
      active: false,
      phaseAtCreate: "AUDITOR_CREATE_CLAIMED",
      createCountAtCreate: 2,
    });
    expect(h.state.initialMaterialization).toMatchObject({
      phase: "WAITING_READY",
      developerReady: true,
      auditorReady: false,
      auditorTabId: 100,
    });

    await h.api.markInitialContentReady(await h.api.getState(), 100);
    await h.api.markInitialContentReady(await h.api.getState(), 100);

    const assignmentWrites = h.storageWrites.filter((write) => write.initialMaterialization?.phase === "ASSIGNED");
    const startWrites = h.storageWrites.filter((write) => write.timeline?.length === 1 && write.timeline[0]?.type === "START");
    expect(assignmentWrites).toHaveLength(1);
    expect(startWrites).toHaveLength(1);
    expect(h.state.initialMaterialization.phase).toBe("COMPLETE");
    expect(h.state.developerTabId).toBe(99);
    expect(h.state.auditorTabId).toBe(100);
    expect(h.sends).toHaveLength(1);
    expect(h.createCalls.length).toBeLessThanOrEqual(2);
  });

  it("does not lose auditor CONTENT_READY delivered during tabs.create before WAITING_READY is persisted", async () => {
    const h = createHarness({ contentReadyDuringCreate: (index) => index === 1 });

    await h.api.startFromUi({ task: "race", maxRounds: 2, maxGenerations: 1, triggerTabId: 1 });

    expect(h.createCalls).toHaveLength(2);
    expect(h.state.initialMaterialization).toMatchObject({
      phase: "WAITING_READY",
      developerReady: false,
      auditorReady: true,
      auditorTabId: 101,
    });
    expect(h.sends).toHaveLength(0);

    await h.api.markInitialContentReady(await h.api.getState(), 100);
    expect(h.state.initialMaterialization.phase).toBe("COMPLETE");
    expect(h.storageWrites.filter((write) => write.initialMaterialization?.phase === "ASSIGNED")).toHaveLength(1);
    expect(h.sends).toHaveLength(1);
  });

  it("persists an early auditor CONTENT_READY while still AUDITOR_CREATE_CLAIMED and completes exactly once", async () => {
    const h = createHarness();
    h.tabs.set(98, {
      id: 98,
      windowId: 10,
      url: h.developer.href,
      pendingUrl: h.developer.href,
      active: false,
      status: "complete",
    });
    h.tabs.set(99, {
      id: 99,
      windowId: 10,
      url: h.auditor.href,
      pendingUrl: h.auditor.href,
      active: false,
      status: "complete",
    });
    h.state = {
      version: 4,
      status: null,
      bindings: { developer: h.developer, auditor: h.auditor },
      initialTask: "race",
      maxRounds: 2,
      maxGenerations: 1,
      initialMaterialization: {
        phase: "AUDITOR_CREATE_CLAIMED",
        triggerTabId: 1,
        windowId: 10,
        initialForeground: { focusedWindowId: 10, focused: true, activeTabId: 1 },
        developerBinding: h.developer,
        auditorBinding: h.auditor,
        developerTabId: 98,
        auditorTabId: 99,
        developerReady: false,
        auditorReady: false,
        createCount: 2,
      },
    };

    await h.api.markInitialContentReady(await h.api.getState(), 99);
    expect(h.state.initialMaterialization).toMatchObject({
      phase: "AUDITOR_CREATE_CLAIMED",
      developerReady: false,
      auditorReady: true,
    });

    await h.api.restoreInitialMaterializationSafely(await h.api.getState());
    expect(h.state.initialMaterialization).toMatchObject({
      phase: "WAITING_READY",
      developerReady: false,
      auditorReady: true,
    });
    expect(h.createCalls).toHaveLength(0);

    await h.api.markInitialContentReady(await h.api.getState(), 98);
    await h.api.markInitialContentReady(await h.api.getState(), 98);

    const assignmentWrites = h.storageWrites.filter((write) => write.initialMaterialization?.phase === "ASSIGNED");
    const startWrites = h.storageWrites.filter((write) => write.timeline?.length === 1 && write.timeline[0]?.type === "START");
    expect(assignmentWrites).toHaveLength(1);
    expect(startWrites).toHaveLength(1);
    expect(h.state.initialMaterialization.phase).toBe("COMPLETE");
    expect(h.sends).toHaveLength(1);
    expect(h.createCalls.length).toBeLessThanOrEqual(2);
  });

  it("stops permanently when Agent Bridge is disabled after developer creation", async () => {
    const h = createHarness();
    h.tabs.set(99, {
      id: 99,
      windowId: 10,
      url: h.developer.href,
      pendingUrl: h.developer.href,
      active: false,
      status: "complete",
    });
    h.state = {
      version: 4,
      status: null,
      bindings: { developer: h.developer, auditor: h.auditor },
      initialMaterialization: {
        phase: "DEVELOPER_CREATED",
        triggerTabId: 1,
        windowId: 10,
        initialForeground: { focusedWindowId: 10, focused: true, activeTabId: 1 },
        developerBinding: h.developer,
        auditorBinding: h.auditor,
        developerTabId: 99,
        auditorTabId: null,
        developerReady: false,
        auditorReady: false,
        createCount: 1,
      },
    };

    h.setFeatureEnabled(false);
    await h.api.stopUser();
    expect(h.state.status).toBe("STOPPED_USER");
    expect(h.state.initialMaterialization.developerTabId).toBe(99);
    expect(h.createCalls).toHaveLength(0);
    expect(h.sends).toHaveLength(0);

    await h.api.resumeInitialMaterialization({ allowCreate: true });
    await h.api.markInitialContentReady(await h.api.getState(), 99);
    expect(h.createCalls).toHaveLength(0);
    expect(h.state.developerTabId ?? null).toBeNull();
    expect(h.state.auditorTabId ?? null).toBeNull();
    expect(h.sends).toHaveLength(0);

    h.setFeatureEnabled(true);
    await h.api.resumeInitialMaterialization({ allowCreate: true });
    await h.api.markInitialContentReady(await h.api.getState(), 99);
    expect(h.state.status).toBe("STOPPED_USER");
    expect(h.state.initialMaterialization.developerTabId).toBe(99);
    expect(h.createCalls).toHaveLength(0);
    expect(h.sends).toHaveLength(0);
  });

  it("stops permanently when disabled while both created tabs are waiting for readiness", async () => {
    const h = createHarness();
    await h.api.startFromUi({ task: "disable", maxRounds: 2, maxGenerations: 1, triggerTabId: 1 });
    expect(h.state.initialMaterialization.phase).toBe("WAITING_READY");
    expect(h.createCalls).toHaveLength(2);

    h.setFeatureEnabled(false);
    await h.api.stopUser();
    expect(h.state.status).toBe("STOPPED_USER");
    expect(h.state.initialMaterialization).toMatchObject({ developerTabId: 100, auditorTabId: 101 });

    await h.api.markInitialContentReady(await h.api.getState(), 100);
    await h.api.markInitialContentReady(await h.api.getState(), 101);
    h.setFeatureEnabled(true);
    await h.api.resumeInitialMaterialization({ allowCreate: true });
    await h.api.markInitialContentReady(await h.api.getState(), 100);
    await h.api.markInitialContentReady(await h.api.getState(), 101);

    expect(h.state.status).toBe("STOPPED_USER");
    expect(h.state.developerTabId).toBeNull();
    expect(h.state.auditorTabId).toBeNull();
    expect(h.createCalls).toHaveLength(2);
    expect(h.sends).toHaveLength(0);
    expect(h.storageWrites.filter((write) => write.initialMaterialization?.phase === "ASSIGNED")).toHaveLength(0);
  });

  it("creates a fresh explicit attempt from COMPLETED, FAILED, and STOPPED_USER terminal states", async () => {
    for (const terminal of ["COMPLETED", "FAILED", "STOPPED_USER"]) {
      const h = createHarness();
      h.state = {
        version: 4,
        status: terminal,
        error: terminal === "FAILED" ? "OLD_FAILURE" : null,
        developerTabId: 2,
        auditorTabId: 3,
        bindings: { developer: h.developer, auditor: h.auditor },
        initialMaterialization: null,
      };

      await h.api.startFromUi({ task: `new-${terminal}`, maxRounds: 2, maxGenerations: 1, triggerTabId: 1 });

      expect(h.state.status).toBeNull();
      expect(h.state.error).toBeNull();
      expect(h.state.initialTask).toBe(`new-${terminal}`);
      expect(h.state.initialMaterialization.phase).toBe("WAITING_READY");
      expect(h.state.initialMaterialization.createCount).toBe(2);
      expect(h.createCalls).toHaveLength(2);
      expect(h.sends).toHaveLength(0);
    }
  });

  it("starts a fresh attempt after FAILED or STOPPED_USER even when the previous initial materialization was incomplete", async () => {
    for (const terminal of ["FAILED", "STOPPED_USER"]) {
      const h = createHarness();
      h.tabs.set(98, {
        id: 98,
        windowId: 10,
        url: h.developer.href,
        pendingUrl: h.developer.href,
        active: false,
        status: "complete",
      });
      h.tabs.set(99, {
        id: 99,
        windowId: 10,
        url: h.auditor.href,
        pendingUrl: h.auditor.href,
        active: false,
        status: "complete",
      });
      h.state = {
        version: 4,
        status: terminal,
        error: terminal === "FAILED" ? "OLD_FAILURE" : null,
        developerTabId: null,
        auditorTabId: null,
        bindings: { developer: h.developer, auditor: h.auditor },
        initialMaterialization: {
          phase: "WAITING_READY",
          triggerTabId: 1,
          windowId: 10,
          initialForeground: { focusedWindowId: 10, focused: true, activeTabId: 1 },
          developerBinding: h.developer,
          auditorBinding: h.auditor,
          developerTabId: 98,
          auditorTabId: 99,
          developerReady: true,
          auditorReady: false,
          createCount: 2,
        },
      };

      await h.api.startFromUi({ task: `restart-${terminal}`, maxRounds: 2, maxGenerations: 1, triggerTabId: 1 });

      expect(h.state.status).toBeNull();
      expect(h.state.error).toBeNull();
      expect(h.state.initialTask).toBe(`restart-${terminal}`);
      expect(h.state.initialMaterialization).toMatchObject({
        phase: "WAITING_READY",
        developerTabId: 100,
        auditorTabId: 101,
        createCount: 2,
      });
      expect(h.createCalls).toHaveLength(2);
      expect(h.sends).toHaveLength(0);
    }
  });

  it("reports the new attempt failure instead of preserving a previous COMPLETED terminal state", async () => {
    const h = createHarness({
      createdUrl: (index, requested) => index === 0 ? "https://chatgpt.com/c/wrong-chat" : requested,
    });
    h.state = {
      version: 4,
      status: "COMPLETED",
      error: null,
      bindings: { developer: h.developer, auditor: h.auditor },
      initialMaterialization: null,
    };

    await h.api.startFromUi({ task: "new attempt", maxRounds: 1, maxGenerations: 1, triggerTabId: 1 });

    expect(h.state.status).toBe("FAILED");
    expect(h.state.error).toContain("INITIAL_DEVELOPER_CONVERSATION_MISMATCH");
    expect(h.createCalls).toHaveLength(1);
    expect(h.sends).toHaveLength(0);
  });

  it("retires the previous managed pair only after the repeated Start developer send succeeds", async () => {
    const h = createHarness();

    await h.api.startFromUi({ task: "first", maxRounds: 2, maxGenerations: 1, triggerTabId: 1 });
    const first = await readyAndAcknowledgeDeveloperSend(h);
    expect(h.removeCalls).toEqual([]);
    h.state = { ...h.state, status: "COMPLETED", expected: null };

    const createsBeforeRestart = h.createCalls.length;
    await h.api.startFromUi({ task: "second", maxRounds: 2, maxGenerations: 1, triggerTabId: 1 });
    expect(h.createCalls.length - createsBeforeRestart).toBe(2);
    expect(h.removeCalls).toEqual([]);
    expect(h.state.initialMaterialization).toMatchObject({
      retiredDeveloperTabId: first.developerTabId,
      retiredAuditorTabId: first.auditorTabId,
    });

    const secondMaterialization = plain(h.state.initialMaterialization);
    await h.api.markInitialContentReady(await h.api.getState(), secondMaterialization.developerTabId);
    await h.api.markInitialContentReady(await h.api.getState(), secondMaterialization.auditorTabId);
    expect(h.removeCalls).toEqual([]);

    const secondDeveloperId = h.state.developerTabId;
    const requestId = h.state.expected.requestId;
    await h.api.onTurnSent({ requestId, baselineAssistantCount: 0 }, { tab: { id: secondDeveloperId } });

    expect(h.removeCalls).toEqual([first.developerTabId, first.auditorTabId]);
    expect(h.tabs.has(first.developerTabId)).toBe(false);
    expect(h.tabs.has(first.auditorTabId)).toBe(false);
    expect(h.state.developerTabId).toBe(secondMaterialization.developerTabId);
    expect(h.state.auditorTabId).toBe(secondMaterialization.auditorTabId);
    expect(h.state.agentTabOwnership).toEqual({ developer: "managed", auditor: "managed" });
  });

  it("keeps the previous managed pair tracked and open when repeated materialization fails before send", async () => {
    const h = createHarness({
      createdUrl: (index, requested) => index === 2 ? "https://chatgpt.com/c/wrong-restart" : requested,
    });

    await h.api.startFromUi({ task: "first", maxRounds: 2, maxGenerations: 1, triggerTabId: 1 });
    const first = await readyAndAcknowledgeDeveloperSend(h);
    h.state = { ...h.state, status: "COMPLETED", expected: null };

    await h.api.startFromUi({ task: "second", maxRounds: 2, maxGenerations: 1, triggerTabId: 1 });

    expect(h.state.status).toBe("FAILED");
    expect(h.removeCalls).toEqual([]);
    expect(h.state.developerTabId).toBe(first.developerTabId);
    expect(h.state.auditorTabId).toBe(first.auditorTabId);
    expect(h.state.initialMaterialization).toMatchObject({
      retiredDeveloperTabId: first.developerTabId,
      retiredAuditorTabId: first.auditorTabId,
    });
    expect(h.tabs.has(first.developerTabId)).toBe(true);
    expect(h.tabs.has(first.auditorTabId)).toBe(true);
  });

  it("marks manual assignments external and never auto-removes them during repeated Start", async () => {
    const h = createHarness();
    h.tabs.set(3, { id: 3, windowId: 10, url: "https://chatgpt.com/c/manual-auditor", active: false, status: "complete" });

    await h.api.assignAgent("developer", 2);
    await h.api.assignAgent("auditor", 3);
    expect(h.state.agentTabOwnership).toEqual({ developer: "external", auditor: "external" });
    h.state = { ...h.state, status: "COMPLETED", expected: null };

    await h.api.startFromUi({ task: "materialize", maxRounds: 2, maxGenerations: 1, triggerTabId: 1 });
    expect(h.state.initialMaterialization).toMatchObject({
      retiredDeveloperTabId: null,
      retiredAuditorTabId: null,
    });
    await readyAndAcknowledgeDeveloperSend(h);

    expect(h.removeCalls).toEqual([]);
    expect(h.tabs.has(2)).toBe(true);
    expect(h.tabs.has(3)).toBe(true);
    expect(h.state.agentTabOwnership).toEqual({ developer: "managed", auditor: "managed" });

    const background = read("src/agent-bridge/background.js");
    const removedStart = background.indexOf("chrome.tabs.onRemoved.addListener");
    const removedEnd = background.indexOf("globalThis.ChatXAgentBridge", removedStart);
    const removedBlock = background.slice(removedStart, removedEnd);
    expect(removedBlock).toContain("agentTabOwnership:");
    expect(removedBlock).toContain("tabId === state.developerTabId ? null");
    expect(removedBlock).toContain("tabId === state.auditorTabId ? null");
  });

  it("treats a post-rollover managed pair as safely retireable on the next explicit Start", async () => {
    const h = createHarness();
    h.tabs.set(20, { id: 20, windowId: 10, url: "https://chatgpt.com/c/rollover-developer", active: false, status: "complete" });
    h.tabs.set(21, { id: 21, windowId: 10, url: "https://chatgpt.com/c/rollover-auditor", active: false, status: "complete" });
    h.state = {
      version: 4,
      status: "COMPLETED",
      developerTabId: 20,
      auditorTabId: 21,
      agentTabOwnership: { developer: "managed", auditor: "managed" },
      bindings: { developer: h.developer, auditor: h.auditor },
      rolloverStatus: {
        phase: "COMPLETE",
        newDeveloperTabId: 20,
        newAuditorTabId: 21,
        oldTabsClosed: true,
      },
      initialMaterialization: null,
    };

    await h.api.startFromUi({ task: "after rollover", maxRounds: 2, maxGenerations: 1, triggerTabId: 1 });
    expect(h.state.initialMaterialization).toMatchObject({
      retiredDeveloperTabId: 20,
      retiredAuditorTabId: 21,
    });
    await readyAndAcknowledgeDeveloperSend(h);
    expect(h.removeCalls).toEqual([20, 21]);
    expect(h.state.agentTabOwnership).toEqual({ developer: "managed", auditor: "managed" });

    const background = read("src/agent-bridge/background.js");
    const rolloverStart = background.indexOf("async function beginRollover");
    const rolloverCreateStart = background.indexOf("async function createRolloverTab", rolloverStart);
    const rolloverClaim = background.slice(rolloverStart, rolloverCreateStart);
    expect(rolloverClaim).toContain("oldDeveloperOwnership: state.agentTabOwnership?.developer ?? null");
    expect(rolloverClaim).toContain("oldAuditorOwnership: state.agentTabOwnership?.auditor ?? null");

    const switchStart = background.indexOf("async function performAtomicSwitch");
    const switchEnd = background.indexOf("async function closeOldAgentTabsAfterSend", switchStart);
    expect(background.slice(switchStart, switchEnd)).toContain('developer: "managed"');
    expect(background.slice(switchStart, switchEnd)).toContain('auditor: "managed"');

    const closeStart = background.indexOf("async function closeOldAgentTabsAfterSend");
    const closeEnd = background.indexOf("function hasSendEvidence", closeStart);
    const closeBlock = background.slice(closeStart, closeEnd);
    expect(closeBlock).toContain('rollover.oldDeveloperOwnership === "managed"');
    expect(closeBlock).toContain('rollover.oldAuditorOwnership === "managed"');
  });

  it("does not retry retirement after close failure and preserves retired managed ids", async () => {
    const h = createHarness({ removeFailsFor: 101 });

    await h.api.startFromUi({ task: "first", maxRounds: 2, maxGenerations: 1, triggerTabId: 1 });
    const first = await readyAndAcknowledgeDeveloperSend(h);
    expect(first).toMatchObject({ developerTabId: 100, auditorTabId: 101 });
    h.state = { ...h.state, status: "COMPLETED", expected: null };

    await h.api.startFromUi({ task: "second", maxRounds: 2, maxGenerations: 1, triggerTabId: 1 });
    const materialization = plain(h.state.initialMaterialization);
    await h.api.markInitialContentReady(await h.api.getState(), materialization.developerTabId);
    await h.api.markInitialContentReady(await h.api.getState(), materialization.auditorTabId);
    const requestId = h.state.expected.requestId;
    const currentDeveloperId = h.state.developerTabId;
    await h.api.onTurnSent({ requestId, baselineAssistantCount: 0 }, { tab: { id: currentDeveloperId } });

    expect(h.removeCalls).toEqual([100, 101]);
    expect(h.state.status).toBe("FAILED");
    expect(h.state.error).toContain("OLD_AGENT_TAB_CLOSE_FAILED");
    expect(h.state.initialMaterialization).toMatchObject({
      retiredDeveloperTabId: 100,
      retiredAuditorTabId: 101,
    });
    expect(h.state.developerTabId).toBe(materialization.developerTabId);
    expect(h.state.auditorTabId).toBe(materialization.auditorTabId);
    expect(h.createCalls).toHaveLength(4);

    await h.api.onTurnSent({ requestId, baselineAssistantCount: 0 }, { tab: { id: currentDeveloperId } });
    expect(h.removeCalls).toEqual([100, 101]);
    expect(h.createCalls).toHaveLength(4);
  });

  it("does not accumulate untracked managed tabs across consecutive successful Starts", async () => {
    const h = createHarness();

    await h.api.startFromUi({ task: "one", maxRounds: 2, maxGenerations: 1, triggerTabId: 1 });
    const first = await readyAndAcknowledgeDeveloperSend(h);
    h.state = { ...h.state, status: "COMPLETED", expected: null };

    const beforeSecond = h.createCalls.length;
    await h.api.startFromUi({ task: "two", maxRounds: 2, maxGenerations: 1, triggerTabId: 1 });
    expect(h.createCalls.length - beforeSecond).toBe(2);
    const second = await readyAndAcknowledgeDeveloperSend(h);
    expect(h.removeCalls).toEqual([first.developerTabId, first.auditorTabId]);
    h.state = { ...h.state, status: "COMPLETED", expected: null };

    const beforeThird = h.createCalls.length;
    await h.api.startFromUi({ task: "three", maxRounds: 2, maxGenerations: 1, triggerTabId: 1 });
    expect(h.createCalls.length - beforeThird).toBe(2);
    const third = await readyAndAcknowledgeDeveloperSend(h);

    expect(h.removeCalls).toEqual([
      first.developerTabId,
      first.auditorTabId,
      second.developerTabId,
      second.auditorTabId,
    ]);
    expect([...h.tabs.keys()].filter((id) => id >= 100).sort((a, b) => a - b)).toEqual([
      third.developerTabId,
      third.auditorTabId,
    ].sort((a, b) => a - b));
    expect(h.state.agentTabOwnership).toEqual({ developer: "managed", auditor: "managed" });
  });

  it("cleans a FAILED developer temp before PREPARED/create on a new explicit Start", async () => {
    const h = createHarness();
    seedTerminalInitialMaterialization(h, "FAILED");

    await h.api.startFromUi({ task: "restart", maxRounds: 2, maxGenerations: 1, triggerTabId: 1 });

    expect(h.removeCalls).toEqual([98]);
    expect(h.createCalls).toHaveLength(2);
    const removeIndex = h.operations.indexOf("remove:98");
    const preparedIndex = h.operations.findIndex((op) => op.startsWith("write:PREPARED:"));
    const createIndex = h.operations.findIndex((op) => op.startsWith("create:"));
    expect(removeIndex).toBeGreaterThanOrEqual(0);
    expect(preparedIndex).toBeGreaterThan(removeIndex);
    expect(createIndex).toBeGreaterThan(preparedIndex);
    expect(h.tabs.has(98)).toBe(false);
  });

  it("cleans both FAILED temp tabs before beginning the replacement attempt", async () => {
    const h = createHarness();
    seedTerminalInitialMaterialization(h, "FAILED", { developerTabId: 98, auditorTabId: 99, phase: "WAITING_READY" });

    await h.api.startFromUi({ task: "restart pair", maxRounds: 2, maxGenerations: 1, triggerTabId: 1 });

    expect(h.removeCalls).toEqual([98, 99]);
    expect(h.createCalls).toHaveLength(2);
    const preparedIndex = h.operations.findIndex((op) => op.startsWith("write:PREPARED:"));
    expect(h.operations.indexOf("remove:98")).toBeLessThan(preparedIndex);
    expect(h.operations.indexOf("remove:99")).toBeLessThan(preparedIndex);
  });

  it("cleans a STOPPED_USER WAITING_READY temp pair before the next explicit attempt", async () => {
    const h = createHarness();
    seedTerminalInitialMaterialization(h, "STOPPED_USER", { developerTabId: 98, auditorTabId: 99, phase: "WAITING_READY" });

    await h.api.startFromUi({ task: "restart stopped", maxRounds: 2, maxGenerations: 1, triggerTabId: 1 });

    expect(h.removeCalls).toEqual([98, 99]);
    expect(h.createCalls).toHaveLength(2);
    expect(h.state.initialMaterialization.phase).toBe("WAITING_READY");
  });

  it("does not overwrite terminal temp tracking or create new tabs when pre-Start cleanup fails", async () => {
    const h = createHarness({ removeFailsFor: 98 });
    seedTerminalInitialMaterialization(h, "FAILED", { developerTabId: 98, auditorTabId: 99, phase: "WAITING_READY" });
    const previous = plain(h.state.initialMaterialization);

    await expect(h.api.startFromUi({ task: "must not start", maxRounds: 2, maxGenerations: 1, triggerTabId: 1 }))
      .rejects.toThrow("PREVIOUS_INITIAL_MATERIALIZATION_CLEANUP_FAILED");

    expect(h.removeCalls).toEqual([98]);
    expect(h.createCalls).toHaveLength(0);
    expect(h.state.status).toBe("FAILED");
    expect(h.state.error).toContain("PREVIOUS_INITIAL_MATERIALIZATION_CLEANUP_FAILED");
    expect(plain(h.state.initialMaterialization)).toEqual(previous);
    expect(h.tabs.has(98)).toBe(true);
    expect(h.tabs.has(99)).toBe(true);
    expect(h.operations.some((op) => op.startsWith("write:PREPARED:"))).toBe(false);
  });

  it("allows a new attempt without remove when terminal previous materialization recorded no temp ids", async () => {
    const h = createHarness();
    seedTerminalInitialMaterialization(h, "FAILED", { developerTabId: null as any, auditorTabId: null, phase: "PREPARED" });

    await h.api.startFromUi({ task: "no temps", maxRounds: 2, maxGenerations: 1, triggerTabId: 1 });

    expect(h.removeCalls).toHaveLength(0);
    expect(h.createCalls).toHaveLength(2);
    expect(h.state.initialMaterialization.phase).toBe("WAITING_READY");
  });

  it("uses one canonical physical create primitive for initial materialization and rollover", () => {
    const background = read("src/agent-bridge/background.js");
    expect(background.match(/chrome\.tabs\.create\s*\(/g)).toHaveLength(1);

    const canonicalStart = background.indexOf("async function createClaimedAgentTab");
    const canonicalEnd = background.indexOf("async function sendPrompt", canonicalStart);
    const canonical = background.slice(canonicalStart, canonicalEnd);
    expect(canonical).toContain("chrome.tabs.create({ windowId, url, active: false })");
    expect(canonical.indexOf("putState(recordCreated(latest, created))")).toBeGreaterThan(canonical.indexOf("chrome.tabs.create"));

    const rolloverStart = background.indexOf("async function createRolloverTab");
    const rolloverEnd = background.indexOf("async function dispatchBootstrap", rolloverStart);
    expect(background.slice(rolloverStart, rolloverEnd)).toContain("createClaimedAgentTab({");

    const initialStart = background.indexOf("async function createInitialMaterializedTab");
    const initialEnd = background.indexOf("async function finishInitialMaterialization", initialStart);
    expect(background.slice(initialStart, initialEnd)).toContain("createClaimedAgentTab({");

    expect(background.match(/chrome\.tabs\.remove\s*\(/g)).toHaveLength(1);
    const closePrimitiveStart = background.indexOf("async function closeRetiredManagedTabsOnce");
    const closePrimitiveEnd = background.indexOf("async function closeOldAgentTabsAfterSend", closePrimitiveStart);
    expect(background.slice(closePrimitiveStart, closePrimitiveEnd)).toContain("chrome.tabs.remove(tabId)");
    const rolloverCloseStart = background.indexOf("async function closeOldAgentTabsAfterSend");
    const rolloverCloseEnd = background.indexOf("function hasSendEvidence", rolloverCloseStart);
    expect(background.slice(rolloverCloseStart, rolloverCloseEnd)).toContain("closeRetiredManagedTabsOnce([");
    const initialCloseStart = background.indexOf("async function closeInitialRetiredManagedTabsAfterSend");
    const initialCloseEnd = background.indexOf("async function getPublicUiState", initialCloseStart);
    expect(background.slice(initialCloseStart, initialCloseEnd)).toContain("closeRetiredManagedTabsOnce([");
  });

  it("keeps readiness event-driven and leaves protocol/rollover semantics separate", () => {
    const background = read("src/agent-bridge/background.js");
    const protocol = read("src/agent-bridge/protocol.js");
    const initialStart = background.indexOf("async function beginInitialMaterialization");
    const initialEnd = background.indexOf("async function getPublicUiState", initialStart);
    const initial = background.slice(initialStart, initialEnd);

    expect(background).toContain('message?.type === "CONTENT_READY"');
    expect(background).toContain("initialMaterializationRoleForTab(state, tabId)");
    expect(background).toContain('changeInfo.status !== "complete"');
    expect(initial).not.toContain("setInterval(");
    expect(initial).not.toContain("setTimeout(");
    expect(initial).not.toContain("rolloverStatus:");
    expect(initial).not.toContain("dispatchBootstrap(");
    expect(protocol).not.toContain("initialMaterialization");
  });

  it("enables Start from persisted bindings without adding a third UI role", () => {
    const floating = read("src/floating-ui.js");
    const startBlock = floating.slice(
      floating.indexOf("function updateStartEnabled"),
      floating.indexOf("function renderBindings"),
    );
    expect(startBlock).toContain("bindingsReady");
    expect(startBlock).toContain("agentsReady");
    expect(startBlock).toContain("(!bindingsReady && !agentsReady)");
    expect(floating).not.toContain("triggerTabId");
  });
});
