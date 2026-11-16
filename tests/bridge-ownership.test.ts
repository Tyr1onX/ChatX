import { afterEach, expect, it } from "vitest";
import { startBridge, type Bridge } from "../src/bridge/server.js";
import { clearRuntimeState, findLiveBridge, readRuntimeState, writeRuntimeState } from "../src/bridge/runtime.js";
import { cleanup, isolateStateDir, makeTmpDir } from "./helpers.js";

const dirs: string[] = [];
const bridges: Bridge[] = [];
const previous = process.env.C2C_STATE_DIR;
afterEach(async () => {
  while (bridges.length) await bridges.pop()!.close();
  dirs.forEach(cleanup); dirs.length = 0;
  if (previous === undefined) delete process.env.C2C_STATE_DIR;
  else process.env.C2C_STATE_DIR = previous;
});
async function bridge() {
  dirs.push(isolateStateDir());
  const root = makeTmpDir("ownership"); dirs.push(root);
  const b = await startBridge({ workspaceRoot: root, port: 0 }); bridges.push(b);
  return b;
}
it("rejects a second persisted instance of the same workspace", async () => {
  const b = await bridge();
  await expect(startBridge({ workspaceRoot: b.workspace.root, port: 0 })).rejects.toThrow(/lock/i);
  expect((await findLiveBridge(b.workspace.id))?.port).toBe(b.port);
}, 20_000);
it("an old instance cannot remove a replacement's runtime", async () => {
  const b = await bridge();
  const state = readRuntimeState(b.workspace.id)!;
  writeRuntimeState({ ...state, instanceId: "replacement" });
  clearRuntimeState(b.workspace.id, state.instanceId!);
  await b.close();
  expect(readRuntimeState(b.workspace.id)?.instanceId).toBe("replacement");
});
it("does not reuse a healthy port belonging to a different instance", async () => {
  const b = await bridge();
  const state = readRuntimeState(b.workspace.id)!;
  writeRuntimeState({ ...state, instanceId: "stale-instance" });
  expect(await findLiveBridge(b.workspace.id)).toBeNull();
});
it("cold starts again after releasing runtime and lifetime lock", async () => {
  const b = await bridge();
  await b.close();
  expect(readRuntimeState(b.workspace.id)).toBeNull();
  const next = await startBridge({ workspaceRoot: b.workspace.root, port: 0 }); bridges.push(next);
  expect((await findLiveBridge(next.workspace.id))?.instanceId).not.toBeUndefined();
});
