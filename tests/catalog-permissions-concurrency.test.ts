import { afterEach, expect, it, vi } from 'vitest';
import { catalogPermissions } from '../apps/server/src/catalog-permissions.js';
const state = vi.hoisted(() => ({ active: 0, peak: 0, calls: [] as string[], delay: 25 }));
afterEach(() => {
  state.active = 0;
  state.peak = 0;
  state.calls = [];
  state.delay = 25;
});
function setup() {
  const users = new Set(['a', 'b']);
  const connections = new Set(['a', 'b']);
  const db = {
    forUser: (owner: string) => ({
      catalog: { item: (id: string) => ({ connectorId: owner, upstreamId: id }) },
      getConnector: () =>
        connections.has(owner) ? { id: owner, baseUrl: 'https://fixture.invalid' } : undefined,
    }),
  };
  const auth = { currentUser: (token: string) => (users.has(token) ? { id: token } : undefined) };
  const vault = { forUser: (owner: string) => owner };
  return {
    users,
    connections,
    verify: catalogPermissions(
      db as never,
      auth as never,
      vault as never,
      ((_record: unknown, owner: string) => ({
        getItem: async () => {
          state.calls.push(owner);
          state.active++;
          state.peak = Math.max(state.peak, state.active);
          await new Promise((r) => setTimeout(r, state.delay));
          state.active--;
        },
      })) as never,
    ),
  };
}
const page = { items: Array.from({ length: 8 }, (_, i) => ({ id: String(i) })) };
it('queues overlapping initial shelves without dropping a series request or exceeding 12 checks', async () => {
  const { verify } = setup();
  const results = await Promise.allSettled(Array.from({ length: 5 }, () => verify('a', page)));
  expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
  expect(state.calls).toHaveLength(40);
  expect(state.peak).toBeLessThanOrEqual(12);
});
it('rechecks account authority after waiting and never starts revoked-owner work', async () => {
  const { verify, users } = setup();
  state.delay = 75;
  const first = Array.from({ length: 3 }, () => verify('a', page));
  await vi.waitFor(() => expect(state.active).toBe(12));
  const queued = verify('b', page);
  const outcome = queued.catch((e) => e);
  users.delete('b');
  await Promise.all(first);
  expect(await outcome).toMatchObject({ code: 'cancelled' });
  expect(state.calls).not.toContain('b');
  await expect(verify('a', page)).resolves.toBeUndefined();
});

it('rejects a source removed while its permission work waits', async () => {
  const { verify, connections } = setup();
  state.delay = 75;
  const first = Array.from({ length: 3 }, () => verify('a', page));
  await vi.waitFor(() => expect(state.active).toBe(12));
  const result = verify('b', page).catch((e) => e);
  connections.delete('b');
  await Promise.all(first);
  expect(await result).toMatchObject({ code: 'not_found' });
  expect(state.calls).not.toContain('b');
});
it('bounds overload without leaking active slots into subsequent loads', async () => {
  const { verify } = setup();
  const results = await Promise.allSettled(Array.from({ length: 25 }, () => verify('a', page)));
  expect(results.some((r) => r.status === 'rejected')).toBe(true);
  expect(state.peak).toBeLessThanOrEqual(12);
  await expect(verify('a', page)).resolves.toBeUndefined();
  expect(state.active).toBe(0);
});
