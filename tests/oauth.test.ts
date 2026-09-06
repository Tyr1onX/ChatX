import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { startBridge, type Bridge } from "../src/bridge/server.js";

import { AuthStore, DEFAULT_SCOPES, MAX_REGISTERED_OAUTH_CLIENTS, filterScopes } from "../src/auth/store.js";
import { makeTmpDir, cleanup, write, isolateStateDir, pkceVerifierAndChallenge } from "./helpers.js";

let root: string;
let bridge: Bridge;
let base: string;

const REDIRECT_URI = "http://127.0.0.1:19999/callback";
const EXPECTED_PENDING_AUTH_LIMIT = 128;

beforeAll(async () => {
  isolateStateDir();
  root = makeTmpDir("oauth-ws");
  write(root, "hello.txt", "hello oauth\n");
  bridge = await startBridge({
    workspaceRoot: root,
    port: 0,
    persistRuntime: false,
    authStoreFile: path.join(makeTmpDir("auth"), "store.json"),
  });
  base = bridge.localBaseUrl();
});

afterAll(async () => {
  await bridge.close();
  cleanup(root);
});

async function registerClient(): Promise<string> {
  bridge.pairing.create();
  const response = await fetch(`${base}/oauth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: "ChatGPT-Test", redirect_uris: [REDIRECT_URI] }),
  });
  expect(response.status).toBe(201);
  const body = (await response.json()) as { client_id: string };
  return body.client_id;
}

async function authorizeWithPairing(
  clientId: string,
  challenge: string,
  pairingCode: string,
  state = "st-123"
): Promise<{ code: string | null; location: string | null; page?: string; status?: number }> {
  const authorizeUrl = new URL(`${base}/oauth/authorize`);
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("code_challenge", challenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  authorizeUrl.searchParams.set("scope", "workspace.read workspace.search git.read execution.read offline_access");

  const pageResponse = await fetch(authorizeUrl, { redirect: "manual" });
  const html = await pageResponse.text();
  const requestId = html.match(/name="request_id" value="([a-f0-9]+)"/)?.[1];
  if (!requestId) return { code: null, location: null, page: html, status: pageResponse.status };

  const postResponse = await fetch(`${base}/oauth/authorize`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ request_id: requestId, pairing_code: pairingCode }),
    redirect: "manual",
  });
  if (postResponse.status !== 302) {
    return { code: null, location: null, page: await postResponse.text(), status: postResponse.status };
  }
  const location = postResponse.headers.get("location");
  const code = location ? new URL(location).searchParams.get("code") : null;
  return { code, location, status: postResponse.status };
}

async function exchangeToken(
  clientId: string,
  code: string,
  verifier: string
): Promise<{ status: number; body: Record<string, string> }> {
  const response = await fetch(`${base}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
    }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, string> };
}

describe("discovery metadata", () => {
  it("serves protected resource metadata", async () => {
    const response = await fetch(`${base}/.well-known/oauth-protected-resource/mcp`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { resource: string; authorization_servers: string[] };
    expect(body.resource).toContain("/mcp");
    expect(body.authorization_servers.length).toBe(1);
  });

  it("serves authorization server metadata with PKCE S256", async () => {
    const response = await fetch(`${base}/.well-known/oauth-authorization-server`);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.code_challenge_methods_supported).toEqual(["S256"]);
    expect(body.grant_types_supported).toEqual(["authorization_code", "refresh_token"]);
    expect(body.registration_endpoint).toContain("/oauth/register");
  });
});

