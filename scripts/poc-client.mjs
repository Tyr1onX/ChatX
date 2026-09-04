#!/usr/bin/env node
/**
 * PoC client that behaves like ChatGPT's MCP connector:
 *   1. hit /mcp unauthenticated -> expect 401 + resource metadata
 *   2. discover OAuth metadata
 *   3. dynamic client registration
 *   4. authorization request -> pairing page -> submit pairing code
 *   5. exchange authorization code (PKCE) for tokens
 *   6. call MCP tools (workspace_info, read_file hello.txt)
 *
 * Usage: node scripts/poc-client.mjs <baseUrl> <pairingCode>
 */
import { createHash, randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const [base, pairingCode] = process.argv.slice(2);
if (!base || !pairingCode) {
  console.error("usage: node scripts/poc-client.mjs <baseUrl> <pairingCode>");
  process.exit(1);
}

const REDIRECT_URI = "http://127.0.0.1:19876/callback";
const step = (msg) => console.log(`\n== ${msg}`);

// 1. unauthenticated request must 401
step("1. Unauthenticated /mcp request");
const unauthed = await fetch(`${base}/mcp`, {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 0, method: "tools/list", params: {} }),
});
console.log(`   status: ${unauthed.status} (expected 401)`);
console.log(`   www-authenticate: ${unauthed.headers.get("www-authenticate")?.slice(0, 120)}...`);
if (unauthed.status !== 401) process.exit(2);

// 2. discovery
step("2. OAuth discovery");
const prm = await (await fetch(`${base}/.well-known/oauth-protected-resource/mcp`)).json();
const authServer = prm.authorization_servers[0];
const asMeta = await (await fetch(`${authServer}/.well-known/oauth-authorization-server`)).json();
console.log(`   resource: ${prm.resource}`);
console.log(`   authorization_endpoint: ${asMeta.authorization_endpoint}`);

// 3. DCR
step("3. Dynamic client registration");
const registration = await (
  await fetch(asMeta.registration_endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: "ChatX PoC Client", redirect_uris: [REDIRECT_URI] }),
  })
).json();
console.log(`   client_id: ${registration.client_id}`);

// 4. authorize with pairing code
step("4. Authorization + pairing");
const verifier = randomBytes(32).toString("base64url");
const challenge = createHash("sha256").update(verifier).digest("base64url");
const authorizeUrl = new URL(asMeta.authorization_endpoint);
authorizeUrl.searchParams.set("client_id", registration.client_id);
authorizeUrl.searchParams.set("redirect_uri", REDIRECT_URI);
authorizeUrl.searchParams.set("response_type", "code");
authorizeUrl.searchParams.set("state", randomBytes(8).toString("hex"));
authorizeUrl.searchParams.set("code_challenge", challenge);
authorizeUrl.searchParams.set("code_challenge_method", "S256");
authorizeUrl.searchParams.set("scope", asMeta.scopes_supported.join(" "));

const page = await fetch(authorizeUrl, { redirect: "manual" });
const html = await page.text();
const requestId = html.match(/name="request_id" value="([a-f0-9]+)"/)?.[1];
if (!requestId) {
  console.error("   failed to load authorization page");
  process.exit(2);
}
console.log("   authorization page loaded, submitting pairing code...");
const submit = await fetch(asMeta.authorization_endpoint, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ request_id: requestId, pairing_code: pairingCode }),
  redirect: "manual",
});
if (submit.status !== 302) {
  console.error(`   pairing failed (${submit.status})`);
  process.exit(2);
}
const code = new URL(submit.headers.get("location")).searchParams.get("code");
console.log("   pairing accepted, authorization code received");

// 5. token exchange
step("5. Token exchange (PKCE)");
const tokenResponse = await fetch(asMeta.token_endpoint, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "authorization_code",
    code,
    code_verifier: verifier,
    client_id: registration.client_id,
    redirect_uri: REDIRECT_URI,
  }),
});
const tokens = await tokenResponse.json();
console.log(`   status: ${tokenResponse.status}, access_token: ${tokens.access_token?.slice(0, 12)}..., refresh: ${tokens.refresh_token ? "yes" : "no"}`);
if (!tokens.access_token) process.exit(2);

// 6. MCP calls
step("6. MCP tool calls");
const client = new Client({ name: "chatx-poc", version: "1.0.0" });
await client.connect(
  new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${tokens.access_token}` } },
  })
);
const { tools } = await client.listTools();
console.log(`   tools: ${tools.map((t) => t.name).join(", ")}`);
const info = await client.callTool({ name: "workspace_info", arguments: {} });
console.log(`   workspace_info: ${JSON.parse(info.content[0].text).workspaceName}`);
const hello = await client.callTool({ name: "read_file", arguments: { path: "hello.txt" } });
const helloJson = JSON.parse(hello.content[0].text);
console.log(`   read_file hello.txt -> "${helloJson.content.trim()}"`);
const env = await client.callTool({ name: "read_file", arguments: { path: ".env" } });
console.log(`   read_file .env -> denied: ${env.isError === true}`);
await client.close();

console.log("\nPoC PASSED: full OAuth + pairing + MCP loop works.");
