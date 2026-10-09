import { afterEach, expect, it } from 'vitest';
import {
  openDatabase,
  catalogId,
  providerIdentity,
  workIdentity,
  versionIdentity,
} from '../packages/database/dist/index.js';
import type { CatalogItem, MediaItem, Library } from '../packages/shared/dist/index.js';
import { normalizeItem } from '../packages/connector-jellyfin/src/catalog.js';

const connection = (id: string, backend = id) => ({
  id,
  type: 'jellyfin' as const,
  name: id,
  baseUrl: 'https://fixture.invalid',
  server: { id: backend, name: id, version: '10.11.11' },
  libraries: [],
  state: 'unverified' as const,
  lastError: null,
  lastCheckedAt: null,
  createdAt: 1,
});
const library: Library = { id: 'lib', name: 'Arbitrary', mediaTypes: [] };
const media = (id: string, extra: Partial<MediaItem> = {}): MediaItem => ({
  id,
  libraryId: 'lib',
  title: 'Same title',
  type: 'movie',
  providerIds: { Tmdb: id },
  ...extra,
});
const item = (id: string, extra: Partial<CatalogItem> = {}): CatalogItem => ({
  ...media('1'),
  id,
  connectorId: id,
  upstreamId: '1',
  libraryIds: [],
  syncedAt: 1,
  ...extra,
});
const db = openDatabase(':memory:');
afterEach(() => {
  for (const c of db.listConnectors()) db.removeConnector(c.id);
});
function publish(connector: string, items: MediaItem[], libraries = [library], target?: string) {
  const run = db.catalog.begin(connector, target ?? null);
  for (const lib of libraries) {
    db.catalog.stageLibrary(run, lib);
    const contents = items.filter((i) => i.libraryId === lib.id);
    for (let n = 0; n < contents.length; n += 100)
      db.catalog.stagePage(run, lib.id, contents.slice(n, n + 100));
  }
  db.catalog.publish(run);
}
const works = () => db.works.browse({ offset: 0, limit: 100 });
it('canonicalizes supported provider namespaces without entity or namespace collisions', () => {
  expect(providerIdentity(item('a', { providerIds: { TMDB: '000123', IMDb: 'TT1234567' } }))).toBe(
    providerIdentity(item('b', { providerIds: { imdb: 'tt1234567', tmdb: '123' } })),
  );
  expect(workIdentity(item('a', { providerIds: { Tmdb: '42' } }))).not.toBe(
    workIdentity(item('b', { providerIds: { Tvdb: '42' } })),
  );
  expect(workIdentity(item('a'))).not.toBe(workIdentity(item('b', { type: 'series' })));
});
it('does not merge same titles, absent, invalid or contradictory identifiers', () => {
  for (const providerIds of [
    {},
    { Tmdb: '0' },
    { Tmdb: '1e3' },
    { Imdb: 'bad' },
    { Tmdb: '1', tmdb: '2' },
  ]) {
    expect(workIdentity(item('a', { providerIds }))).not.toBe(
      workIdentity(item('b', { providerIds })),
    );
  }
});
it('complete evidence prevents transitive contradiction and preserves unknown namespace evidence', () => {
  const records = [
    { Tmdb: '1', Imdb: 'tt1234567' },
    { Imdb: 'tt1234567' },
    { Tmdb: '2', Imdb: 'tt1234567' },
  ];
  expect(
    new Set(records.map((providerIds, i) => workIdentity(item(String(i), { providerIds })))).size,
  ).toBe(3);
  expect(workIdentity(item('a', { providerIds: { Tmdb: '1', Other: 'A' } }))).not.toBe(
    workIdentity(item('b', { providerIds: { Tmdb: '1', Other: 'B' } })),
  );
});
it('groups episode IDs only with compatible identified series and unambiguous positive numbering', () => {
  const series = item('s', { type: 'series' });
  const episode = item('a', { type: 'episode', seasonNumber: 1, episodeNumber: 2 });
  expect(workIdentity(episode, series)).toBe(workIdentity({ ...episode, id: 'b' }, series));
  for (const changed of [
    { seasonNumber: 0 },
    { episodeNumber: 3 },
    { episodeEndNumber: 4 },
    { providerIds: {} },
  ]) {
    expect(workIdentity(episode, series)).not.toBe(
      workIdentity({ ...episode, id: 'b', ...changed }, series),
    );
  }
  expect(workIdentity(episode)).not.toBe(workIdentity({ ...episode, id: 'b' }));
  expect(workIdentity(episode, series)).not.toBe(
    workIdentity(episode, { ...series, providerIds: { Tmdb: '9' } }),
  );
});
it('keeps music source-specific and editions separate without timeline equivalence claims', () => {
  expect(workIdentity(item('a', { type: 'audio' }))).not.toBe(
    workIdentity(item('b', { type: 'audio' })),
  );
  expect(versionIdentity(item('a'))).not.toBe(versionIdentity(item('b')));
  const version = { edition: 'theatrical', runtimeSeconds: 3600 };
  expect(versionIdentity(item('a', version))).toBe(versionIdentity(item('b', version)));
  expect(versionIdentity(item('a', version))).not.toBe(
    versionIdentity(item('b', { ...version, edition: 'extended' })),
  );
  expect(versionIdentity(item('a', version))).not.toBe(
    versionIdentity(item('b', { ...version, runtimeSeconds: 3601 })),
  );
});
it('preserves IDs across opposite scan order and resync; same-source view memberships do not inflate counts', () => {
  for (const c of ['a', 'b']) db.insertConnector(connection(c), 'opaque');
  const libs = [library, { ...library, id: 'other' }];
  publish('a', [media('1'), media('1', { libraryId: 'other' })], libs);
  const original = works().items[0]!.id;
  publish('b', [media('1')]);
  expect(works().items).toMatchObject([
    { id: original, sourceCount: 2, memberCount: 2, connectionCount: 2 },
  ]);
  const ids = db.works.sources(original).items.map((s) => s.itemId);
  db.removeConnector('a');
  db.removeConnector('b');
  for (const c of ['b', 'a']) {
    db.insertConnector(connection(c), 'opaque');
    publish(c, [media('1')]);
  }
  expect(works().items[0]!.id).toBe(original);
  expect(db.works.sources(original).items.map((s) => s.itemId)).toEqual(ids);
  expect(db.works.sources(original).items.every((s) => s.availability === 'last-indexed')).toBe(
    true,
  );
});
it('counts duplicate connections to the same backend item honestly', () => {
  for (const c of ['a', 'b']) {
    db.insertConnector(connection(c, 'same-server'), 'opaque');
    publish(c, [media('1')]);
  }
  expect(works().items).toMatchObject([{ sourceCount: 1, connectionCount: 2, memberCount: 2 }]);
});
it('keeps failed staging private, isolates targeted scans and connector removal', () => {
  for (const c of ['a', 'b']) {
    db.insertConnector(connection(c), 'opaque');
    publish(c, [media('1')]);
  }
  const before = works();
  const run = db.catalog.begin('a', null);
  db.catalog.stageLibrary(run, library);
  db.catalog.stagePage(run, 'lib', [media('2')]);
  expect(works()).toEqual(before);
  db.catalog.fail(run, 'unavailable');
  expect(works()).toEqual(before);
  publish(
    'a',
    [media('1'), media('2', { libraryId: 'other' })],
    [library, { ...library, id: 'other' }],
  );
  publish('a', [], [library], catalogId('lib', 'a', 'lib'));
  expect(db.catalog.item(catalogId('item', 'b', '1'))).toBeDefined();
  expect(db.catalog.item(catalogId('item', 'a', '2'))).toBeDefined();
  db.removeConnector('a');
  expect(works().items).toMatchObject([{ id: before.items[0]!.id, sourceCount: 1 }]);
});
it('regroups corrected evidence without retargeting original source IDs and prunes empty groups', () => {
  db.insertConnector(connection('a'), 'opaque');
  publish('a', [media('1')]);
  const old = works().items[0]!.id,
    source = catalogId('item', 'a', '1');
  publish('a', [media('1', { providerIds: { Tmdb: '2' } })]);
  expect(db.works.work(old)).toBeUndefined();
  expect(db.works.binding(source)!.workId).not.toBe(old);
  expect(db.catalog.item(source)).toBeDefined();
});
it('preserves grouped TV navigation through source-specific parent relationships', () => {
  for (const c of ['a', 'b']) {
    db.insertConnector(connection(c), 'opaque');
    publish(c, [
      media('1', { type: 'series' }),
      media('2', { type: 'episode', seriesId: '1', seasonNumber: 1, episodeNumber: 2 }),
    ]);
  }
  const series = works().items.find((i) => i.type === 'series')!;
  const episodes = db.works.browse({
    offset: 0,
    limit: 50,
    seriesWorkId: series.id,
    seasonNumber: 1,
    type: 'episode',
  });
  expect(episodes.items).toMatchObject([{ type: 'episode', sourceCount: 2 }]);
});
it('publishes a multi-thousand-item two-source catalog using bounded pages deterministically', () => {
  const items = Array.from({ length: 2500 }, (_, i) => media(String(i + 1)));
  for (const c of ['a', 'b']) {
    db.insertConnector(connection(c), 'opaque');
    publish(c, items);
  }
  expect(works().total).toBe(2500);
  expect(works().items).toHaveLength(100);
  expect(works().items.every((w) => w.sourceCount === 2)).toBe(true);
  const page = db.works.browse({ offset: 2400, limit: 100 });
  publish('a', items);
  expect(db.works.browse({ offset: 2400, limit: 100 })).toEqual(page);
}, 15000);
it('normalizes only explicit edition assertions, upstream version labels, and episode ranges', () => {
  const raw = {
    Id: 'a'.repeat(32),
    Name: 'Title',
    Type: 'Episode',
    Tags: ['OpenFlixEdition: theatrical'],
    MediaSourceCount: 2,
    MediaSources: [{ Name: '1080p' }, { Name: 'Alternate' }],
    IndexNumberEnd: 3,
  };
  expect(normalizeItem(raw)).toMatchObject({
    edition: 'theatrical',
    versionCount: 2,
    versionLabels: ['1080p', 'Alternate'],
    episodeEndNumber: 3,
  });
  expect(
    normalizeItem({ ...raw, Tags: ['OpenFlixEdition: A', 'OpenFlixEdition: B'] }),
  ).toMatchObject({ editionAmbiguous: true });
  expect(normalizeItem({ ...raw, Tags: [] })).not.toHaveProperty('edition');
  expect(() => normalizeItem({ ...raw, MediaSourceCount: 1000 })).toThrow();
});
