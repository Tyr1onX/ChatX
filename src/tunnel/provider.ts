/**
 * Tunnel abstraction. Business logic never talks to a specific vendor;
 * it only sees this interface. Providers may expose either a public URL
 * (Cloudflare) or an opaque private tunnel id (OpenAI Secure MCP Tunnel).
 */
export interface TunnelStatus {
  running: boolean;
  url: string | null;
  provider: string;
  tunnelId?: string | null;
  ready?: boolean;
  uiUrl?: string;
  detail?: string;
}

export interface TunnelDoctorReport {
  provider: string;
  binaryFound: boolean;
  binaryPath: string | null;
  running: boolean;
  url: string | null;
  tunnelId?: string | null;
  ready?: boolean;
  problems: string[];
}

export interface TunnelProvider {
  readonly name: string;
  /**
   * Start the transport for a local MCP port.
   * Public transports resolve with their base URL; private transports return null.
   */
  start(localPort: number): Promise<string | null>;
  stop(): Promise<void>;
  restart(localPort: number): Promise<string | null>;
  status(): TunnelStatus;
  getPublicUrl(): string | null;
  doctor(): Promise<TunnelDoctorReport>;
}
