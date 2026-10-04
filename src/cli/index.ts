import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { startBridge } from "../bridge/server.js";
import {
  clearRuntimeState,
  findLiveBridge,
  probeBridge,
  probeBridgeHealth,
  readRuntimeState,
  type RuntimeState,
} from "../bridge/runtime.js";
import { adminFetch, ensureBridge, stopBridge } from "../process/daemon.js";
import { Workspace } from "../workspace/manager.js";
import { migrateWorkspaceDirectory } from "../workspace/migration.js";
import { AuthStore } from "../auth/store.js";
import { appendExecutionRecord } from "../execution/records.js";
import { detectTunnelBinaries } from "../tunnel/detect.js";
import { cloudflareTunnelDnsProblem } from "../tunnel/readiness.js";
import {
  chooseQuickTunnel,
  hasCloudflaredCert,
  ProcessCloudflaredAccount,
  provisionNamedTunnel,
} from "../tunnel/named-provision.js";
import { parseZoneInput, suggestedNamedHostname } from "../tunnel/hostname.js";
import {
  isNamedTunnelReady,
  NAMED_LOGIN_PROMPT,
  NAMED_REPAIR_MESSAGE,
  needsTunnelChoice,
  readTunnelState,
  TUNNEL_CHOICE_PROMPT,
} from "../tunnel/state.js";
import { Logger } from "../logger/index.js";
import { getStateDir } from "../config/paths.js";
import { ensureSandboxAllowlist, getCodexConfigPath, isStateDirAllowlisted } from "../config/sandbox-allow.js";
import {
  CHATGPT_CREATE_CONNECTOR_URL,
  CHATGPT_PLUGINS_URL,
  actionsRefreshDecision,
  brandMigrationUserMessage,
  connectorNameFor,
  connectorNeedsBrandMigration,
  connectorRepairDecision,
  confirmConnectorEndpoint,
  LEGACY_CONNECTOR_NAME,
  mcpUrlFromPublic,
  normalizePublicUrl,
  readLastEndpoint,
  reclaimUserMessage,
  reauthorizeUserMessage,
  writeLastEndpoint,
  type LastEndpoint,
} from "../config/endpoint.js";
import { PRODUCT_NAME, TOOLSET_VERSION, VERSION } from "../version.js";
import {
  clearChatPointer,
  mergeSession,
  readSession,
  resolveConversation,
  writeSession,
  type ConversationMode,
} from "../session/state.js";

const program = new Command();

const say = (msg: string): void => {
  process.stdout.write(msg + "\n");
};
const check = (msg: string): void => say(`✓ ${msg}`);
const cross = (msg: string): void => say(`✗ ${msg}`);

function resolveWorkspace(option?: string): string {
  return path.resolve(option ?? process.cwd());
}

function persistWorkspaceEndpoint(opts: {
  workspaceId: string;
  workspaceName: string;
  port: number;
  publicUrl: string | null;
  mcpUrl: string;
  previous?: LastEndpoint | null;
}): string {
  const previous = opts.previous ?? readLastEndpoint(opts.workspaceId);
  const connectorName = connectorNameFor({
    workspaceName: opts.workspaceName,
    workspaceId: opts.workspaceId,
    previousName: previous?.connectorName,
    hadEndpointBefore: Boolean(previous),
  });
  writeLastEndpoint({
    workspaceId: opts.workspaceId,
    port: opts.port,
    publicUrl: opts.publicUrl,
    mcpUrl: opts.mcpUrl,
    connectorMcpUrl: previous ? previous.connectorMcpUrl ?? previous.mcpUrl : opts.mcpUrl,
    connectorName: previous ? previous.connectorName : connectorName,
    actionsVersion: previous ? previous.actionsVersion : TOOLSET_VERSION,
  });
  return connectorName;
}

function tunnelChoicePayload(workspace: Workspace, zoneHint?: string): Record<string, unknown> {
  const state = readTunnelState(workspace.id);
  const zone = parseZoneInput(zoneHint ?? "") ?? state.zone ?? null;
  return {
    ok: true,
    needsChoice: needsTunnelChoice(state),
    preference: state.preference,
    loggedIn: hasCloudflaredCert(),
    namedReady: isNamedTunnelReady(state),
    zone,
    hostname: state.hostname ?? null,
    suggestedHostname: zone ? suggestedNamedHostname(zone, workspace.name, workspace.id) : null,
    userPrompt: needsTunnelChoice(state) ? TUNNEL_CHOICE_PROMPT : undefined,
    loginPrompt: NAMED_LOGIN_PROMPT,
    fallbackReason: state.fallbackReason,
  };
}

function trySandboxAllow():
  | { ok: true; added: boolean; alreadyAllowed: boolean; stateDir: string; configPath: string }
  | { ok: false; added: false; alreadyAllowed: false; error: string } {
  try {
    const result = ensureSandboxAllowlist();
    return { ok: true, ...result };
  } catch (error) {
    return { ok: false, added: false, alreadyAllowed: false, error: (error as Error).message };
  }
}

interface TunnelStartResponse {
  url?: string;
  error?: string;
  message?: string;
}

