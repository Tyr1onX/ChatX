import path from "node:path";
import fs from "node:fs";
import { getStateDir, readJsonIfExists, writeSecureJson } from "../config/paths.js";
import { connectorDisplayName } from "../config/endpoint.js";

export type ConversationMode = "long-chat" | "project";

export type ConversationReason = "existing-long-chat" | "project" | "new-workspace";

export interface SavedSession {
  url?: string;
  title?: string;
  taskId?: string;
  iteration?: number;
  lastState?: string;
  savedAt: string;
  conversationMode?: ConversationMode;
  projectUrl?: string;
  connectorName?: string;
}

export interface SessionPatch {
  url?: string;
  title?: string;
  taskId?: string;
  iteration?: number;
  lastState?: string;
  conversationMode?: ConversationMode;
  projectUrl?: string;
  connectorName?: string;
}

export interface ConversationView {
  mode: ConversationMode;
  reason: ConversationReason;
  projectUrl: string | null;
  projectReady: boolean;
  chatUrl: string | null;
  connectorName: string | null;
  /** long-chat: Skill may goto chatUrl. project: only if THIS Codex thread already bound it. */
  reuseSavedChat: boolean;
}

export function sessionFile(workspaceId: string): string {
  return path.join(getStateDir(), "sessions", `${workspaceId}.json`);
}

export function readSession(workspaceId: string): SavedSession | null {
  const saved = readJsonIfExists<SavedSession>(sessionFile(workspaceId));
  if (!saved) return null;
  return {
    ...saved,
    title: saved.title?.replace(/^C2C\b/, "ChatX"),
    connectorName: connectorDisplayName(saved.connectorName) ?? undefined,
  };
}

export function writeSession(workspaceId: string, session: SavedSession): SavedSession {
  writeSecureJson(sessionFile(workspaceId), session);
  return session;
}

export function normalizeProjectUrl(url: string): string | null {
  try {
    const parsed = new URL(url.trim());
    if (parsed.hostname !== "chatgpt.com" && parsed.hostname !== "www.chatgpt.com") return null;
    const match = parsed.pathname.match(/^\/g\/(g-p-[a-zA-Z0-9]+)\/project\/?$/);
    if (!match) return null;
    return `https://chatgpt.com/g/${match[1]}/project`;
  } catch {
    return null;
  }
}

export function projectIdFromUrl(url: string): string | null {
  const normalized = normalizeProjectUrl(url);
  if (!normalized) return null;
  return normalized.match(/\/g\/(g-p-[a-zA-Z0-9]+)\/project/)?.[1] ?? null;
}

export function resolveConversation(session: SavedSession | null): ConversationView {
  if (!session) {
    return {
      mode: "project",
      reason: "new-workspace",
      projectUrl: null,
      projectReady: false,
      chatUrl: null,
      connectorName: null,
      reuseSavedChat: false,
    };
  }

  const projectUrl = session.projectUrl ? normalizeProjectUrl(session.projectUrl) : null;
  const projectReady = Boolean(projectUrl);

  if (session.conversationMode === "long-chat") {
    return {
      mode: "long-chat",
      reason: "existing-long-chat",
      projectUrl: null,
      projectReady: false,
      chatUrl: session.url ?? null,
      connectorName: session.connectorName ?? null,
      reuseSavedChat: Boolean(session.url),
    };
  }

  if (session.conversationMode === "project" || projectReady) {
    return {
      mode: "project",
      reason: "project",
      projectUrl,
      projectReady,
      chatUrl: session.url ?? null,
      connectorName: session.connectorName ?? null,
      reuseSavedChat: false,
    };
  }

  return {
    mode: "long-chat",
    reason: "existing-long-chat",
    projectUrl: null,
    projectReady: false,
    chatUrl: session.url ?? null,
    connectorName: session.connectorName ?? null,
    reuseSavedChat: Boolean(session.url),
  };
}

export function mergeSession(previous: SavedSession | null, patch: SessionPatch): SavedSession {
  const conversationMode = patch.conversationMode ?? previous?.conversationMode;
  const rawProjectUrl = patch.projectUrl ?? previous?.projectUrl;
  let projectUrl = rawProjectUrl;
  if (rawProjectUrl) {
    const normalized = normalizeProjectUrl(rawProjectUrl);
    if (!normalized) {
      throw new Error("project URL must look like https://chatgpt.com/g/g-p-…/project");
    }
    projectUrl = normalized;
  }

  if (conversationMode === "project" && !projectUrl && !previous?.projectUrl) {
    throw new Error("project mode requires --project-url");
  }

  const url = patch.url ?? previous?.url;
  const hasChat = Boolean(url);
  const hasProject = Boolean(projectUrl);
  const hasTask = Boolean(patch.taskId ?? previous?.taskId);
  if (!hasChat && !hasProject && conversationMode !== "long-chat" && !hasTask) {
    throw new Error("nothing to save: pass --url, --project-url, or --mode");
  }

  return {
    url,
    title: patch.title ?? previous?.title,
    taskId: patch.taskId ?? previous?.taskId,
    iteration: patch.iteration ?? previous?.iteration,
    lastState: patch.lastState ?? previous?.lastState,
    conversationMode: conversationMode === "project" && projectUrl ? "project" : conversationMode,
    projectUrl,
    connectorName: patch.connectorName ?? previous?.connectorName,
    savedAt: new Date().toISOString(),
  };
}

/** Drop the current chat pointer. Keep Project binding so the collection stays. */
export function clearChatPointer(workspaceId: string): { cleared: boolean; keptProject: boolean } {
  const previous = readSession(workspaceId);
  if (!previous) return { cleared: false, keptProject: false };
  const view = resolveConversation(previous);
  if (view.mode === "project" && view.projectUrl) {
    writeSession(workspaceId, {
      conversationMode: "project",
      projectUrl: view.projectUrl,
      connectorName: previous.connectorName,
      savedAt: new Date().toISOString(),
    });
    return { cleared: true, keptProject: true };
  }
  fs.rmSync(sessionFile(workspaceId), { force: true });
  return { cleared: true, keptProject: false };
}
