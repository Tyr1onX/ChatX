import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { AuthStore } from "../src/auth/store.js";
import { cleanup, makeTmpDir } from "./helpers.js";

const cleanupDirs: string[] = [];

afterEach(() => {
  vi.useRealTimers();
  while (cleanupDirs.length) cleanup(cleanupDirs.pop()!);
});

it("keeps a live refresh authorization after the one-hour access token expires", () => {
  const root = makeTmpDir("auth-lifecycle-live-refresh");
  cleanupDirs.push(root);
  const file = path.join(root, "auth.json");
  const now = new Date("2026-01-01T00:00:00Z");
  vi.useFakeTimers({ now });

  const store = new AuthStore("workspace-live-refresh", { file });
  store.issueTokens({
    clientId: "chatgpt-client",
    scopes: ["workspace.read", "offline_access"],
  });
  expect(store.tokenCount()).toBe(2);

  vi.setSystemTime(new Date(now.getTime() + 2 * 60 * 60 * 1000));
  const restarted = new AuthStore("workspace-live-refresh", { file });

  expect(restarted.tokenCount()).toBe(1);
});

it("loads zero live authorization tokens after more than 30 days of inactivity", () => {
  const root = makeTmpDir("auth-lifecycle-expired-refresh");
  cleanupDirs.push(root);
  const file = path.join(root, "auth.json");
  const now = new Date("2026-01-01T00:00:00Z");
  vi.useFakeTimers({ now });

  const store = new AuthStore("workspace-expired-refresh", { file });
  store.issueTokens({
    clientId: "chatgpt-client",
    scopes: ["workspace.read", "offline_access"],
  });
  expect(store.tokenCount()).toBe(2);

  vi.setSystemTime(new Date(now.getTime() + 31 * 24 * 60 * 60 * 1000));
  const restarted = new AuthStore("workspace-expired-refresh", { file });

  expect(restarted.tokenCount()).toBe(0);
});