interface PairingResponse {
  code: string;
  expiresAt: number;
}

interface AdminInfo {
  workspaceId: string;
  workspaceName: string;
  workspaceRoot: string;
  port: number;
  publicUrl: string | null;
  tunnel: { running: boolean; url: string | null; provider: string; ready?: boolean; detail?: string };
  tokenCount: number;
  pairingActive: boolean;
  pid: number;
  startedAt: string;
}

async function ensureBridgeAndTunnel(
  workspaceRoot: string,
  opts: { tunnel: boolean }
): Promise<{ runtime: RuntimeState; info: AdminInfo; mcpUrl: string | null }> {
  const { runtime } = await ensureBridge(workspaceRoot);
  let info = await adminFetch<AdminInfo>(runtime, "GET", "/admin/info");
  let mcpUrl: string | null = info.publicUrl ? `${info.publicUrl}/mcp` : null;
  if (opts.tunnel && !info.publicUrl) {
    const binaries = detectTunnelBinaries();
    if (!binaries.cloudflared) {
      throw new Error(
        "NEED_CLOUDFLARED: cloudflared is not installed. Install it first (macOS: brew install cloudflared)."
      );
    }
    const result = await adminFetch<TunnelStartResponse>(runtime, "POST", "/admin/tunnel/start", 90_000);
    if (!result.url) throw new Error(result.message ?? "Tunnel start failed");
    info = await adminFetch<AdminInfo>(runtime, "GET", "/admin/info");
    mcpUrl = `${result.url}/mcp`;
  }
  return { runtime, info, mcpUrl };
}

program
  .name("chatx")
  .description(`${PRODUCT_NAME} — local capabilities for ChatGPT over MCP.`)
  .version(VERSION, "-v, --version")
  .configureHelp({ sortSubcommands: true });

// ---------------------------------------------------------------- serve (internal)

