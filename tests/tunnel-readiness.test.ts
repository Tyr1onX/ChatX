import { describe, expect, it } from "vitest";
import {
  cloudflareTunnelDnsProblem,
  isFakeTunnelIp,
} from "../src/tunnel/readiness.js";

describe("Cloudflare Tunnel DNS readiness", () => {
  it("detects the 198.18.0.0/15 Fake-IP range without flagging Cloudflare edge IPs", () => {
    expect(isFakeTunnelIp("198.18.0.40")).toBe(true);
    expect(isFakeTunnelIp("198.19.255.255")).toBe(true);
    expect(isFakeTunnelIp("198.20.0.1")).toBe(false);
    expect(isFakeTunnelIp("198.41.200.13")).toBe(false);
    expect(isFakeTunnelIp("2606:4700:a8::1")).toBe(false);
  });

  it("returns an actionable Shadowrocket hint when edge DNS is mapped to Fake-IP", async () => {
    const problem = await cloudflareTunnelDnsProblem(async () => ["198.18.0.40"]);

    expect(problem).toContain("198.18.0.40");
    expect(problem).toContain("198.18.0.0/15");
    expect(problem).toContain("always-real-ip = *.argotunnel.com");
  });

  it("accepts a real edge answer when the other region lookup fails", async () => {
    const problem = await cloudflareTunnelDnsProblem(async (hostname) => {
      if (hostname.startsWith("region1")) throw new Error("temporary lookup failure");
      return ["198.41.200.13"];
    });

    expect(problem).toBeNull();
  });

  it("reports DNS failure only when neither edge hostname resolves", async () => {
    const problem = await cloudflareTunnelDnsProblem(async () => {
      throw new Error("resolver unavailable");
    });

    expect(problem).toContain("could not be resolved");
    expect(problem).toContain("resolver unavailable");
  });
});