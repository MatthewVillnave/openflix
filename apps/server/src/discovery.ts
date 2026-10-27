import { createSocket, type Socket } from 'node:dgram';
import { networkInterfaces } from 'node:os';
import { isIP } from 'node:net';
import { validateJellyfinUrl } from '@openflix/connector-jellyfin';
export interface DiscoveryCandidate {
  name: string;
  serverId: string;
  baseUrl: string;
}
export interface DiscoveryNetwork {
  address: string;
  netmask: string;
}
const number = (ip: string) => ip.split('.').reduce((n, part) => (n * 256 + Number(part)) >>> 0, 0);
const privateAddress = (ip: string) =>
  isIP(ip) === 4 &&
  (/^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip));
function eligible(net: DiscoveryNetwork) {
  if (!privateAddress(net.address) || isIP(net.netmask) !== 4) return false;
  const mask = number(net.netmask),
    inverse = ~mask >>> 0;
  return mask !== 0 && inverse > 1 && (inverse & (inverse + 1)) === 0;
}
export function parseDiscovery(
  bytes: Buffer,
  sender: string,
  port: number,
  networks: DiscoveryNetwork[],
): DiscoveryCandidate | undefined {
  if (
    bytes.length > 2048 ||
    port !== 7359 ||
    !privateAddress(sender) ||
    !networks.some(
      (n) =>
        eligible(n) &&
        (number(sender) & number(n.netmask)) === (number(n.address) & number(n.netmask)),
    )
  )
    return;
  try {
    const data = JSON.parse(bytes.toString('utf8'));
    if (
      typeof data.Name !== 'string' ||
      !data.Name.trim() ||
      data.Name.length > 128 ||
      /[\u0000-\u001f\u007f]/.test(data.Name) ||
      typeof data.Id !== 'string' ||
      !/^[a-zA-Z0-9-]{1,128}$/.test(data.Id) ||
      typeof data.Address !== 'string'
    )
      return;
    const baseUrl = validateJellyfinUrl(data.Address);
    // Discovery is not authority to contact another host, resolve DNS, or follow redirects.
    if (new URL(baseUrl).hostname !== sender) return;
    return { name: data.Name.trim(), serverId: data.Id, baseUrl };
  } catch {
    return;
  }
}
/** One official UDP query per eligible interface, no HTTP probes or credentials. */
export async function discoverJellyfin(
  signal: AbortSignal,
  dependencies: { networks?: DiscoveryNetwork[]; socket?: () => Socket } = {},
): Promise<{ candidates: DiscoveryCandidate[]; unavailable: boolean }> {
  const networks = (
    dependencies.networks ??
    Object.values(networkInterfaces()).flatMap((list) =>
      (list ?? []).filter((n) => !n.internal && n.family === 'IPv4'),
    )
  )
    .filter(eligible)
    .slice(0, 8);
  if (!networks.length || signal.aborted) return { candidates: [], unavailable: true };
  return new Promise((resolve) => {
    const socket = (dependencies.socket ?? (() => createSocket('udp4')))();
    const candidates = new Map<string, DiscoveryCandidate>();
    let done = false,
      messages = 0;
    const finish = (unavailable = false) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      try {
        socket.close();
      } catch {
        /* Already closed/not bound. */
      }
      resolve({ candidates: signal.aborted ? [] : [...candidates.values()], unavailable });
    };
    const abort = () => finish(true);
    const timer = setTimeout(() => finish(), 2500);
    signal.addEventListener('abort', abort, { once: true });
    socket.on('error', () => finish(true));
    socket.on('message', (bytes, peer) => {
      if (done) return;
      if (++messages > 128) return finish();
      const candidate = parseDiscovery(bytes, peer.address, peer.port, networks);
      if (candidate) candidates.set(candidate.baseUrl, candidate);
      if (candidates.size >= 16) finish();
    });
    try {
      socket.bind(0, () => {
        if (done) return;
        try {
          socket.setBroadcast(true);
          for (const net of networks) {
            const broadcast = (number(net.address) | ~number(net.netmask)) >>> 0;
            const address = [24, 16, 8, 0].map((shift) => (broadcast >>> shift) & 255).join('.');
            socket.send(Buffer.from('Who is JellyfinServer?'), 7359, address, (error) => {
              if (error) finish(true);
            });
          }
        } catch {
          finish(true);
        }
      });
    } catch {
      finish(true);
    }
  });
}
