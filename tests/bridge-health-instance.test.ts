import { afterEach, expect, it, vi } from "vitest";
import { probeBridgeHealth, writeRuntimeState } from "../src/bridge/runtime.js";
import { cleanup, isolateStateDir } from "./helpers.js";

const cleanupDirs: string[] = [];
const previousStateDir = process.env.C2C_STATE_DIR;

afterEach(() => {
  vi.restoreAllMocks();
  while (cleanupDirs.length) cleanup(cleanupDirs.pop()!);
  if (previousStateDir === undefined) delete process.env.C2C_STATE_DIR;
  else process.env.C2C_STATE_DIR = previousStateDir;
});

it("rejects the same workspace id when the public bridge instance differs", async () => {
  cleanupDirs.push(isolateStateDir());
  writeRuntimeState({
    service: "chatx-bridge",
    version: "test",
    workspaceId: "workspace-a",
    workspaceRoot: "/workspace-a",
    pid: 123,
    port: 3210,
    adminToken: "admin-test",
    publicUrl: "https://bridge.example",
    startedAt: new Date().toISOString(),
    instanceId: "current-instance",
  });

  const fetchMock = vi.spyOn(globalThis, "fetch");
  fetchMock.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        service: "chatx-bridge",
        version: "test",
        workspaceId: "workspace-a",
        instanceId: "different-instance",
        status: "ok",
      }),
      { status: 200 }
    )
  );

  await expect(probeBridgeHealth("https://bridge.example", "workspace-a", 100)).resolves.toBeNull();

  fetchMock.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        service: "chatx-bridge",
        version: "test",
        workspaceId: "workspace-a",
        instanceId: "current-instance",
        status: "ok",
      }),
      { status: 200 }
    )
  );

  await expect(probeBridgeHealth("https://bridge.example", "workspace-a", 100)).resolves.toMatchObject({
    workspaceId: "workspace-a",
    instanceId: "current-instance",
  });
});