describe("dynamic client registration pairing gate", () => {
  it("rejects registration without an active pairing session", async () => {
    bridge.pairing.invalidateAll();
    const response = await fetch(`${base}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: "No-Pairing", redirect_uris: [REDIRECT_URI] }),
    });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "pairing_required",
      error_description: "An active pairing session is required to register an OAuth client",
    });
  });

  it("allows registration during pairing and keeps the registered client valid afterwards", async () => {
    bridge.pairing.create();
    const response = await fetch(`${base}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: "Pairing-Gated", redirect_uris: [REDIRECT_URI] }),
    });
    expect(response.status).toBe(201);
    const client = (await response.json()) as { client_id: string };

    bridge.pairing.invalidateAll();
    const { challenge } = pkceVerifierAndChallenge();
    const authorizeUrl = new URL(`${base}/oauth/authorize`);
    authorizeUrl.searchParams.set("client_id", client.client_id);
    authorizeUrl.searchParams.set("redirect_uri", REDIRECT_URI);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("code_challenge", challenge);
    authorizeUrl.searchParams.set("code_challenge_method", "S256");

    expect((await fetch(authorizeUrl, { redirect: "manual" })).status).toBe(200);
  });
});

describe("authorization + token flow", () => {
  it("completes the full pairing + PKCE flow and calls MCP", async () => {
    const clientId = await registerClient();
    const { verifier, challenge } = pkceVerifierAndChallenge();
    const pairing = bridge.pairing.create();
    const { code, location } = await authorizeWithPairing(clientId, challenge, pairing.code);
    expect(code).toBeTruthy();
    expect(location).toContain("state=st-123");

    const token = await exchangeToken(clientId, code!, verifier);
    expect(token.status).toBe(200);
    expect(token.body.access_token).toMatch(/^c2c_at_/);
    expect(token.body.refresh_token).toMatch(/^c2c_rt_/);
    expect(token.body.token_type).toBe("Bearer");

    // authorized MCP request
    const mcpResponse = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${token.body.access_token}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      }),
    });
    expect(mcpResponse.status).toBe(200);
  });

  it("rejects a wrong pairing code", async () => {
    const clientId = await registerClient();
    const { challenge } = pkceVerifierAndChallenge();
    bridge.pairing.create();
    const result = await authorizeWithPairing(clientId, challenge, "AAAA-AAAA");
    expect(result.code).toBeNull();
    expect(result.status).toBe(401);
    expect(result.page).toContain("Incorrect pairing code");
  });

  it("escapes the workspace name in the pairing page", async () => {
    const xssWorkspaceRoot = makeTmpDir("oauth-html");
    write(xssWorkspaceRoot, ".c2c.json", JSON.stringify({ name: "<script>alert('xss')</script>" }));
    const xssBridge = await startBridge({
      workspaceRoot: xssWorkspaceRoot,
      port: 0,
      persistRuntime: false,
      authStoreFile: path.join(makeTmpDir("auth-html"), "store.json"),
    });

    try {
      const xssBase = xssBridge.localBaseUrl();
      xssBridge.pairing.create();
      const registration = await fetch(`${xssBase}/oauth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ client_name: "HTML-Test", redirect_uris: [REDIRECT_URI] }),
      });
      expect(registration.status).toBe(201);
      const client = (await registration.json()) as { client_id: string };
      const { challenge } = pkceVerifierAndChallenge();

      const authorizeUrl = new URL(`${xssBase}/oauth/authorize`);
      authorizeUrl.searchParams.set("client_id", client.client_id);
      authorizeUrl.searchParams.set("redirect_uri", REDIRECT_URI);
      authorizeUrl.searchParams.set("response_type", "code");
      authorizeUrl.searchParams.set("code_challenge", challenge);
      authorizeUrl.searchParams.set("code_challenge_method", "S256");

      const response = await fetch(authorizeUrl, { redirect: "manual" });
      expect(response.status).toBe(200);
      const html = await response.text();

      expect(html).not.toContain("<script>alert('xss')</script>");
      expect(html).toContain("&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;");
    } finally {
      await xssBridge.close();
      cleanup(xssWorkspaceRoot);
    }
  });

  it("sets browser security headers on the pairing page", async () => {
    const clientId = await registerClient();
    const { challenge } = pkceVerifierAndChallenge();
    const authorizeUrl = new URL(`${base}/oauth/authorize`);
    authorizeUrl.searchParams.set("client_id", clientId);
    authorizeUrl.searchParams.set("redirect_uri", REDIRECT_URI);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("code_challenge", challenge);
    authorizeUrl.searchParams.set("code_challenge_method", "S256");

    const response = await fetch(authorizeUrl, { redirect: "manual" });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https:; base-uri 'none'; frame-ancestors 'none'"
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
  });

  it("rejects PKCE verifier mismatch", async () => {
    const clientId = await registerClient();
    const { challenge } = pkceVerifierAndChallenge();
    const pairing = bridge.pairing.create();
    const { code } = await authorizeWithPairing(clientId, challenge, pairing.code);
    const token = await exchangeToken(clientId, code!, "wrong-verifier-wrong-verifier-wrong");
    expect(token.status).toBe(400);
    expect(token.body.error).toBe("invalid_grant");
  });

  it("authorization codes are one-time", async () => {
    const clientId = await registerClient();
    const { verifier, challenge } = pkceVerifierAndChallenge();
    const pairing = bridge.pairing.create();
    const { code } = await authorizeWithPairing(clientId, challenge, pairing.code);
    const first = await exchangeToken(clientId, code!, verifier);
    expect(first.status).toBe(200);
    const second = await exchangeToken(clientId, code!, verifier);
    expect(second.status).toBe(400);
  });

  it("requires PKCE at the authorization endpoint", async () => {
    const clientId = await registerClient();
    const authorizeUrl = new URL(`${base}/oauth/authorize`);
    authorizeUrl.searchParams.set("client_id", clientId);
    authorizeUrl.searchParams.set("redirect_uri", REDIRECT_URI);
    authorizeUrl.searchParams.set("response_type", "code");
    const response = await fetch(authorizeUrl, { redirect: "manual" });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("error=invalid_request");
  });

  it("rejects registration with non-https redirect uris", async () => {
    const response = await fetch(`${base}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ redirect_uris: ["http://evil.example.com/cb"] }),
    });
    expect(response.status).toBe(400);
  });
});

