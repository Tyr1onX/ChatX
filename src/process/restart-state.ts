export interface RestartConnectionInfo {
  publicUrl: string | null;
  tunnel: {
    running: boolean;
  };
}

const pendingTunnelRestore = new Map<string, boolean>();

export function rememberRestartConnection(workspaceId: string, info: RestartConnectionInfo): void {
  pendingTunnelRestore.set(workspaceId, info.tunnel.running || Boolean(info.publicUrl));
}

export function forgetRestartConnection(workspaceId: string): void {
  pendingTunnelRestore.delete(workspaceId);
}

export function consumeTunnelRestoreIntent(workspaceId: string): boolean {
  const restore = pendingTunnelRestore.get(workspaceId) ?? false;
  pendingTunnelRestore.delete(workspaceId);
  return restore;
}
