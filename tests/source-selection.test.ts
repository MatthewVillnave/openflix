import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { openDatabase, catalogId } from '../packages/database/dist/index.js';
import { ConnectorError } from '../packages/connector-core/dist/index.js';
import type { ManagedMediaConnector, PlaybackInfo } from '../packages/connector-core/dist/index.js';
import { selectSource } from '../apps/server/src/source-selection.js';
let db: ReturnType<typeof openDatabase>;
const profile = { formats: ['mp4-h264-aac', 'hls-h264-aac'] as const };
const upstream = 'a'.repeat(32);
const plan = (mode: PlaybackInfo['mode'] = 'direct'): PlaybackInfo => ({
  itemId: upstream,
  sourceId: 'source',
  sessionId: 'session',
  kind: 'video',
  mode,
  contentType: 'video/mp4',
  durationMs: 18000,
});
const seed = (id: string, provider = '1', edition = 'test', duration = 18) => {
  if (!db.getConnector(id))
    db.insertConnector(
      {
        id,
        type: 'jellyfin',
        name: id,
        baseUrl: 'https://fixture.invalid',
        server: { id, name: id, version: '10.11.11' },
        libraries: [],
        state: 'connected',
        lastError: null,
        lastCheckedAt: null,
        createdAt: 1,
      },
      'opaque',
    );
  const run = db.catalog.begin(id, null);
  db.catalog.stageLibrary(run, { id: 'lib', name: 'lib', mediaTypes: [] });
  db.catalog.stagePage(run, 'lib', [
    {
      id: upstream,
      libraryId: 'lib',
      title: 'Same',
      type: 'movie',
      providerIds: { Tmdb: provider },
      edition,
      runtimeSeconds: duration,
    },
  ]);
  db.catalog.publish(run);
};
beforeEach(() => {
  db = openDatabase(':memory:');
  seed('a');
  seed('b');
});
afterEach(() => db.close());
const group = () => db.works.binding(catalogId('item', 'a', upstream))!.workId;
const fake = (value: PlaybackInfo | Error) => {
  const getPlaybackInfo = vi.fn(async () => {
    if (value instanceof Error) throw value;
    return value;
  });
  const closePlayback = vi.fn(async () => {});
  return { getPlaybackInfo, closePlayback } as unknown as ManagedMediaConnector;
};
const choose = (
  sources: Record<string, ManagedMediaConnector>,
  body: { groupId?: string; sourceItemId?: string; itemId?: string } = { groupId: group() },
  permitted = () => true,
) =>
  selectSource(
    db,
    { ...body, profile: { formats: [...profile.formats] } },
    permitted,
    (r) => sources[r.id]!,
    () => {},
  );
it('prefers fresh direct over remux over transcode and closes abandoned exact candidate plans', async () => {
  const ids = db.works.sources(group()).items.map((s) => s.connectorId);
  const first = fake(plan('transcode')),
    second = fake(plan('direct'));
  const result = await choose({ [ids[0]!]: first, [ids[1]!]: second });
  expect(result.connector).toBe(second);
  expect(first.closePlayback).toHaveBeenCalledOnce();
  expect(second.closePlayback).not.toHaveBeenCalled();
  expect(second.getPlaybackInfo).toHaveBeenCalledWith(upstream, expect.anything(), {
    singleVersionOnly: true,
  });
});
it('falls back before grant creation when the first permitted source is unavailable', async () => {
  const ids = db.works.sources(group()).items.map((s) => s.connectorId);
  const a = fake(new ConnectorError('unavailable')),
    b = fake(plan('remux'));
  expect((await choose({ [ids[0]!]: a, [ids[1]!]: b })).connector).toBe(b);
});
it('explicit source failure does not switch to another source or edition', async () => {
  const a = fake(new ConnectorError('unavailable')),
    b = fake(plan());
  await expect(
    choose({ a, b }, { groupId: group(), sourceItemId: catalogId('item', 'a', upstream) }),
  ).rejects.toMatchObject({ code: 'unavailable' });
  expect(b.getPlaybackInfo).not.toHaveBeenCalled();
});
it('rejects nonmember source IDs even when an otherwise authorized connector exists', async () => {
  seed('c', '2');
  const a = fake(plan()),
    b = fake(plan()),
    c = fake(plan());
  await expect(
    choose({ a, b, c }, { groupId: group(), sourceItemId: catalogId('item', 'c', upstream) }),
  ).rejects.toMatchObject({ code: 'not_found' });
  expect(c.getPlaybackInfo).not.toHaveBeenCalled();
});
it('requires explicit source selection for distinct or unspecified editions', async () => {
  seed('b', '1', 'extended');
  const a = fake(plan()),
    b = fake(plan());
  await expect(choose({ a, b })).rejects.toMatchObject({ code: 'selection_required' });
  expect(a.getPlaybackInfo).not.toHaveBeenCalled();
  expect(
    (await choose({ a, b }, { groupId: group(), sourceItemId: catalogId('item', 'b', upstream) }))
      .item.connectorId,
  ).toBe('b');
});
it('detects fresh duration disagreement rather than declaring versions equivalent', async () => {
  const a = fake({ ...plan(), durationMs: 36000 }),
    b = fake({ ...plan(), durationMs: 36000 });
  await expect(choose({ a, b })).rejects.toMatchObject({ code: 'source_changed' });
  expect([a, b].some((c) => vi.mocked(c.closePlayback).mock.calls.length === 1)).toBe(true);
});
it('rechecks authorization after planning and cleans up the returned plan on logout', async () => {
  let authorized = true;
  const a = fake(plan()),
    b = fake(plan());
  for (const c of [a, b])
    vi.mocked(c.getPlaybackInfo).mockImplementation(async () => {
      authorized = false;
      return plan();
    });
  await expect(choose({ a, b }, undefined, () => authorized)).rejects.toMatchObject({
    code: 'cancelled',
  });
  expect([a, b].reduce((n, c) => n + vi.mocked(c.closePlayback).mock.calls.length, 0)).toBe(1);
});
it('rejects source removal or regrouping during asynchronous planning', async () => {
  const a = fake(plan()),
    b = fake(plan());
  for (const [id, c] of Object.entries({ a, b }))
    vi.mocked(c.getPlaybackInfo).mockImplementation(async () => {
      seed(id, '99');
      return plan();
    });
  await expect(choose({ a, b })).rejects.toMatchObject({ code: 'source_changed' });
  expect([a, b].reduce((n, c) => n + vi.mocked(c.closePlayback).mock.calls.length, 0)).toBe(1);
});
it('bounds planning to four candidates and returns a useful all-unavailable failure', async () => {
  for (const id of ['c', 'd', 'e', 'f']) seed(id);
  const sources = Object.fromEntries(
    ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => [id, fake(new ConnectorError('unavailable'))]),
  );
  await expect(choose(sources)).rejects.toMatchObject({ code: 'no_compatible_source' });
  expect(
    Object.values(sources).reduce((n, c) => n + vi.mocked(c.getPlaybackInfo).mock.calls.length, 0),
  ).toBe(4);
});
it('preserves legacy source-item playback without equating catalog grouping with authority', async () => {
  const a = fake(plan());
  await expect(
    choose({ a }, { itemId: catalogId('item', 'a', upstream) }, () => false),
  ).rejects.toMatchObject({ code: 'cancelled' });
  expect(a.getPlaybackInfo).not.toHaveBeenCalled();
  const result = await choose({ a }, { itemId: catalogId('item', 'a', upstream) });
  expect(result.binding).toBeUndefined();
});