describe("scope defaults", () => {
  it("keeps current defaults when scope is missing or empty", () => {
    expect(filterScopes(undefined)).toEqual(DEFAULT_SCOPES);
    expect(filterScopes("   ")).toEqual(DEFAULT_SCOPES);
  });

  it("returns exactly the requested supported scopes", () => {
    expect(filterScopes("workspace.read process.run offline_access")).toEqual([
      "workspace.read",
      "process.run",
      "offline_access",
    ]);
  });

  it("drops unknown scopes without adding permissions", () => {
    expect(filterScopes("workspace.read unknown.scope process.run another.unknown")).toEqual([
      "workspace.read",
      "process.run",
    ]);
  });

  it("returns no scopes for an explicit all-unknown request", () => {
    const scopes = filterScopes("unknown.scope another.unknown");
    expect(scopes).toEqual([]);
    expect(scopes).not.toContain("process.run");
    expect(scopes).not.toContain("workspace.write");
    expect(scopes).not.toContain("browser.control");
  });

  it("does not grant deprecated workspace.control by default", () => {
    const scopes = filterScopes(undefined);
    expect(scopes).toContain("workspace.write");
    expect(scopes).toContain("process.run");
    expect(scopes).toContain("browser.control");
    expect(scopes).not.toContain("workspace.control");
  });

  it("still accepts workspace.control when a legacy client explicitly requests it", () => {
    expect(filterScopes("workspace.read workspace.control")).toEqual(["workspace.read", "workspace.control"]);
  });
});

