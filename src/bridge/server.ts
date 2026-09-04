import express, { type Request, type Response, type NextFunction } from "express";
import type { Server } from "node:http";
import { randomBytes } from "node:crypto";
import { Workspace } from "../workspace/manager.js";
import { AuthStore } from "../auth/store.js";
import { createOAuthRouter } from "../auth/oauth.js";
import { bearerAuth } from "../auth/middleware.js";
import { PairingManager } from "../pairing/manager.js";
import { createMcpServer } from "../mcp/server.js";
import { createMcpHttpHandler } from "../mcp/http.js";
import { CloudflaredQuickTunnel } from "../tunnel/cloudflared.js";
import { CloudflaredNamedTunnel } from "../tunnel/cloudflared-named.js";
import type { TunnelProvider } from "../tunnel/provider.js";
import { namedTunnelBinding, readTunnelState } from "../tunnel/state.js";
import { Logger, nullLogger } from "../logger/index.js";
import { DEFAULT_HOST, DEFAULT_PORT } from "../config/paths.js";
import { connectorAction, mcpUrlFromPublic, readLastEndpoint } from "../config/endpoint.js";
import { SERVICE_NAME, VERSION } from "../version.js";
import { writeRuntimeState, clearRuntimeState, probeBridgeHealth, type RuntimeState } from "./runtime.js";
import { BrowserController } from "../browser/controller.js";
import { ProcessSessionManager } from "../process/session-manager.js";

const TUNNEL_RETRY_MIN_MS = 1_000;
const TUNNEL_RETRY_MAX_MS = 30_000;
const TUNNEL_HEALTH_MS = 1_000;

function tunnelForWorkspace(workspaceId: string, logger: Logger): TunnelProvider {
  const binding = namedTunnelBinding(readTunnelState(workspaceId));
  if (binding) {
    return new CloudflaredNamedTunnel({
      tunnelName: binding.tunnelName,
      hostname: binding.hostname,
      logger,
    });
  }
  return new CloudflaredQuickTunnel(logger);
}

export interface BridgeOptions {
  workspaceRoot: string;
  port?: number;
  host?: string;
  logger?: Logger;
  persistRuntime?: boolean;
  authStoreFile?: string;
  pairingTtlMs?: number;
}

export interface Bridge {
  workspace: Workspace;
  port: number;
  host: string;
  adminToken: string;
  authStore: AuthStore;
  pairing: PairingManager;
  tunnel: TunnelProvider;
  localBaseUrl(): string;
  close(): Promise<void>;
}

function listen(app: express.Express, host: string, preferredPort: number): Promise<{ server: Server; port: number }> {
  return new Promise((resolve, reject) => {
    const tryListen = (port: number, allowFallback: boolean): void => {
      const server = app.listen(port, host);
      server.once("listening", () => {
        const address = server.address();
        const actual = typeof address === "object" && address ? address.port : port;
        resolve({ server, port: actual });
      });
      server.once("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "EADDRINUSE" && allowFallback) {
          tryListen(0, false);
        } else {
          reject(error);
        }
      });
    };
    tryListen(preferredPort, preferredPort !== 0);
  });
}

