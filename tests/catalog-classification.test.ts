import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  authenticateJellyfin,
  createJellyfinConnector,
} from '../packages/connector-jellyfin/dist/index.js';
import { normalizeItem } from '../packages/connector-jellyfin/dist/catalog.js';
import { openDatabase } from '../packages/database/dist/index.js';
import { synchronizeCatalog } from '../apps/server/src/catalog.js';
import { temporaryConfig } from './helpers.js';
import { jellyfinFixture, observedCatalog, upstreamPassword } from './jellyfin-fixture.js';
let upstream: Awaited<ReturnType<typeof jellyfinFixture>>;
let local: ReturnType<typeof temporaryConfig>;
let db: ReturnType<typeof openDatabase>;
let connector: ReturnType<typeof createJellyfinConnector>;
beforeEach(async () => {
  upstream = await jellyfinFixture();
  upstream.state.version = '10.11.11';
  upstream.state.libraryName = 'Arbitrary collection 47';
  local = temporaryConfig();
  db = openDatabase(local.config.databasePath);
  const auth = await authenticateJellyfin({
    baseUrl: upstream.baseUrl,
    deviceId: 'classification-fixture',
    username: 'fixture-user',
    password: upstreamPassword,
  });
  connector = createJellyfinConnector(
    { baseUrl: upstream.baseUrl, credential: { id: 'fixture' } },
    {
      read: async () => Uint8Array.from(auth.secret),
      store: async () => ({ id: 'fixture' }),
      delete: async () => {},
    },
  );
  db.insertConnector(
    {
      id: 'source',
      type: 'jellyfin',
      name: 'Fixture',
      baseUrl: upstream.baseUrl,
      server: { id: 'fixture', name: 'Fixture', version: '10.11.11' },
      libraries: [],
      state: 'unverified',
      lastError: null,
      lastCheckedAt: null,
      createdAt: 1,
    },
    'opaque',
  );
});
afterEach(async () => {
  db.close();
  local.cleanup();
  await upstream.close();
});
it.each([
  { types: ['Movie', 'Movie', 'Folder'], hint: 'movies', expected: 'movie' },
  { types: ['Series', 'Season', 'Episode', 'Folder'], hint: null, expected: 'television' },
  { types: ['Audio', 'MusicAlbum', 'MusicArtist', 'Folder'], hint: 'music', expected: 'music' },
  { types: ['Folder', 'Folder'], hint: null, expected: 'unknown' },
  { types: ['Folder', 'Folder'], hint: 'movies', expected: 'unknown' },
  { types: ['Movie', 'Audio', 'Folder'], hint: null, expected: 'mixed' },
  { types: ['Movie', 'SyntheticSemanticType', 'Folder'], hint: 'movies', expected: 'mixed' },
  { types: ['SyntheticSemanticType', 'Folder'], hint: null, expected: 'unknown' },
])(
  'classifies $types with CollectionType=$hint as $expected through the wire connector and publication',
  async ({ types, hint, expected }) => {
    upstream.state.collectionType = hint;
    upstream.state.catalog = observedCatalog(types);
    await synchronizeCatalog(db, 'source', connector);
    const library = db.catalog.libraries()[0]!;
    expect(library).toMatchObject({
      name: 'Arbitrary collection 47',
      type: expected,
      upstreamType: hint,
    });
    const before = db.catalog.browse(library.id, { offset: 0, limit: 100 });
    expect(before.total).toBe(types.length);
    for (const item of before.items) {
      if (item.upstreamType === 'Folder')
        expect(item).toMatchObject({ type: 'unknown', structural: true });
      else expect(item).not.toHaveProperty('structural');
    }
    // Repeated publication and reopening retain both family and source identity.
    await synchronizeCatalog(db, 'source', connector);
    db.close();
    db = openDatabase(local.config.databasePath);
    expect(db.catalog.libraries()[0]!.type).toBe(expected);
    expect(db.catalog.browse(library.id, { offset: 0, limit: 100 }).items.map((i) => i.id)).toEqual(
      before.items.map((i) => i.id),
    );
  },
);
it('does not neutralize arbitrary unsupported types or semantic containers via upstream IsFolder', () => {
  for (const Type of ['SyntheticSemanticType', 'Series', 'Season', 'MusicAlbum', 'folder']) {
    const normalized = normalizeItem({ ...observedCatalog([Type])[0], IsFolder: true });
    expect(normalized).not.toHaveProperty('structural');
  }
});