describe("invalid scope authorization", () => {
  it("fails an explicit all-unknown scope request with invalid_scope", async () => {
    const clientId = await registerClient();
    const { challenge } = pkceVerifierAndChallenge();
    const authorizeUrl = new URL(`${base}/oauth/authorize`);
    authorizeUrl.searchParams.set("client_id", clientId);
    authorizeUrl.searchParams.set("redirect_uri", REDIRECT_URI);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("state", "scope-state");
    authorizeUrl.searchParams.set("code_challenge", challenge);
    authorizeUrl.searchParams.set("code_challenge_method", "S256");
    authorizeUrl.searchParams.set("scope", "unknown.scope another.unknown");

    const response = await fetch(authorizeUrl, { redirect: "manual" });
    expect(response.status).toBe(302);
    const location = response.headers.get("location");
    expect(location).toBeTruthy();
    const redirect = new URL(location!);
    expect(redirect.searchParams.get("error")).toBe("invalid_scope");
    expect(redirect.searchParams.get("state")).toBe("scope-state");
  });
});

describe("pending authorization capacity", () => {
  it("rejects at the hard limit and accepts new requests after expired entries are pruned", async () => {
    const workspaceRoot = makeTmpDir("oauth-pending-ws");
    const authDir = makeTmpDir("oauth-pending-auth");
    const pendingBridge = await startBridge({
      workspaceRoot,
      port: 0,
      persistRuntime: false,
      authStoreFile: path.join(authDir, "store.json"),
    });
    const client = pendingBridge.authStore.registerClient({ clientName: "pending-test", redirectUris: [REDIRECT_URI] });
    expect(client).not.toBeNull();
    const { challenge } = pkceVerifierAndChallenge();
    const authorizeUrl = new URL(`${pendingBridge.localBaseUrl()}/oauth/authorize`);
    authorizeUrl.searchParams.set("client_id", client!.clientId);
    authorizeUrl.searchParams.set("redirect_uri", REDIRECT_URI);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("code_challenge", challenge);
    authorizeUrl.searchParams.set("code_challenge_method", "S256");
    const now = Date.now();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);

    try {
      for (let i = 0; i < EXPECTED_PENDING_AUTH_LIMIT; i += 1) {
        expect((await fetch(authorizeUrl, { redirect: "manual" })).status).toBe(200);
      }

      const limited = await fetch(authorizeUrl, { redirect: "manual" });
      expect(limited.status).toBe(429);
      await expect(limited.json()).resolves.toEqual({
        error: "authorization_limit_reached",
        error_description: "Too many OAuth authorization requests are pending; try again later",
      });

      nowSpy.mockReturnValue(now + 10 * 60_000 + 1);
      expect((await fetch(authorizeUrl, { redirect: "manual" })).status).toBe(200);
    } finally {
      nowSpy.mockRestore();
      await pendingBridge.close();
      cleanup(workspaceRoot);
      cleanup(authDir);
    }
  });
});

