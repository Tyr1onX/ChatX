import { describe, expect, it } from "vitest";
import {
  consumeTunnelRestoreIntent,
  forgetRestartConnection,
  rememberRestartConnection,
} from "../src/process/restart-state.js";

describe("restart connection state", () => {
  it("preserves an active public connection exactly once", () => {
    rememberRestartConnection("public", {
      publicUrl: "https://demo.trycloudflare.com",
      tunnel: { running: true },
    });

    expect(consumeTunnelRestoreIntent("public")).toBe(true);
    expect(consumeTunnelRestoreIntent("public")).toBe(false);
  });

  it("keeps a local-only restart local", () => {
    rememberRestartConnection("local", {
      publicUrl: null,
      tunnel: { running: false },
    });

    expect(consumeTunnelRestoreIntent("local")).toBe(false);
  });

  it("preserves public intent when the recorded URL exists during a tunnel drop", () => {
    rememberRestartConnection("dropped", {
      publicUrl: "https://old.trycloudflare.com",
      tunnel: { running: false },
    });

    expect(consumeTunnelRestoreIntent("dropped")).toBe(true);
  });

  it("can explicitly forget pending restart state", () => {
    rememberRestartConnection("forgotten", {
      publicUrl: "https://demo.trycloudflare.com",
      tunnel: { running: true },
    });
    forgetRestartConnection("forgotten");

    expect(consumeTunnelRestoreIntent("forgotten")).toBe(false);
  });
});
