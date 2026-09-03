export interface TunnelStatus {
  running: boolean;
  url: string | null;
  provider: string;
  detail?: string;
}

export interface TunnelProvider {
  readonly name: string;
  start(localPort: number): Promise<string>;
  stop(): Promise<void>;
  status(): TunnelStatus;
}
