import Database from 'better-sqlite3';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { openDatabase, migrate, migrations, catalogId } from '../packages/database/dist/index.js';
import type {
  MediaItem,
  Library,
  ManagedMediaConnector,
} from '../packages/connector-core/dist/index.js';
import { synchronizeCatalog } from '../apps/server/src/catalog.js';
import { temporaryConfig } from './helpers.js';
const connection = (id: string) => ({
  id,
  type: 'jellyfin' as const,
  name: id,
  baseUrl: 'https://fixture.invalid',
  server: { id: 'server', name: 'Fixture', version: '10.11.11' },
  libraries: [],
  state: 'unverified' as const,
  lastError: null,
  lastCheckedAt: null,
  createdAt: 1,
});
const library = (id: string, name = id): Library => ({
  id,
  name,
  mediaTypes: [],
  type: 'unknown',
  upstreamType: null,
});
const item = (id: string, libraryId = 'a', title = id): MediaItem => ({
  id,
  libraryId,
  title,
  type: 'movie',
  providerIds: {},
});
let fixture: ReturnType<typeof temporaryConfig>;
let db: ReturnType<typeof openDatabase>;
beforeEach(() => {
  fixture = temporaryConfig();
  db = openDatabase(fixture.config.databasePath);
  db.insertConnector(connection('one'), 'opaque');
  db.insertConnector(connection('two'), 'opaque');
});
afterEach(() => {
  db.close();
  fixture.cleanup();
});
function source(
  libraries: Library[],
  pages: (id: string) => AsyncIterable<readonly MediaItem[]>,
): ManagedMediaConnector {
  const unsupported = async () => {
    throw new Error('not used');
  };
  return {
    getLibraries: async () => libraries,
    scanCatalog: pages,
    getItem: unsupported,
    connect: unsupported,
    testConnection: unsupported,
    getServerInfo: unsupported,
    disconnect: unsupported,
    search: unsupported,
    getPlaybackInfo: unsupported,
    openPlaybackStream: unsupported,
    openPlaybackResource: unsupported,
    closePlayback: async () => {},
    reportPlaybackStart: unsupported,
    reportPlaybackProgress: unsupported,
    reportPlaybackStop: unsupported,
  };
}
function simple(items: MediaItem[], libraries = [library('a')]) {
  return source(libraries, async function* (id) {
    yield items.filter((i) => i.libraryId === id);
  });
}
const browse = (id = 'a', connector = 'one') =>
  db.catalog.browse(catalogId('lib', connector, id), { offset: 0, limit: 100 });
