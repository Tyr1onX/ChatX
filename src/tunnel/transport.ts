export type TransportKind = "cloudflare" | "openai" | "local";

export interface TransportDescriptor {
  kind: TransportKind;
  provider: string;
  /** Public MCP base URL for internet-addressable transports such as Cloudflare. */
  publicUrl: string | null;
  /** Opaque OpenAI-hosted tunnel id for private Secure MCP Tunnel connections. */
  tunnelId: string | null;
}

export function cloudflareTransport(provider: string, publicUrl: string): TransportDescriptor {
  const url = new URL(publicUrl);
  if (url.protocol !== "https:") throw new Error("Cloudflare transport requires an HTTPS public URL.");
  return { kind: "cloudflare", provider, publicUrl: url.origin, tunnelId: null };
}

export function openAITransport(tunnelId: string): TransportDescriptor {
  const normalized = tunnelId.trim();
  if (!/^tunnel_[0-9a-f]{32}$/.test(normalized)) {
    throw new Error("Invalid OpenAI tunnel id; expected tunnel_<32 lowercase hexadecimal characters>.");
  }
  return { kind: "openai", provider: "openai-secure-mcp", publicUrl: null, tunnelId: normalized };
}

export function localTransport(): TransportDescriptor {
  return { kind: "local", provider: "local", publicUrl: null, tunnelId: null };
}

export function transportDisplayTarget(transport: TransportDescriptor): string {
  if (transport.publicUrl) return `${transport.publicUrl}/mcp`;
  if (transport.tunnelId) return transport.tunnelId;
  return "localhost";
}