describe("dynamic client registration capacity", () => {
  it("enforces the persisted per-workspace hard limit without replacing existing clients", async () => {
    const workspaceRoot = makeTmpDir("oauth-cap-ws");
    const authDir = makeTmpDir("oauth-cap-auth");
    const authFile = path.join(authDir, "store.json");
    const seedStore = new AuthStore("seed-workspace", { file: authFile });
    let existingClientId = "";

    try {
      for (let i = 0; i < MAX_REGISTERED_OAUTH_CLIENTS; i += 1) {
        const client = seedStore.registerClient({ clientName: `seed-${i}`, redirectUris: [REDIRECT_URI] });
        expect(client).not.toBeNull();
        if (i === 0) existingClientId = client!.clientId;
      }

      const before = JSON.parse(fs.readFileSync(authFile, "utf8")) as { clients: unknown[] };
      expect(before.clients).toHaveLength(MAX_REGISTERED_OAUTH_CLIENTS);

      const cappedBridge = await startBridge({
        workspaceRoot,
        port: 0,
        persistRuntime: false,
        authStoreFile: authFile,
      });
      try {
        expect(cappedBridge.authStore.getClient(existingClientId)).toBeTruthy();
        const { challenge } = pkceVerifierAndChallenge();
        const authorizeUrl = new URL(`${cappedBridge.localBaseUrl()}/oauth/authorize`);
        authorizeUrl.searchParams.set("client_id", existingClientId);
        authorizeUrl.searchParams.set("redirect_uri", REDIRECT_URI);
        authorizeUrl.searchParams.set("response_type", "code");
        authorizeUrl.searchParams.set("code_challenge", challenge);
        authorizeUrl.searchParams.set("code_challenge_method", "S256");
        expect((await fetch(authorizeUrl, { redirect: "manual" })).status).toBe(200);
        cappedBridge.pairing.create();
        const rejected = await fetch(`${cappedBridge.localBaseUrl()}/oauth/register`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ client_name: "over-limit", redirect_uris: [REDIRECT_URI] }),
        });
        expect(rejected.status).toBe(429);
        await expect(rejected.json()).resolves.toEqual({
          error: "registration_limit_reached",
          error_description: "OAuth client registration limit reached for this workspace",
        });
      } finally {
        await cappedBridge.close();
      }

      const after = JSON.parse(fs.readFileSync(authFile, "utf8")) as { clients: unknown[] };
      expect(after.clients).toHaveLength(MAX_REGISTERED_OAUTH_CLIENTS);
      const restartedStore = new AuthStore("restart-workspace", { file: authFile });
      expect(restartedStore.getClient(existingClientId)).toBeTruthy();
      expect(restartedStore.registerClient({ clientName: "still-over-limit", redirectUris: [REDIRECT_URI] })).toBeNull();
      expect((JSON.parse(fs.readFileSync(authFile, "utf8")) as { clients: unknown[] }).clients).toHaveLength(
        MAX_REGISTERED_OAUTH_CLIENTS
      );
    } finally {
      cleanup(workspaceRoot);
      cleanup(authDir);
    }
  });
});

describe("token enforcement on /mcp", () => {
  const mcpCall = (token?: string): Promise<Response> =>
    fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });

  it("401 without a token, with resource metadata pointer", async () => {
    const response = await mcpCall();
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("resource_metadata");
  });

  it("401 with an invalid token", async () => {
    const response = await mcpCall("c2c_at_totally-invalid");
    expect(response.status).toBe(401);
  });

  it("401 with an expired token", async () => {
    const expired = bridge.authStore.issueTokens({
      clientId: "test",
      scopes: ["workspace.read"],
      accessTtlMs: -1000,
    });
    const response = await mcpCall(expired.accessToken);
    expect(response.status).toBe(401);
  });

  it("403 with a token bound to another workspace", async () => {
    const foreign = bridge.authStore.issueTokens({
      clientId: "test",
      scopes: ["workspace.read"],
      workspaceId: "deadbeef0000",
    });
    const response = await mcpCall(foreign.accessToken);
    expect(response.status).toBe(403);
  });

  it("401 after revocation", async () => {
    const tokens = bridge.authStore.issueTokens({ clientId: "test", scopes: ["workspace.read"] });
    expect((await mcpCall(tokens.accessToken)).status).toBe(200);
    bridge.authStore.revokeToken(tokens.accessToken);
    expect((await mcpCall(tokens.accessToken)).status).toBe(401);
  });
});

describe("refresh token rotation", () => {
  it("rotates refresh tokens and invalidates the old one", async () => {
    const clientId = await registerClient();
    const { verifier, challenge } = pkceVerifierAndChallenge();
    const pairing = bridge.pairing.create();
    const { code } = await authorizeWithPairing(clientId, challenge, pairing.code);
    const initial = await exchangeToken(clientId, code!, verifier);

    const refresh = async (refreshToken: string): Promise<{ status: number; body: Record<string, string> }> => {
      const response = await fetch(`${base}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId }),
      });
      return { status: response.status, body: (await response.json()) as Record<string, string> };
    };

    const rotated = await refresh(initial.body.refresh_token);
    expect(rotated.status).toBe(200);
    expect(rotated.body.refresh_token).not.toBe(initial.body.refresh_token);

    const replayed = await refresh(initial.body.refresh_token);
    expect(replayed.status).toBe(400);
  });
});
