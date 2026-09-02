import path from "node:path";
import { getStateDir, readJsonIfExists, writeSecureJson } from "../config/paths.js";

export type TunnelPreference = "unset" | "quick" | "named" | "openai";

export interface TunnelState {
  workspaceId: string;
  preference: TunnelPreference;
  askedAt?: string;
  provider?: "cloudflare-quick" | "cloudflare-named" | "openai-secure-mcp";
  tunnelName?: string;
  tunnelId?: string;
  hostname?: string;
  zone?: string;
  openaiAlias?: string;
  runtimeKeyEnv?: string;
  openaiProxyUrl?: string;
  configuredAt?: string;
  fallbackReason?: string;
}

export function tunnelStateFile(workspaceId: string): string {
  return path.join(getStateDir(), "tunnels", `${workspaceId}.json`);
}

export function readTunnelState(workspaceId: string): TunnelState {
  return (
    readJsonIfExists<TunnelState>(tunnelStateFile(workspaceId)) ?? {
      workspaceId,
      preference: "unset",
    }
  );
}

export function writeTunnelState(state: TunnelState): TunnelState {
  writeSecureJson(tunnelStateFile(state.workspaceId), state);
  return state;
}

export function needsTunnelChoice(state: TunnelState): boolean {
  return state.preference === "unset" || !state.askedAt;
}

export function isNamedTunnelReady(state: TunnelState): boolean {
  return (
    state.preference === "named" &&
    Boolean(state.tunnelName?.trim()) &&
    Boolean(state.hostname?.trim())
  );
}

export function namedTunnelBinding(state: TunnelState): { tunnelName: string; hostname: string } | null {
  if (!isNamedTunnelReady(state) || !state.tunnelName || !state.hostname) return null;
  return { tunnelName: state.tunnelName, hostname: state.hostname };
}

export function isOpenAITunnelReady(state: TunnelState): boolean {
  return (
    state.preference === "openai" &&
    /^tunnel_[0-9a-f]{32}$/.test(state.tunnelId ?? "") &&
    Boolean(state.openaiAlias?.trim()) &&
    Boolean(state.runtimeKeyEnv?.trim())
  );
}

export function openAITunnelBinding(
  state: TunnelState
): { tunnelId: string; alias: string; runtimeKeyEnv: string; proxyUrl?: string } | null {
  if (!isOpenAITunnelReady(state) || !state.tunnelId || !state.openaiAlias || !state.runtimeKeyEnv) return null;
  return {
    tunnelId: state.tunnelId,
    alias: state.openaiAlias,
    runtimeKeyEnv: state.runtimeKeyEnv,
    proxyUrl: state.openaiProxyUrl,
  };
}

export function chooseOpenAITunnel(opts: {
  workspaceId: string;
  tunnelId: string;
  alias?: string;
  runtimeKeyEnv?: string;
  proxyUrl?: string;
}): TunnelState {
  const tunnelId = opts.tunnelId.trim();
  if (!/^tunnel_[0-9a-f]{32}$/.test(tunnelId)) {
    throw new Error("OpenAI tunnel id must match tunnel_<32 lowercase hexadecimal characters>.");
  }
  const alias = (opts.alias ?? `chatx-${opts.workspaceId.slice(0, 12)}`).trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(alias)) {
    throw new Error("OpenAI tunnel alias is invalid.");
  }
  const runtimeKeyEnv = (opts.runtimeKeyEnv ?? "CONTROL_PLANE_API_KEY").trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(runtimeKeyEnv)) {
    throw new Error("Runtime API key environment variable name is invalid.");
  }
  let openaiProxyUrl: string | undefined;
  if (opts.proxyUrl?.trim()) {
    let parsed: URL;
    try {
      parsed = new URL(opts.proxyUrl.trim());
    } catch {
      throw new Error("OpenAI tunnel proxy URL is invalid.");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("OpenAI tunnel proxy must use http:// or https://.");
    }
    if (parsed.username || parsed.password) {
      throw new Error("Proxy credentials must not be persisted in ChatX tunnel state.");
    }
    openaiProxyUrl = parsed.origin;
  }
  const now = new Date().toISOString();
  return writeTunnelState({
    workspaceId: opts.workspaceId,
    preference: "openai",
    askedAt: now,
    provider: "openai-secure-mcp",
    tunnelId,
    openaiAlias: alias,
    runtimeKeyEnv,
    openaiProxyUrl,
    configuredAt: now,
  });
}

export const TUNNEL_CHOICE_PROMPT = `连 ChatGPT 之前，有一条可选的。
你有没有 Cloudflare 账号，并且有没有一个域名已经加在 Cloudflare 里？
- 有：可以用固定域名。插件配一次，以后电脑重启一般不用再改插件。要登录一次 Cloudflare，并在你的域名下加一个子域名。
- 没有：用临时地址。不用注册，功能一样。但电脑重启后地址常会变，ChatGPT 里的旧地址会失效。我会自己删掉这个项目的插件、用新地址再加回去，你偶尔要再登一下 ChatGPT。能修好，只是更慢。
没有账号也完全能用。你选哪个？如果有域名，直接告诉我域名（例如 example.com）。`;

export const NAMED_LOGIN_PROMPT =
  "会弹出浏览器，请登录 Cloudflare 并选中你的域名，完成后告诉我「好了」。";

export const NAMED_FALLBACK_MESSAGE =
  "这次先用临时地址。功能一样，以后修连接可能会更慢。想改成固定域名时再说一声。";

export const NAMED_REPAIR_MESSAGE =
  "固定域名暂时连不上。请在即将弹出的窗口登录 Cloudflare，选中你的域名，完成后告诉我「好了」。";