program
  .command("serve", { hidden: true })
  .description("Run the bridge in the foreground (internal)")
  .requiredOption("--workspace <path>")
  .option("--port <port>", "preferred port")
  .action(async (opts: { workspace: string; port?: string }) => {
    const logger = new Logger({ name: "bridge", console: true });
    const bridge = await startBridge({
      workspaceRoot: resolveWorkspace(opts.workspace),
      port: opts.port ? parseInt(opts.port, 10) : undefined,
      logger,
    });
    const shutdown = (): void => {
      void bridge.close().then(() => process.exit(0));
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    say(`bridge ready on ${bridge.localBaseUrl()} (workspace ${bridge.workspace.name})`);
  });

// ---------------------------------------------------------------- start

program
  .command("start")
  .description("Start (or reuse) the bridge for this workspace")
  .option("-w, --workspace <path>", "workspace root (defaults to current directory)")
  .option("--tunnel", "also establish the secure public connection", false)
  .option("--json", "machine-readable output", false)
  .action(async (opts: { workspace?: string; tunnel: boolean; json: boolean }) => {
    const root = resolveWorkspace(opts.workspace);
    try {
      const { runtime, info, mcpUrl } = await ensureBridgeAndTunnel(root, { tunnel: opts.tunnel });
      const connectorName = mcpUrl
        ? persistWorkspaceEndpoint({
            workspaceId: info.workspaceId,
            workspaceName: info.workspaceName,
            port: runtime.port,
            publicUrl: info.publicUrl,
            mcpUrl,
          })
        : readLastEndpoint(info.workspaceId)?.connectorName;
      if (opts.json) {
        say(JSON.stringify({ ok: true, port: runtime.port, workspaceId: info.workspaceId, mcpUrl, connectorName }));
        return;
      }
      check(`当前项目已识别（${info.workspaceName}）`);
      check("Workspace Bridge 已启动");
      if (mcpUrl) check("安全连接已建立");
    } catch (error) {
      handleCliError(error, opts.json);
    }
  });

// ---------------------------------------------------------------- setup

program
  .command("setup")
  .description("First-time setup: bridge + secure connection + pairing code")
  .option("-w, --workspace <path>")
  .option("--no-tunnel", "local-only setup (development)")
  .option("--json", "machine-readable output", false)
  .action(async (opts: { workspace?: string; tunnel: boolean; json: boolean }) => {
    const root = resolveWorkspace(opts.workspace);
    try {
      if (!opts.json) {
        say(PRODUCT_NAME);
        say("");
        say("正在连接 ChatGPT…");
        say("");
      }
      const sandbox = trySandboxAllow();
      const { runtime, info, mcpUrl } = await ensureBridgeAndTunnel(root, { tunnel: opts.tunnel });
      const connectorName = mcpUrl
        ? persistWorkspaceEndpoint({
            workspaceId: info.workspaceId,
            workspaceName: info.workspaceName,
            port: runtime.port,
            publicUrl: info.publicUrl,
            mcpUrl,
          })
        : connectorNameFor({
            workspaceName: info.workspaceName,
            workspaceId: info.workspaceId,
            previousName: readLastEndpoint(info.workspaceId)?.connectorName,
            hadEndpointBefore: Boolean(readLastEndpoint(info.workspaceId)),
          });
      const pairingResult = await adminFetch<PairingResponse>(runtime, "POST", "/admin/pairing");
      const tunnelState = readTunnelState(info.workspaceId);
      if (opts.json) {
        say(
          JSON.stringify({
            ok: true,
            workspaceId: info.workspaceId,
            workspaceName: info.workspaceName,
            connectorName,
            mcpUrl: mcpUrl ?? `http://127.0.0.1:${runtime.port}/mcp`,
            local: mcpUrl === null,
            pairingCode: pairingResult.code,
            pairingExpiresAt: pairingResult.expiresAt,
            sandbox,
            tunnel: {
              mode: isNamedTunnelReady(tunnelState) ? "named" : "quick",
              hostname: tunnelState.hostname ?? null,
              fallback: Boolean(tunnelState.fallbackReason),
            },
          })
        );
        return;
      }
      check(`当前项目已识别（${info.workspaceName}）`);
      check("Workspace Bridge 已启动");
      if (mcpUrl) check("安全连接已建立");
      say("");
      say(`连接地址：${mcpUrl ?? `http://127.0.0.1:${runtime.port}/mcp`}`);
      say(`配对码：${pairingResult.code}（${Math.round((pairingResult.expiresAt - Date.now()) / 60000)} 分钟内有效）`);
      say("");
      say("下一步：在 ChatGPT 的连接器设置中添加以上地址（OAuth），并在授权页输入配对码。");
      say("如果你在使用 Codex Skill，这一步会自动完成。");
    } catch (error) {
      handleCliError(error, opts.json);
    }
  });

// ---------------------------------------------------------------- stop / restart

program
  .command("stop")
  .description("Stop the bridge for this workspace")
  .option("-w, --workspace <path>")
  .action(async (opts: { workspace?: string }) => {
    const stopped = await stopBridge(resolveWorkspace(opts.workspace));
    if (stopped) check("Bridge 已停止");
    else say("没有正在运行的 Bridge。");
  });

program
  .command("restart")
  .description("Restart the bridge for this workspace")
  .option("-w, --workspace <path>")
  .option("--tunnel", "re-establish the secure public connection", false)
  .action(async (opts: { workspace?: string; tunnel: boolean }) => {
    const root = resolveWorkspace(opts.workspace);
    await stopBridge(root);
    await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      const { info, mcpUrl } = await ensureBridgeAndTunnel(root, { tunnel: opts.tunnel });
      check(`Bridge 已重启（${info.workspaceName}）`);
      if (mcpUrl) check(`安全连接已建立`);
    } catch (error) {
      handleCliError(error, false);
    }
  });

// ---------------------------------------------------------------- status

program
  .command("status")
  .description("Show bridge status for this workspace")
  .option("-w, --workspace <path>")
  .option("--json", "machine-readable output", false)
  .action(async (opts: { workspace?: string; json: boolean }) => {
    const root = resolveWorkspace(opts.workspace);
    const workspace = new Workspace(root);
    const runtime = await findLiveBridge(workspace.id);
    if (!runtime) {
      if (opts.json) say(JSON.stringify({ ok: false, running: false }));
      else say("Bridge 未运行。使用 `chatx start` 启动。");
      return;
    }
    const info = await adminFetch<AdminInfo>(runtime, "GET", "/admin/info");
    if (opts.json) {
      say(JSON.stringify({ ok: true, running: true, ...info }));
      return;
    }
    say(PRODUCT_NAME);
    say("");
    check(`Workspace：${info.workspaceName}`);
    check(`Bridge：运行中（端口 ${info.port}）`);
    const tunnelReady = info.tunnel.ready ?? Boolean(info.publicUrl);
    if (tunnelReady && info.publicUrl) {
      check(`安全连接：${info.publicUrl}/mcp`);
    } else if (info.tunnel.running || info.tunnel.detail) {
      const dnsProblem = await cloudflareTunnelDnsProblem();
      cross(`安全连接：不可用（${dnsProblem ?? info.tunnel.detail ?? "公网 /health 检查失败"}）`);
    } else {
      say("· 安全连接：未启用（本地模式）");
    }
    say(`· 已授权连接：${info.tokenCount > 0 ? "是" : "否"}`);
  });

// ---------------------------------------------------------------- doctor

program
  .command("doctor")
  .description("Diagnose and auto-repair the connection")
  .option("-w, --workspace <path>")
  .option("--no-fix", "diagnose only, do not repair")
  .option("--json", "machine-readable output", false)
  .action(async (opts: { workspace?: string; fix: boolean; json: boolean }) => {
    const root = resolveWorkspace(opts.workspace);
    const report: Record<string, { ok: boolean; detail?: string }> = {};
    const results: string[] = [];

    const nodeMajor = parseInt(process.versions.node.split(".")[0], 10);
    report.node = { ok: nodeMajor >= 20, detail: `v${process.versions.node}` };

    if (opts.fix) {
      const sandbox = trySandboxAllow();
      if (sandbox.ok) {
        report.sandbox = { ok: true, detail: sandbox.alreadyAllowed ? "已在白名单" : "已写入白名单" };
        if (sandbox.added) results.push("已将本地设置目录加入 Codex 沙箱白名单");