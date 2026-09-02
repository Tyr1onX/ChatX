import { describe, expect, it } from "vitest";
import {
  cloudflareTransport,
  localTransport,
  openAITransport,
  transportDisplayTarget,
} from "../src/tunnel/transport.js";

describe("transport descriptors", () => {
  it("represents a public Cloudflare endpoint", () => {
    const transport = cloudflareTransport("cloudflare-named", "https://chatx.example.com");
    expect(transport).toEqual({
      kind: "cloudflare",
      provider: "cloudflare-named",
      publicUrl: "https://chatx.example.com",
      tunnelId: null,
    });
    expect(transportDisplayTarget(transport)).toBe("https://chatx.example.com/mcp");
  });

  it("represents an OpenAI tunnel without inventing a public URL", () => {
    const tunnelId = "tunnel_0123456789abcdef0123456789abcdef";
    const transport = openAITransport(tunnelId);
    expect(transport.publicUrl).toBeNull();
    expect(transport.tunnelId).toBe(tunnelId);
    expect(transportDisplayTarget(transport)).toBe(tunnelId);
  });

  it("rejects malformed OpenAI tunnel ids", () => {
    expect(() => openAITransport("https://example.com/mcp")).toThrow(/invalid/i);
    expect(() => openAITransport("tunnel_ABCDEF0123456789abcdef0123456789")).toThrow(/invalid/i);
  });

  it("keeps local development distinct from remote transports", () => {
    expect(transportDisplayTarget(localTransport())).toBe("localhost");
  });
});