it('resynchronizes idempotently, updates existing IDs, prunes only a successful complete scan and persists after restart', async () => {
  await synchronizeCatalog(db, 'one', simple([item('1'), item('2')]));
  const original = browse().items[0]!.id;
  await synchronizeCatalog(db, 'one', simple([item('1'), item('2')]));
  expect(browse().total).toBe(2);
  expect(browse().items[0]!.id).toBe(original);
  await synchronizeCatalog(db, 'one', simple([item('1', 'a', 'Changed')]));
  expect(browse().items).toHaveLength(1);
  expect(browse().items[0]).toMatchObject({ id: original, title: 'Changed' });
  db.close();
  db = openDatabase(fixture.config.databasePath);
  expect(browse().total).toBe(1);
  expect(db.catalog.status('one').state).toBe('successful');
});
it('never publishes partial updates or deletions when a later page fails', async () => {
  await synchronizeCatalog(db, 'one', simple([item('1'), item('2')]));
  const before = browse();
  await expect(
    synchronizeCatalog(
      db,
      'one',
      source([library('a')], async function* () {
        yield [item('1', 'a', 'uncommitted')];
        throw new Error('secret-bearing failure');
      }),
    ),
  ).rejects.toMatchObject({ code: 'invalid_response' });
  expect(browse()).toEqual(before);
  expect(db.catalog.status('one')).toMatchObject({ state: 'failed', error: 'invalid_response' });
  expect(db.catalog.status('one').lastSuccessfulAt).not.toBeNull();
});
it('does not prune earlier libraries when a later library fails', async () => {
  const libs = [library('a'), library('b')];
  await synchronizeCatalog(db, 'one', simple([item('1'), item('2', 'b')], libs));
  await expect(
    synchronizeCatalog(
      db,
      'one',
      source(libs, async function* (id) {
        if (id === 'b') throw new Error();
        yield [];
      }),
    ),
  ).rejects.toThrow();
  expect(browse('a').total).toBe(1);
  expect(browse('b').total).toBe(1);
});
it('rejects duplicate IDs across pages rather than accepting an incomplete scan', async () => {
  await synchronizeCatalog(db, 'one', simple([item('1'), item('2')]));
  await expect(
    synchronizeCatalog(
      db,
      'one',
      source([library('a')], async function* () {
        yield [item('1')];
        yield [item('1')];
      }),
    ),
  ).rejects.toMatchObject({ code: 'invalid_response' });
  expect(browse().total).toBe(2);
});
it('isolates connectors and targeted library scans, supports one source item in multiple views', async () => {
  const libs = [library('a'), library('b')];
  await synchronizeCatalog(db, 'one', simple([item('1'), item('1', 'b'), item('2', 'b')], libs));
  await synchronizeCatalog(db, 'two', simple([item('1', 'a', 'Other source')]));
  expect(browse().items[0]!.libraryIds).toHaveLength(2);
  expect(browse('a', 'two').items[0]!.id).not.toBe(browse().items[0]!.id);
  await synchronizeCatalog(db, 'one', simple([], libs), catalogId('lib', 'one', 'a'));
  expect(browse().total).toBe(0);
  expect(browse('b').total).toBe(2);
  expect(browse('a', 'two').total).toBe(1);
});
it('removes missing libraries and orphan items only after a successful full scan', async () => {
  await synchronizeCatalog(db, 'one', simple([item('1')]));
  await synchronizeCatalog(db, 'one', simple([], []));
  expect(db.catalog.libraries()).toEqual([]);
  expect(db.catalog.item(catalogId('item', 'one', '1'))).toBeUndefined();
});
it('preserves normalized television/music relationships and infers types from items without library-name guesses', async () => {
  const items: MediaItem[] = [
    { ...item('1'), type: 'series' },
    { ...item('2'), type: 'season', parentId: '1', seriesId: '1', seasonNumber: 1 },
    {
      ...item('3'),
      type: 'episode',
      parentId: '2',
      seriesId: '1',
      seasonId: '2',
      seasonNumber: 1,
      episodeNumber: 2,
    },
  ];
  await synchronizeCatalog(db, 'one', simple(items, [library('a', 'Tv shows')]));
  expect(db.catalog.libraries()[0]).toMatchObject({ type: 'television', upstreamType: null });
  expect(db.catalog.item(catalogId('item', 'one', '3'))).toMatchObject({
    parentId: catalogId('item', 'one', '2'),
    seriesId: catalogId('item', 'one', '1'),
    seasonId: catalogId('item', 'one', '2'),
  });
  expect(
    db.catalog.browse(catalogId('lib', 'one', 'a'), {
      offset: 0,
      limit: 10,
      parentId: catalogId('item', 'one', '2'),
    }).total,
  ).toBe(1);
  await synchronizeCatalog(
    db,
    'one',
    simple(
      [
        { ...item('1'), type: 'audio', albumId: '2', artistIds: ['3'], albumArtistIds: ['3'] },
        { ...item('2'), type: 'album' },
        { ...item('3'), type: 'artist' },
      ],
      [library('a', 'Not a music name')],
    ),
  );
  expect(db.catalog.libraries()[0]!.type).toBe('music');
  expect(db.catalog.item(catalogId('item', 'one', '1'))?.artistIds).toEqual([
    catalogId('item', 'one', '3'),
  ]);
});
it('represents mixed, unknown and empty libraries explicitly', async () => {
  await synchronizeCatalog(db, 'one', simple([item('1'), { ...item('2'), type: 'audio' }]));
  expect(db.catalog.libraries()[0]!.type).toBe('mixed');
  await synchronizeCatalog(
    db,
    'one',
    simple([{ ...item('1'), type: 'unknown', upstreamType: 'NewKind' }]),
  );
  expect(db.catalog.libraries()[0]!.type).toBe('unknown');
  await synchronizeCatalog(db, 'one', simple([]));
  expect(db.catalog.libraries()[0]!.type).toBe('unknown');
  expect(browse().total).toBe(0);
});
it('recovers interrupted staging without touching the published catalog', async () => {
  await synchronizeCatalog(db, 'one', simple([item('1')]));
  const run = db.catalog.begin('one', null);
  db.catalog.stageLibrary(run, library('a'));
  db.catalog.stagePage(run, 'a', [item('2')]);
  db.close();
  db = openDatabase(fixture.config.databasePath);
  db.catalog.recover();
  expect(browse().items[0]!.upstreamId).toBe('1');
  expect(db.catalog.status('one').state).toBe('failed');
  const raw = new Database(fixture.config.databasePath);
  expect(raw.prepare('SELECT count(*) n FROM catalog_stage_items').get()).toEqual({ n: 0 });
  raw.close();
});
it('cascades connector removal through catalog, memberships, sync state and staging', async () => {
  await synchronizeCatalog(db, 'one', simple([item('1')]));
  const run = db.catalog.begin('one', null);
  db.catalog.stageLibrary(run, library('a'));
  db.catalog.stagePage(run, 'a', [item('2')]);
  db.removeConnector('one');
  expect(db.catalog.libraries()).toEqual([]);
  expect(db.catalog.item(catalogId('item', 'one', '1'))).toBeUndefined();
  const raw = new Database(fixture.config.databasePath);
  for (const table of [
    'catalog_items',
    'catalog_libraries',
    'catalog_memberships',
    'catalog_sync',
    'catalog_stage_items',
    'catalog_stage_libraries',
    'catalog_stage_memberships',
  ])
    expect(raw.prepare(`SELECT count(*) n FROM ${table}`).get()).toEqual({ n: 0 });
  raw.close();
});
it('migrates an audited M2 schema without changing users, sessions or connector ciphertext', () => {
  db.close();
  fixture.cleanup();
  fixture = temporaryConfig();
  const raw = new Database(fixture.config.databasePath);
  migrate(raw, migrations.slice(0, 2));
  raw
    .prepare('INSERT INTO users VALUES (?,?,?,?,?,?)')
    .run('u', 'user', 'User', 'hash', 'admin', 1);
  raw.prepare('INSERT INTO user_sessions VALUES (?,?,?,?)').run('digest', 'u', 1, 999999);
  raw
    .prepare('INSERT INTO media_connectors VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(
      'c',
      'jellyfin',
      'Source',
      'https://fixture.invalid',
      '{}',
      '[]',
      'unverified',
      null,
      null,
      1,
      'ciphertext',
    );
  raw.close();
  db = openDatabase(fixture.config.databasePath);
  expect(db.findUser('user')?.passwordHash).toBe('hash');
  expect(db.sessionUser('digest', 2)?.id).toBe('u');
  expect(db.getConnector('c')?.credentialEnvelope).toBe('ciphertext');
  expect(db.catalog.libraries()).toEqual([]);
});
it('synchronizes 5000 synthetic items in bounded pages, repeats deterministically and detects late duplicates', async () => {
  let pages = 0,
    maxPage = 0;
  const large = (duplicate = false) =>
    source([library('a')], async function* () {
      for (let start = 0; start < 5000; start += 100) {
        const page = Array.from({ length: 100 }, (_, i) =>
          item(String(start + i).padStart(5, '0')),
        );
        if (duplicate && start === 4900) page[99] = item('00000');
        pages++;
        maxPage = Math.max(maxPage, page.length);
        yield page;
      }
    });
  await synchronizeCatalog(db, 'one', large());
  expect(browse().total).toBe(5000);
  const first = browse().items[0]!.id;
  await synchronizeCatalog(db, 'one', large());
  expect(browse().items[0]!.id).toBe(first);
  expect(pages).toBe(100);
  expect(maxPage).toBe(100);
  await expect(synchronizeCatalog(db, 'one', large(true))).rejects.toThrow();
  expect(browse().total).toBe(5000);
}, 15000);
it('cancellation rolls back staging and preserves the last published catalog', async () => {
  await synchronizeCatalog(db, 'one', simple([item('1')]));
  const stop = new AbortController();
  await expect(
    synchronizeCatalog(
      db,
      'one',
      source([library('a')], async function* () {
        yield [item('2')];
        stop.abort();
        yield [item('3')];
      }),
      null,
      stop.signal,
    ),
  ).rejects.toMatchObject({ code: 'timeout' });
  expect(browse().items[0]!.upstreamId).toBe('1');
});
