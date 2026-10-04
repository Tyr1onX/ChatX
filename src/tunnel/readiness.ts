import { lookup } from "node:dns/promises";

export const CLOUDFLARE_TUNNEL_EDGE_HOSTS = [
  "region1.v2.argotunnel.com",
  "region2.v2.argotunnel.com",
] as const;

type LookupAll = (hostname: string) => Promise<string[]>;

const systemLookupAll: LookupAll = async (hostname) =>
  (await lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);

export function isFakeTunnelIp(address: string): boolean {
  const parts = address.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false;
  const octets = parts.map(Number);
  if (octets.some((part) => part < 0 || part > 255)) return false;
  return octets[0] === 198 && (octets[1] === 18 || octets[1] === 19);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function cloudflareTunnelDnsProblem(
  lookupAll: LookupAll = systemLookupAll
): Promise<string | null> {
  let resolvedAny = false;
  const failures: string[] = [];

  for (const hostname of CLOUDFLARE_TUNNEL_EDGE_HOSTS) {
    try {
      const addresses = await lookupAll(hostname);
      if (addresses.length > 0) resolvedAny = true;
      const fakeIp = addresses.find(isFakeTunnelIp);
      if (fakeIp) {
        return (
          `Cloudflare Tunnel DNS returned Fake-IP ${fakeIp} for ${hostname} (198.18.0.0/15). ` +
          "TUN/Fake-IP DNS is intercepting *.argotunnel.com. " +
          "If you use Shadowrocket, keep `always-real-ip = *.argotunnel.com` in the active configuration."
        );
      }
    } catch (error) {
      failures.push(`${hostname}: ${errorMessage(error)}`);
    }
  }

  if (resolvedAny) return null;

  return (
    `Cloudflare Tunnel edge DNS could not be resolved (${CLOUDFLARE_TUNNEL_EDGE_HOSTS.join(", ")}). ` +
    `Check local DNS/network settings${failures.length > 0 ? `: ${failures.join("; ")}` : "."}`
  );
}