export async function startBridge(opts: BridgeOptions): Promise<Bridge> {
  const logger = opts.logger ?? nullLogger;
  const workspace = new Workspace(opts.workspaceRoot);
  const host = opts.host ?? DEFAULT_HOST;
  if (host !== "127.0.0.1" && host !== "::1" && host !== "localhost") {
    throw new Error("The bridge only binds to loopback addresses. Public exposure goes through the tunnel.");
  }

  const authStore = new AuthStore(workspace.id, { file: opts.authStoreFile });
  const pairing = new PairingManager(workspace.id, { ttlMs: opts.pairingTtlMs });
  const tunnel = tunnelForWorkspace(workspace.id, logger);
  const restoreTunnel = tunnel.name === "cloudflare-named";
  const browser = new BrowserController();
  const processes = new ProcessSessionManager(workspace);
  const adminToken = `c2c_admin_${randomBytes(24).toString("base64url")}`;
  const instanceId = randomBytes(16).toString("base64url");

  let publicBaseUrl: string | null = null;
  let tunnelStartPromise: Promise<string> | null = null;
  let tunnelSupervisorTimer: NodeJS.Timeout | null = null;
  let tunnelRetryDelayMs = TUNNEL_RETRY_MIN_MS;
  let tunnelWanted = restoreTunnel;
  let closed = false;

  const app = express();
  app.set("trust proxy", true);
  app.disable("x-powered-by");

  const getBaseUrl = (req: Request): string => {
    if (publicBaseUrl) return publicBaseUrl;
    const proto = req.protocol;
    const hostHeader = req.get("host") ?? `${host}:${port}`;
    return `${proto}://${hostHeader}`;
  };

  const revokeStaleAuthorizationFor = (url: string): void => {
    const previousMcpUrl = readLastEndpoint(workspace.id)?.mcpUrl;
    const nextMcpUrl = mcpUrlFromPublic(url);
    if (authStore.tokenCount() <= 0 || connectorAction(previousMcpUrl, nextMcpUrl) !== "update") return;
    const count = authStore.revokeAll();
    pairing.invalidateAll();
    logger.info(`Revoked stale connector authorization after public endpoint changed (${count})`);
  };

  const startTunnel = (): Promise<string> => {
    if (tunnelStartPromise) return tunnelStartPromise;
    tunnelStartPromise = (async () => {
      const status = tunnel.status();
      if (status.running && status.url) {
        const health = await probeBridgeHealth(status.url, workspace.id, 8000, instanceId);
        if (health) {
          revokeStaleAuthorizationFor(status.url);
          publicBaseUrl = status.url;
          persistRuntime();
          return status.url;
        }
        await tunnel.stop();
        publicBaseUrl = null;
        persistRuntime();
      }
      const url = await tunnel.start(port);
      if (!closed) {
        revokeStaleAuthorizationFor(url);
        publicBaseUrl = url;
        tunnelRetryDelayMs = TUNNEL_RETRY_MIN_MS;
        persistRuntime();
      }
      return url;
    })().finally(() => {
      tunnelStartPromise = null;
    });
    return tunnelStartPromise;
  };

  const clearTunnelSupervisor = (): void => {
    if (!tunnelSupervisorTimer) return;
    clearTimeout(tunnelSupervisorTimer);
    tunnelSupervisorTimer = null;
  };

  const scheduleTunnelSupervisor = (delayMs: number): void => {
    if (closed || !restoreTunnel || !tunnelWanted || tunnelSupervisorTimer) return;
    tunnelSupervisorTimer = setTimeout(() => {
      tunnelSupervisorTimer = null;
      void superviseTunnel();
    }, delayMs);
    tunnelSupervisorTimer.unref();
  };

  const superviseTunnel = async (): Promise<void> => {
    if (closed || !tunnelWanted) return;
    if (tunnel.status().running) {
      tunnelRetryDelayMs = TUNNEL_RETRY_MIN_MS;
      scheduleTunnelSupervisor(TUNNEL_HEALTH_MS);
      return;
    }
    try {
      await startTunnel();
      tunnelRetryDelayMs = TUNNEL_RETRY_MIN_MS;
      scheduleTunnelSupervisor(TUNNEL_HEALTH_MS);
    } catch (error) {
      const delayMs = tunnelRetryDelayMs;
      tunnelRetryDelayMs = Math.min(tunnelRetryDelayMs * 2, TUNNEL_RETRY_MAX_MS);
      logger.warn(`Tunnel restore failed: ${(error as Error).message}; retrying in ${delayMs}ms`);
      scheduleTunnelSupervisor(delayMs);
    }
  };

  app.get("/health", (_req, res) => {
    res.json({
      service: SERVICE_NAME,
      version: VERSION,
      workspaceId: workspace.id,
      instanceId,
      status: "ok",
    });
  });

  app.use(
    createOAuthRouter({
      store: authStore,
      pairing,
      workspaceName: workspace.name,
      getBaseUrl,
      logger,
    })
  );

  const mcpHandler = createMcpHttpHandler(
    () => createMcpServer({ workspace, logger, browser, processes }),
    logger
  );
  app.all(
    "/mcp",
    express.json({ limit: "8mb" }),
    bearerAuth({ store: authStore, workspaceId: workspace.id, getBaseUrl, logger }),
    (req: Request, res: Response) => {
      void mcpHandler(req, res);
    }
  );

  const adminGuard = (req: Request, res: Response, next: NextFunction): void => {
    const remote = req.socket.remoteAddress ?? "";
    const isLoopback = remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
    const viaProxy = Boolean(req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"]);
    const header = req.headers.authorization ?? "";
    const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
    if (!isLoopback || viaProxy || token !== adminToken) {
      res.status(404).end();
      return;
    }
    next();
  };

  app.post("/admin/pairing", adminGuard, (_req, res) => {
    const session = pairing.create();
    logger.info("Created pairing session");
    res.json({ code: session.code, expiresAt: session.expiresAt });
  });

  app.get("/admin/info", adminGuard, (_req, res) => {
    const tunnelStatus = tunnel.status();
    if (!tunnelStatus.running && publicBaseUrl) {
      publicBaseUrl = null;
      persistRuntime();
    }
    res.json({
      service: SERVICE_NAME,
      version: VERSION,
      workspaceId: workspace.id,
      instanceId,
      workspaceName: workspace.name,
      workspaceRoot: workspace.root,
      port,
      publicUrl: publicBaseUrl,
      tunnel: tunnelStatus,
      tokenCount: authStore.tokenCount(),
      pairingActive: pairing.hasActiveSession(),
      pid: process.pid,
      startedAt,
    });
  });

  app.post("/admin/tunnel/start", adminGuard, (_req, res) => {
    tunnelWanted = true;
    void startTunnel()
      .then((url) => {
        if (restoreTunnel) scheduleTunnelSupervisor(TUNNEL_HEALTH_MS);
        res.json({ url });
      })
      .catch((error: Error) => {
        if (restoreTunnel) scheduleTunnelSupervisor(tunnelRetryDelayMs);
        logger.error(`Tunnel start failed: ${error.message}`);
        res.status(500).json({ error: "tunnel_failed", message: error.message });
      });
  });

  app.post("/admin/tunnel/stop", adminGuard, (_req, res) => {
    tunnelWanted = false;
    clearTunnelSupervisor();
    void tunnel.stop().then(() => {
      publicBaseUrl = null;
      persistRuntime();
      res.json({ stopped: true });
    });
  });

  app.post("/admin/revoke-all", adminGuard, (_req, res) => {
    const count = authStore.revokeAll();
    pairing.invalidateAll();
    logger.info(`Revoked all tokens (${count})`);
    res.json({ revoked: count });
  });

  app.post("/admin/shutdown", adminGuard, (_req, res) => {
    res.json({ shuttingDown: true });
    setTimeout(() => {
      void shutdown().then(() => process.exit(0));
    }, 100);
  });

  const { server, port } = await listen(app, host, opts.port ?? DEFAULT_PORT);
  const startedAt = new Date().toISOString();
  logger.info(`Bridge listening on ${host}:${port} for workspace ${workspace.name} (${workspace.id})`);

  const persistRuntime = (): void => {
    if (opts.persistRuntime === false) return;
    const state: RuntimeState = {
      service: SERVICE_NAME,
      version: VERSION,
      workspaceId: workspace.id,
      workspaceRoot: workspace.root,
      pid: process.pid,
      port,
      adminToken,
      publicUrl: publicBaseUrl,
      startedAt,
      instanceId,
    };
    writeRuntimeState(state);
  };
  persistRuntime();
  if (restoreTunnel) scheduleTunnelSupervisor(0);

  const shutdown = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    tunnelWanted = false;
    clearTunnelSupervisor();
    await tunnel.stop().catch(() => undefined);
    await processes.closeAll();
    await browser.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (opts.persistRuntime !== false) clearRuntimeState(workspace.id);
    logger.info("Bridge stopped");
  };

  return {
    workspace,
    port,
    host,
    adminToken,
    authStore,
    pairing,
    tunnel,
    localBaseUrl: () => `http://${host}:${port}`,
    close: shutdown,
  };
}
