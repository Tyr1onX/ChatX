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

function loadBindings() {
  const context: Record<string, unknown> = { URL };
  context.globalThis = context;
  vm.runInNewContext(read("src/agent-bridge/bindings.js"), context);
  return context.ChatXAgentBridgeBindings as {
    conversationIdFromHref(href: string): string | null;
    fromDragEvent(event: unknown): { conversationId: string; title: string; href: string } | null;
    emptyBindings(): { developer: null; auditor: null };
    bind(
      bindings: unknown,
      role: "developer" | "auditor",
      conversation: unknown,
    ): {
      developer: { conversationId: string; title: string; href: string } | null;
      auditor: { conversationId: string; title: string; href: string } | null;
    };
    createDragSession(): {
      start(event: unknown): unknown;
      current(): unknown;
      clear(): void;
    };
  };
}

function conversationLink(href: string, title: string) {
  return {
    href,
    innerText: title,
    textContent: title,
    getAttribute() {
      return null;
    },
  };
}

function dragEvent(link: ReturnType<typeof conversationLink> | null) {
  return {
    target: {
      closest(selector: string) {
        expect(selector).toBe('a[href*="/c/"]');
        return link;
      },
    },
  };
}

function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function blockBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("ChatX Agent Bridge conversation bindings", () => {
  it("extracts a valid /c/<conversationId> drag source from the real anchor shape", () => {
    const bindings = loadBindings();
    const source = bindings.fromDragEvent(dragEvent(conversationLink(
      "https://chatgpt.com/c/conversation-a",
      "  Existing   chat  ",
    )));

    expect(plain(source)).toEqual({
      conversationId: "conversation-a",
      title: "Existing chat",
      href: "https://chatgpt.com/c/conversation-a",
    });
  });

  it("parses project chat URLs with /g/.../c/<conversationId>", () => {
    const bindings = loadBindings();
    const href = "https://chatgpt.com/g/g-p-project/c/project-conversation";

    expect(bindings.conversationIdFromHref(href)).toBe("project-conversation");
    expect(plain(bindings.fromDragEvent(dragEvent(conversationLink(href, "Project chat"))))).toEqual({
      conversationId: "project-conversation",
      title: "Project chat",
      href,
    });
  });

  it("rejects invalid drags before they can activate binding UI", () => {
    const bindings = loadBindings();

    expect(bindings.fromDragEvent(dragEvent(null))).toBeNull();
    expect(bindings.fromDragEvent(dragEvent(conversationLink("https://example.com/c/nope", "Nope")))).toBeNull();
    expect(bindings.fromDragEvent(dragEvent(conversationLink("https://chatgpt.com/", "No conversation")))).toBeNull();
  });

  it("binds developer/executor and auditor independently", () => {
    const bindings = loadBindings();
    const developer = {
      conversationId: "developer-chat",
      title: "Executor chat",
      href: "https://chatgpt.com/c/developer-chat",
    };
    const auditor = {
      conversationId: "auditor-chat",
      title: "Auditor chat",
      href: "https://chatgpt.com/g/project/c/auditor-chat",
    };

    const afterDeveloper = bindings.bind(bindings.emptyBindings(), "developer", developer);
    const afterAuditor = bindings.bind(afterDeveloper, "auditor", auditor);

    expect(plain(afterDeveloper.developer)).toEqual(developer);
    expect(afterDeveloper.auditor).toBeNull();
    expect(plain(afterAuditor.developer)).toEqual(developer);
    expect(plain(afterAuditor.auditor)).toEqual(auditor);
  });

  it("prevents one conversation from being bound to both roles", () => {
    const bindings = loadBindings();
    const conversation = {
      conversationId: "same-chat",
      title: "Same chat",
      href: "https://chatgpt.com/c/same-chat",
    };
    const state = bindings.bind(bindings.emptyBindings(), "developer", conversation);

    expect(() => bindings.bind(state, "auditor", conversation)).toThrow("CONVERSATION_ALREADY_BOUND_TO_OTHER_ROLE");
  });

  it("allows rebinding the same role to replace its previous conversation", () => {
    const bindings = loadBindings();
    const first = bindings.bind(bindings.emptyBindings(), "developer", {
      conversationId: "first",
      title: "First",
      href: "https://chatgpt.com/c/first",
    });
    const second = bindings.bind(first, "developer", {
      conversationId: "second",
      title: "Second",
      href: "https://chatgpt.com/c/second",
    });

    expect(second.developer?.conversationId).toBe("second");
    expect(second.auditor).toBeNull();
  });

  it("clears the temporary drag source", () => {
    const bindings = loadBindings();
    const session = bindings.createDragSession();
    session.start(dragEvent(conversationLink("https://chatgpt.com/c/drag-source", "Drag source")));

    expect(session.current()).not.toBeNull();
    session.clear();
    expect(session.current()).toBeNull();
  });

  it("does not activate conversation drag UI while Agent Bridge is disabled", () => {
    const floating = read("src/floating-ui.js");
    const block = blockBetween(
      floating,
      "function onConversationDragStart",
      "function onConversationDragEnd",
    );
    let starts = 0;
    let lookups = 0;
    let panelsOpened = 0;
    const context: Record<string, unknown> = {
      features: { agentBridge: false },
      conversationDrag: {
        start() {
          starts += 1;
          return { conversationId: "should-not-start" };
        },
      },
      panel: { hidden: true },
      $() {
        lookups += 1;
        return { classList: { add() {} } };
      },
      renderBindings() {},
      setPanelOpen() {
        panelsOpened += 1;
      },
      conversationDragPanelWasOpen: null,
    };
    context.globalThis = context;
    vm.runInNewContext(`${block}\nglobalThis.probe = onConversationDragStart;`, context);

    (context.probe as (event: unknown) => void)({});

    expect(starts).toBe(0);
    expect(lookups).toBe(0);
    expect(panelsOpened).toBe(0);
  });

  it("hides persisted bindings while disabled and restores their titles when re-enabled", () => {
    const floating = read("src/floating-ui.js");
    const block = blockBetween(floating, "function renderBindings", "function renderBridge");
    const elements = {
      developerBinding: { textContent: "" },
      auditorBinding: { textContent: "" },
      bindingZones: { hidden: false },
    };
    const features = { agentBridge: false };
    const currentState = {
      bindings: {
        developer: {
          conversationId: "persisted-developer",
          title: "Persisted executor",
          href: "https://chatgpt.com/c/persisted-developer",
        },
        auditor: {
          conversationId: "persisted-auditor",
          title: "Persisted auditor",
          href: "https://chatgpt.com/c/persisted-auditor",
        },
      },
    };
    const context: Record<string, unknown> = {
      currentState,
      Bindings: { emptyBindings: () => ({ developer: null, auditor: null }) },
      features,
      conversationDrag: { current: () => null },
      $(id: keyof typeof elements) {
        return elements[id];
      },
      positionPanel() {},
    };
    context.globalThis = context;
    vm.runInNewContext(`${block}\nglobalThis.renderBindingsProbe = renderBindings;`, context);
    const renderBindings = context.renderBindingsProbe as () => void;

    renderBindings();
    expect(elements.bindingZones.hidden).toBe(true);
    expect(elements.developerBinding.textContent).toBe("✓ Persisted executor");
    expect(elements.auditorBinding.textContent).toBe("✓ Persisted auditor");

    features.agentBridge = true;
    renderBindings();
    expect(elements.bindingZones.hidden).toBe(false);
    expect(elements.developerBinding.textContent).toBe("✓ Persisted executor");
    expect(elements.auditorBinding.textContent).toBe("✓ Persisted auditor");
    expect(currentState.bindings.developer.title).toBe("Persisted executor");
    expect(currentState.bindings.auditor.title).toBe("Persisted auditor");
  });

  it("cleans an active conversation drag immediately when Agent Bridge is disabled", () => {
    const floating = read("src/floating-ui.js");
    const renderFeaturesBlock = blockBetween(floating, "function renderFeatures", "async function refreshBridge");
    const endDragBlock = blockBetween(floating, "function endConversationDrag", "function onConversationDragStart");
    let source: unknown = { conversationId: "active-drag" };
    let clearCount = 0;
    const bindingZoneClasses = new Set(["drag-active"]);
    const developerClasses = new Set(["drag-over"]);
    const auditorClasses = new Set(["drag-over"]);
    const elements = {
      watcherToggle: { checked: false },
      sessionGuardToggle: { checked: false },
      agentBridgeToggle: { checked: true },
      agentBridgeControls: { hidden: false },
      bindingZones: {
        classList: {
          remove(name: string) {
            bindingZoneClasses.delete(name);
          },
        },
      },
    };
    const context: Record<string, unknown> = {
      features: { watcher: true, sessionGuard: true, agentBridge: false },
      conversationDrag: {
        current() {
          return source;
        },
        clear() {
          clearCount += 1;
          source = null;
        },
      },
      conversationDragPanelWasOpen: true,
      $(id: keyof typeof elements) {
        return elements[id];
      },
      shadow: {
        querySelectorAll() {
          return [developerClasses, auditorClasses].map((classes) => ({
            classList: {
              remove(name: string) {
                classes.delete(name);
              },
            },
          }));
        },
      },
      clearNotice() {},
      renderBindings() {},
      renderLauncherVisual() {},
      positionPanel() {},
      setPanelOpen() {},
    };
    context.globalThis = context;
    vm.runInNewContext(
      `${endDragBlock}\n${renderFeaturesBlock}\nglobalThis.renderFeaturesProbe = renderFeatures;`,
      context,
    );

    (context.renderFeaturesProbe as () => void)();

    expect(clearCount).toBe(1);
    expect(source).toBeNull();
    expect(bindingZoneClasses.has("drag-active")).toBe(false);
    expect(developerClasses.has("drag-over")).toBe(false);
    expect(auditorClasses.has("drag-over")).toBe(false);
    expect(elements.agentBridgeControls.hidden).toBe(true);
  });

  it("gates persisted binding writes by feature state and running status while keeping idle binding behavior", async () => {
    const background = read("src/agent-bridge/background.js");
    const block = blockBetween(background, "async function bindConversation", "async function assignAgent");
    const bindings = loadBindings();
    const conversation = {
      conversationId: "executor-chat",
      title: "Executor chat",
      href: "https://chatgpt.com/c/executor-chat",
    };

    async function runCase({ enabled, status }: { enabled: boolean; status: string | null }) {
      const writes: unknown[] = [];
      const state = { status, bindings: bindings.emptyBindings() };
      const context: Record<string, unknown> = {
        RUNNING_STATUSES: new Set(["DEVELOPING", "AUDITING", "ROLLOVER"]),
        Bindings: bindings,
        async assertFeatureEnabled() {
          if (!enabled) throw new Error("AGENT_BRIDGE_DISABLED");
        },
        async getState() {
          return state;
        },
        async putState(next: unknown) {
          writes.push(next);
          return next;
        },
        async getPublicUiState() {
          return { ok: true };
        },
      };
      context.globalThis = context;
      vm.runInNewContext(`${block}\nglobalThis.bindConversationProbe = bindConversation;`, context);
      const bind = context.bindConversationProbe as (role: string, value: unknown) => Promise<unknown>;
      return { bind, writes };
    }

    const disabled = await runCase({ enabled: false, status: null });
    await expect(disabled.bind("developer", conversation)).rejects.toThrow("AGENT_BRIDGE_DISABLED");
    expect(disabled.writes).toHaveLength(0);

    const running = await runCase({ enabled: true, status: "DEVELOPING" });
    await expect(running.bind("developer", conversation)).rejects.toThrow("STOP_CURRENT_RUN_BEFORE_REASSIGN");
    expect(running.writes).toHaveLength(0);

    const idle = await runCase({ enabled: true, status: null });
    await expect(idle.bind("developer", conversation)).resolves.toEqual({ ok: true });
    expect(idle.writes).toHaveLength(1);
    expect(plain((idle.writes[0] as { bindings: unknown }).bindings)).toEqual({
      developer: conversation,
      auditor: null,
    });
  });

  it("wires native drag/drop cleanup and persists through existing Agent Bridge state only", () => {
    const bindingSource = read("src/agent-bridge/bindings.js");
    const floating = read("src/floating-ui.js");
    const background = read("src/agent-bridge/background.js");
    const uiApi = read("src/ui-api.js");
    const features = read("src/features.js");
    const uiPrefs = read("src/ui-prefs.js");
    const protocol = read("src/agent-bridge/protocol.js");
    const manifest = JSON.parse(read("manifest.json")) as {
      content_scripts: Array<{ js: string[] }>;
    };

    expect(manifest.content_scripts[2].js).toContain("src/agent-bridge/bindings.js");
    expect(bindingSource).toContain('event?.target?.closest?.(\'a[href*="/c/"]\')');
    expect(bindingSource).not.toContain("dataTransfer");
    expect(floating).toContain('document.addEventListener("dragstart", onConversationDragStart, true)');
    expect(floating).toContain('document.addEventListener("dragend", onConversationDragEnd, true)');
    expect(floating).toContain('zone.addEventListener("dragenter"');
    expect(floating).toContain('zone.addEventListener("dragover"');
    expect(floating).toContain('zone.addEventListener("drop"');
    expect(floating).toContain('endConversationDrag({ keepPanelOpen: true })');
    expect(floating).toContain('renderBridge(await Ui.bindConversation(role, source))');
    expect(floating).toContain('if (!source) return;');
    expect(floating).toContain('event.preventDefault()');
    expect(floating).toContain('> EXECUTOR / 执行窗口'.replace(">", "&gt;"));
    expect(floating).toContain('> AUDITOR / 审计窗口'.replace(">", "&gt;"));
    expect(floating).toContain("DROP HERE_");

    const dragStart = floating.indexOf("function onConversationDragStart");
    const featureGuard = floating.indexOf("if (!features.agentBridge) return;", dragStart);
    const sessionStart = floating.indexOf("conversationDrag.start(event)", dragStart);
    const sourceGuard = floating.indexOf("if (!source) return;", dragStart);
    const activate = floating.indexOf('classList.add("drag-active")', dragStart);
    expect(featureGuard).toBeGreaterThan(dragStart);
    expect(sessionStart).toBeGreaterThan(featureGuard);
    expect(sourceGuard).toBeGreaterThan(sessionStart);
    expect(activate).toBeGreaterThan(sourceGuard);

    const dropStart = floating.indexOf('zone.addEventListener("drop"');
    const dropCleanup = floating.indexOf("endConversationDrag({ keepPanelOpen: true })", dropStart);
    const bindCall = floating.indexOf("Ui.bindConversation(role, source)", dropStart);
    expect(dropCleanup).toBeGreaterThan(dropStart);
    expect(bindCall).toBeGreaterThan(dropCleanup);

    expect(background).toContain('const STATE_KEY = "runtimeProof"');
    expect(background).toContain("bindings: Bindings.emptyBindings()");
    expect(background).toContain('message.type === "BRIDGE_BIND_CONVERSATION"');
    expect(background).toContain("bindings: Bindings.bind(state.bindings, role, conversation)");
    expect(background).not.toContain("BINDING_STATE_KEY");
    expect(uiApi).toContain('message("BRIDGE_BIND_CONVERSATION"');

    const bindStart = background.indexOf("async function bindConversation");
    const bindEnd = background.indexOf("async function assignAgent", bindStart);
    const bindBlock = background.slice(bindStart, bindEnd);
    const bindFeatureGuard = bindBlock.indexOf("await assertFeatureEnabled()");
    const bindReadState = bindBlock.indexOf("await getState()");
    const bindRunningGuard = bindBlock.indexOf("RUNNING_STATUSES.has(state.status)");
    const bindWriteState = bindBlock.indexOf("await putState(");
    expect(bindFeatureGuard).toBeGreaterThanOrEqual(0);
    expect(bindReadState).toBeGreaterThan(bindFeatureGuard);
    expect(bindRunningGuard).toBeGreaterThan(bindReadState);
    expect(bindWriteState).toBeGreaterThan(bindRunningGuard);
    expect(bindBlock).not.toContain("chrome.tabs.create");
    expect(bindBlock).not.toContain("sendPrompt(");
    expect(bindBlock).not.toContain("startWorkLoop(");

    expect(features).not.toContain("bindings");
    expect(uiPrefs).not.toContain("bindings");
    expect(protocol).not.toContain("BRIDGE_BIND_CONVERSATION");
  });
});
