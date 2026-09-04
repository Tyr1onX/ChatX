(() => {
  if (globalThis.ChatXAgentBridgeBindings) return;

  const ROLES = new Set(["developer", "auditor"]);
  const CHATGPT_ORIGIN = "https://chatgpt.com";

  function conversationIdFromHref(href) {
    if (typeof href !== "string" || !href.trim()) return null;
    try {
      const url = new URL(href, `${CHATGPT_ORIGIN}/`);
      if (url.origin !== CHATGPT_ORIGIN) return null;
      const match = url.pathname.match(/\/c\/([^/?#]+)/);
      return match?.[1] ? decodeURIComponent(match[1]) : null;
    } catch {
      return null;
    }
  }

  function normalizeConversation(value) {
    if (!value || typeof value !== "object") return null;
    const conversationId = typeof value.conversationId === "string" ? value.conversationId.trim() : "";
    const title = typeof value.title === "string" ? value.title.replace(/\s+/g, " ").trim() : "";
    const href = typeof value.href === "string" ? value.href.trim() : "";
    if (!conversationId || !title || !href) return null;
    if (conversationIdFromHref(href) !== conversationId) return null;
    return { conversationId, title, href: new URL(href, `${CHATGPT_ORIGIN}/`).href };
  }

  function fromConversationLink(link) {
    if (!link || typeof link.href !== "string") return null;
    const conversationId = conversationIdFromHref(link.href);
    if (!conversationId) return null;
    let title = "";
    for (const value of [link.innerText, link.textContent, link.getAttribute?.("title"), link.getAttribute?.("aria-label")]) {
      title = String(value ?? "").replace(/\s+/g, " ").trim();
      if (title) break;
    }
    return normalizeConversation({ conversationId, title, href: link.href });
  }

  function fromDragEvent(event) {
    const link = event?.target?.closest?.('a[href*="/c/"]') ?? null;
    return fromConversationLink(link);
  }

  function emptyBindings() {
    return { developer: null, auditor: null };
  }

  function normalizeBindings(value) {
    return {
      developer: normalizeConversation(value?.developer),
      auditor: normalizeConversation(value?.auditor),
    };
  }

  function bind(bindings, role, conversation) {
    if (!ROLES.has(role)) throw new Error("INVALID_AGENT_ROLE");
    const normalized = normalizeConversation(conversation);
    if (!normalized) throw new Error("INVALID_CONVERSATION_BINDING");
    const current = normalizeBindings(bindings);
    const otherRole = role === "developer" ? "auditor" : "developer";
    if (current[otherRole]?.conversationId === normalized.conversationId) {
      throw new Error("CONVERSATION_ALREADY_BOUND_TO_OTHER_ROLE");
    }
    return { ...current, [role]: normalized };
  }

  function createDragSession() {
    let source = null;
    return Object.freeze({
      start(event) {
        source = fromDragEvent(event);
        return source;
      },
      current() {
        return source;
      },
      clear() {
        source = null;
      },
    });
  }

  globalThis.ChatXAgentBridgeBindings = Object.freeze({
    conversationIdFromHref,
    normalizeConversation,
    fromConversationLink,
    fromDragEvent,
    emptyBindings,
    normalizeBindings,
    bind,
    createDragSession,
  });
})();
