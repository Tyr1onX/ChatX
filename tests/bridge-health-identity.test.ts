import { afterEach, expect, it, vi } from "vitest";
import { probeBridgeHealth } from "../src/bridge/runtime.js";

const matchingHealth = {
  service: "chatx-bridge",
  version: "test",
  workspaceId: "workspace-a",
  status: "ok",
};

afterEach(() => {
  vi.restoreAllMocks();
});

it("accepts a healthy ChatX bridge for the expected workspace", async () => {
  const fetchMock = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(JSON.stringify(matchingHealth), { status: 200 }));

  await expect(probeBridgeHealth("https://bridge.example/", "workspace-a", 100)).resolves.toEqual(
    matchingHealth
  );
  expect(fetchMock).toHaveBeenCalledWith(
    "https://bridge.example/health",
    expect.objectContaining({ signal: expect.any(AbortSignal) })
  );
});

it("rejects an HTTP 200 response for a different workspace", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ ...matchingHealth, workspaceId: "workspace-b" }), { status: 200 })
  );

  await expect(probeBridgeHealth("https://bridge.example", "workspace-a", 100)).resolves.toBeNull();
});

it("rejects an arbitrary HTTP 200 service", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ ...matchingHealth, service: "other-service" }), { status: 200 })
  );

  await expect(probeBridgeHealth("https://bridge.example", "workspace-a", 100)).resolves.toBeNull();
});

it("rejects a ChatX-shaped response that is not healthy", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ ...matchingHealth, status: "starting" }), { status: 200 })
  );

  await expect(probeBridgeHealth("https://bridge.example", "workspace-a", 100)).resolves.toBeNull();
});
