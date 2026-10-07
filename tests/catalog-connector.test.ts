import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  authenticateJellyfin,
  createJellyfinConnector,
} from '../packages/connector-jellyfin/dist/index.js';
import { normalizeItem } from '../packages/connector-jellyfin/dist/catalog.js';
import {
  jellyfinFixture,
  libraryId,
  upstreamPassword,
  observedCatalog,
} from './jellyfin-fixture.js';
const id = (n: number) => n.toString(16).padStart(32, '0');
const raw = (n: number, Type = 'Movie') => ({ Id: id(n), Name: `Item ${n}`, Type });
it.each([
  ['Movie', 'movie'],
  ['Series', 'series'],
  ['Season', 'season'],
  ['Episode', 'episode'],
  ['Audio', 'audio'],
  ['MusicAlbum', 'album'],
  ['MusicArtist', 'artist'],
  ['Playlist', 'playlist'],
  ['Folder', 'unknown'],
  ['Photo', 'unknown'],
  ['__proto__', 'unknown'],
  [null, 'unknown'],
])('normalizes item type %s independently of any library hint', (upstream, type) => {
  expect(normalizeItem({ ...raw(1), Type: upstream }, libraryId).type).toBe(type);
});
it('normalizes TV/music relationships, dates, runtime, provider IDs and revisions without raw paths', () => {
  const item = normalizeItem(
    {
      ...raw(3, 'Episode'),
      ParentId: id(2),
      SeriesId: id(1),
      SeasonId: id(2),
      ParentIndexNumber: 0,
      IndexNumber: 2,
      RunTimeTicks: 123000000,
      ProductionYear: 2026,
      PremiereDate: '2026-01-01T00:00:00Z',
      Etag: 'revision',
      ProviderIds: { Tmdb: '42', Empty: null },
      Path: '/private/media',
      SortName: 'sort',
      AlbumId: id(4),
      ArtistItems: [{ Id: id(5), Name: 'Artist' }],
      AlbumArtists: [{ Id: id(6) }],
      Album: 'Album title',
    },
    libraryId,
  );
  expect(item).toMatchObject({
    type: 'episode',
    parentId: id(2),
    seriesId: id(1),
    seasonId: id(2),
    seasonNumber: 0,
    episodeNumber: 2,
    runtimeSeconds: 12.3,
    providerIds: { Tmdb: '42' },
    artistIds: [id(5)],
    albumArtistIds: [id(6)],
    albumId: id(4),
    revision: 'revision',
    sortTitle: 'sort',
    year: 2026,
  });
  expect(JSON.stringify(item)).not.toContain('/private/media');
  expect(item.providerIds).not.toHaveProperty('Empty');
  expect(normalizeItem({ ...raw(2, 'Season'), IndexNumber: 0 }).seasonNumber).toBe(0);
});
it.each([
  { Id: 'bad' },
  { Name: '' },
  { RunTimeTicks: -1 },
  { ProviderIds: { x: 'x'.repeat(257) } },
  { ArtistItems: Array(101).fill({ Id: id(1) }) },
])('rejects malformed or oversized consumed metadata %j', (value) => {
  expect(() => normalizeItem({ ...raw(1), ...value })).toThrow();
});
describe('official SDK catalog requests', () => {
  let fixture: Awaited<ReturnType<typeof jellyfinFixture>>;
  let connector: ReturnType<typeof createJellyfinConnector>;
  beforeEach(async () => {
    fixture = await jellyfinFixture();
    fixture.state.version = '10.11.11';
    const result = await authenticateJellyfin({
      baseUrl: fixture.baseUrl,
      deviceId: 'catalog-fixture',
      username: 'fixture-user',
      password: upstreamPassword,
    });
    connector = createJellyfinConnector(
      { baseUrl: fixture.baseUrl, credential: { id: 'catalog-fixture' } },
      {
        read: async () => Uint8Array.from(result.secret),
        store: async () => ({ id: 'catalog-fixture' }),
        delete: async () => {},
      },
    );
  });
  afterEach(async () => fixture.close());
  it.each([0, 1, 100, 101, 200, 205])(
    'terminates bounded pagination for %i items including exact boundaries',
    async (count) => {
      fixture.state.catalog = Array.from({ length: count }, (_, i) => raw(i + 1));
      const pages = [];
      for await (const page of connector.scanCatalog(libraryId)) pages.push(page);
      expect(pages.flat()).toHaveLength(count);
      expect(pages.every((p) => p.length <= 100)).toBe(true);
      expect(
        fixture.state.requests.filter((r) => r.path.startsWith('/jellyfin/Items?')),
      ).toHaveLength(Math.max(1, Math.ceil(count / 100)));
    },
  );
  it('supports the actual Tv shows null CollectionType and arbitrarily renamed libraries', async () => {
    fixture.state.collectionType = null;
    fixture.state.libraryName = 'Tv shows';
    expect((await connector.getLibraries())[0]).toMatchObject({
      type: 'unknown',
      upstreamType: null,
      mediaTypes: [],
    });
    fixture.state.catalog = observedCatalog(['Series', 'Season', 'Episode', 'Folder']);
    const scan = async () => {
      const types = [];
      for await (const page of connector.scanCatalog(libraryId))
        types.push(...page.map((i) => i.type));
      return types;
    };
    expect(await scan()).toEqual(['series', 'season', 'episode', 'unknown']);
    fixture.state.libraryName = 'Random unrelated title';
    expect(await scan()).toEqual(['series', 'season', 'episode', 'unknown']);
  });
  it.each(['offset', 'empty', 'total', 'duplicate', 'oversized'])(
    'fails closed on malformed pagination: %s',
    async (mode) => {
      fixture.state.pageOverride = (offset) => ({
        StartIndex: mode === 'offset' ? offset + 1 : offset,
        TotalRecordCount: mode === 'total' ? -1 : 10,
        Items:
          mode === 'empty'
            ? []
            : mode === 'duplicate'
              ? [raw(1), raw(1)]
              : mode === 'oversized'
                ? Array.from({ length: 101 }, (_, i) => raw(i + 1))
                : [raw(1)],
      });
      await expect(
        (async () => {
          for await (const _page of connector.scanCatalog(libraryId)) {
            /* consume */
          }
        })(),
      ).rejects.toMatchObject({ code: 'invalid_response' });
    },
  );
  it('rejects a total that changes mid-scan', async () => {
    fixture.state.pageOverride = (offset) => ({
      StartIndex: offset,
      TotalRecordCount: offset ? 101 : 100,
      Items: [raw(offset + 1)],
    });
    await expect(
      (async () => {
        for await (const _ of connector.scanCatalog(libraryId, { pageSize: 1 })) {
        }
      })(),
    ).rejects.toMatchObject({ code: 'invalid_response' });
  });
  it('fetches an individual normalized item using the connector user', async () => {
    fixture.state.catalog = [raw(1)];
    expect(await connector.getItem(id(1))).toMatchObject({
      id: id(1),
      title: 'Item 1',
      type: 'movie',
    });
  });
  it('rejects reflected tokens in item metadata and respects cancellation', async () => {
    fixture.state.catalog = [{ ...raw(1), Name: fixture.state.token }];
    await expect(
      (async () => {
        for await (const _ of connector.scanCatalog(libraryId)) {
        }
      })(),
    ).rejects.toMatchObject({ code: 'invalid_response' });
    fixture.state.catalog = [raw(1)];
    const stop = new AbortController();
    stop.abort();
    await expect(
      (async () => {
        for await (const _ of connector.scanCatalog(libraryId, { signal: stop.signal })) {
        }
      })(),
    ).rejects.toThrow();
  });
  it('does not enumerate inaccessible views in a restricted fixture', async () => {
    fixture.state.hideLibraries = true;
    expect(await connector.getLibraries()).toEqual([]);
  });
});
