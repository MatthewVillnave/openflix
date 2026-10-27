import { EventEmitter } from 'node:events';
import type { Socket } from 'node:dgram';
import { afterEach, expect, it, vi } from 'vitest';
import { discoverJellyfin, parseDiscovery } from '../apps/server/src/discovery.js';
const networks = [{ address: '192.168.1.10', netmask: '255.255.255.0' }];
const packet = (Address = 'http://192.168.1.20:8096/jellyfin', Name = 'Living room') =>
  Buffer.from(JSON.stringify({ Address, Name, Id: 'server-1' }));
afterEach(() => vi.useRealTimers());
it('accepts bounded same-subnet sender-owned addresses without trusting names as markup', () => {
  expect(parseDiscovery(packet(), '192.168.1.20', 7359, networks)).toEqual({
    name: 'Living room',
    serverId: 'server-1',
    baseUrl: 'http://192.168.1.20:8096/jellyfin',
  });
  expect(
    parseDiscovery(packet(undefined, '<b>Untrusted</b>'), '192.168.1.20', 7359, networks)?.name,
  ).toBe('<b>Untrusted</b>');
});
it('rejects forged destinations, DNS/redirect URLs, metadata endpoints, invalid packets and nonlocal responders', () => {
  for (const url of [
    'http://127.0.0.1:8096',
    'http://169.254.169.254',
    'http://192.168.1.21',
    'https://attacker.example',
    'http://192.168.1.20@attacker.example',
    'file:///etc/passwd',
    'http://192.168.1.20/?redirect=http://attacker.example',
    'http://192.168.1.20/%2e%2e',
  ])
    expect(parseDiscovery(packet(url), '192.168.1.20', 7359, networks)).toBeUndefined();
  for (const sender of ['192.168.2.20', '8.8.8.8', '127.0.0.1', '::1'])
    expect(parseDiscovery(packet(), sender, 7359, networks)).toBeUndefined();
  expect(parseDiscovery(packet(), '192.168.1.20', 9999, networks)).toBeUndefined();
  expect(parseDiscovery(Buffer.alloc(2049), '192.168.1.20', 7359, networks)).toBeUndefined();
  expect(parseDiscovery(Buffer.from('not json'), '192.168.1.20', 7359, networks)).toBeUndefined();
});
class FakeSocket extends EventEmitter {
  sent: Array<{ text: string; port: number; address: string }> = [];
  closed = 0;
  bind(_port: number, callback: () => void) {
    callback();
  }
  setBroadcast(_value: boolean) {}
  send(bytes: Buffer, port: number, address: string, _callback: () => void) {
    this.sent.push({ text: bytes.toString(), port, address });
  }
  close() {
    this.closed++;
  }
}
it('sends only official broadcast query, deduplicates responses and closes on deadline', async () => {
  vi.useFakeTimers();
  const socket = new FakeSocket();
  const promise = discoverJellyfin(new AbortController().signal, {
    networks,
    socket: () => socket as unknown as Socket,
  });
  expect(socket.sent).toEqual([
    { text: 'Who is JellyfinServer?', port: 7359, address: '192.168.1.255' },
  ]);
  socket.emit('message', packet(), { address: '192.168.1.20', port: 7359 });
  socket.emit('message', packet(), { address: '192.168.1.20', port: 7359 });
  await vi.advanceTimersByTimeAsync(2500);
  expect((await promise).candidates).toHaveLength(1);
  expect(socket.closed).toBe(1);
  expect(vi.getTimerCount()).toBe(0);
});
it('bounds packet floods and discards candidates on cancellation', async () => {
  vi.useFakeTimers();
  const socket = new FakeSocket(),
    controller = new AbortController();
  const promise = discoverJellyfin(controller.signal, {
    networks,
    socket: () => socket as unknown as Socket,
  });
  socket.emit('message', packet(), { address: '192.168.1.20', port: 7359 });
  controller.abort();
  expect((await promise).candidates).toEqual([]);
  expect(socket.closed).toBe(1);
  const flood = new FakeSocket();
  const pending = discoverJellyfin(new AbortController().signal, {
    networks,
    socket: () => flood as unknown as Socket,
  });
  for (let i = 0; i < 129; i++)
    flood.emit('message', Buffer.from('invalid'), { address: '192.168.1.20', port: 7359 });
  await pending;
  expect(flood.closed).toBe(1);
  expect(vi.getTimerCount()).toBe(0);
});
it('does not open sockets without eligible networks and reports socket errors safely', async () => {
  const factory = vi.fn();
  expect(
    (await discoverJellyfin(new AbortController().signal, { networks: [], socket: factory }))
      .unavailable,
  ).toBe(true);
  expect(factory).not.toHaveBeenCalled();
  const socket = new FakeSocket();
  const promise = discoverJellyfin(new AbortController().signal, {
    networks,
    socket: () => socket as unknown as Socket,
  });
  socket.emit('error', new Error('private OS details'));
  expect(await promise).toEqual({ candidates: [], unavailable: true });
  expect(socket.closed).toBe(1);
});
