import { randomBytes } from 'node:crypto';
import { Writable } from 'node:stream';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { beforeEach, afterEach, expect, it } from 'vitest';
import { buildApp } from '../apps/server/src/app.js';
import { provisionUser } from '../apps/server/src/auth.js';
import { createLogger } from '../apps/server/src/logger.js';
import { openDatabase } from '../packages/database/dist/index.js';
import { temporaryConfig, testPassword } from './helpers.js';
import { jellyfinFixture, upstreamPassword } from './jellyfin-fixture.js';
const origin = 'https://openflix.example';
let fixture: ReturnType<typeof temporaryConfig>;
let upstream: Awaited<ReturnType<typeof jellyfinFixture>>;
let app: Awaited<ReturnType<typeof buildApp>>;
let cookie: string, viewer: string, connection: string, logs: string;
const itemId = (n: number) => n.toString(16).padStart(32, '0');
beforeEach(async () => {
  fixture = temporaryConfig({
    OPENFLIX_MASTER_KEY: randomBytes(32).toString('base64'),
    OPENFLIX_BASE_URL: origin,
    OPENFLIX_LOG_LEVEL: 'info',
  });
  upstream = await jellyfinFixture();
  upstream.state.version = '10.11.11';
  upstream.state.collectionType = null;
  upstream.state.libraryName = 'Tv shows';
  upstream.state.catalog = [
    { Id: itemId(4), Name: 'Structural folder', Type: 'Folder' },
    { Id: itemId(1), Name: 'Series <script>alert(1)</script>', Type: 'Series' },
    {
      Id: itemId(2),
      Name: 'Season',
      Type: 'Season',
      ParentId: itemId(1),
      SeriesId: itemId(1),
      IndexNumber: 1,
    },
    {
      Id: itemId(3),
      Name: 'Episode',
      Type: 'Episode',
      ParentId: itemId(2),
      SeriesId: itemId(1),
      SeasonId: itemId(2),
      IndexNumber: 1,
      ParentIndexNumber: 1,
    },
  ];
  const db = openDatabase(fixture.config.databasePath);
  await provisionUser(db, 'operator', testPassword, 'admin');
  await provisionUser(db, 'viewer', testPassword);
  db.close();
  logs = '';
  app = await buildApp(
    fixture.config,
    createLogger(
      fixture.config,
      new Writable({
        write(chunk, _encoding, callback) {
          logs += String(chunk);
          callback();
        },
      }),
    ),
  );
  const login = async (username: string) => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin },
      payload: { username, password: testPassword },
    });
    return (r.headers['set-cookie'] as string).split(';')[0]!;
  };
  cookie = await login('operator');
  viewer = await login('viewer');
  const added = await app.inject({
    method: 'POST',
    url: '/api/v1/connectors',
    headers: { origin, cookie },
    payload: {
      name: 'Catalog source',
      baseUrl: upstream.baseUrl,
      username: 'fixture-user',
      password: upstreamPassword,
    },
  });
  expect(added.statusCode).toBe(201);
  connection = added.json().connector.id;
});
afterEach(async () => {
  await app.close();
  await upstream.close();
  fixture.cleanup();
});
const get = (path: string, session = viewer) =>
  app.inject({ url: '/api/v1/catalog' + path, headers: { cookie: session } });
const start = (session = cookie, payload = {}) =>
  app.inject({
    method: 'POST',
    url: `/api/v1/catalog/sync/${connection}`,
    headers: { origin, cookie: session },
    payload,
  });
async function done() {
  for (let i = 0; i < 100; i++) {
    const s = (await get(`/sync/${connection}`, cookie)).json();
    if (s.state !== 'syncing') return s;
    await delay(5);
  }
  throw new Error('sync timed out');
}
async function sync() {
  expect((await start()).statusCode).toBe(202);
  expect((await done()).state).toBe('successful');
}
it('requires authentication for catalog and administrator plus Origin for sync', async () => {
  for (const path of [
    '/libraries',
    '/items/missing',
    `/sync/${connection}`,
    '/libraries/missing/items',
  ])
    expect((await get(path, '')).statusCode).toBe(401);
  expect((await start(viewer)).statusCode).toBe(403);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `/api/v1/catalog/sync/${connection}`,
        headers: { cookie },
        payload: {},
      })
    ).statusCode,
  ).toBe(403);
  expect((await get('/libraries')).json()).toEqual({ libraries: [] });
});
it('browses normalized TV hierarchy with paging/filtering, no secrets and no browser/upstream coupling', async () => {
  await sync();
  const libs = await get('/libraries');
  const library = libs.json().libraries[0];
  expect(library).toMatchObject({ name: 'Tv shows', type: 'television', upstreamType: null });
  const page = await get(`/libraries/${library.id}/items?offset=0&limit=2`);
  expect(page.json().total).toBe(4);
  expect(page.json().items).toHaveLength(2);
  const tail = await get(`/libraries/${library.id}/items?offset=2&limit=2`);
  expect(tail.json().items).toHaveLength(2);
  const episode = (await get(`/libraries/${library.id}/items?type=episode`)).json().items[0];
  expect(episode.type).toBe('episode');
  expect((await get(`/items/${episode.seasonId}`)).json().item.type).toBe('season');
  expect(
    (await get(`/libraries/${library.id}/items?parentId=${episode.seasonId}`)).json().total,
  ).toBe(1);
  expect((await get(`/libraries/${library.id}/items?limit=101`)).statusCode).toBe(400);
  expect((await get(`/libraries/${library.id}/items?type=Movie`)).statusCode).toBe(400);
  const serialized = libs.body + page.body + tail.body + JSON.stringify(episode) + logs;
  for (const secret of [upstreamPassword, upstream.state.token, fixture.config.masterKey!]) {
    expect(serialized).not.toContain(secret);
    expect(readFileSync(fixture.config.databasePath).includes(Buffer.from(secret))).toBe(false);
  }
  expect(serialized).not.toContain('credentialEnvelope');
  expect(serialized).not.toContain('ciphertext');
  const before = upstream.state.requests.length;
  await get(`/items/${episode.id}`);
  expect(upstream.state.requests).toHaveLength(before);
});
it('persists across restart and repeats sync without password re-entry, then connector removal cascades', async () => {
  await sync();
  const library = (await get('/libraries')).json().libraries[0];
  const before = (await get(`/libraries/${library.id}/items`)).json();
  await app.close();
  app = await buildApp(fixture.config);
  expect((await get(`/libraries/${library.id}/items`)).json()).toEqual(before);
  await sync();
  expect((await get(`/libraries/${library.id}/items`)).json().total).toBe(4);
  expect(upstream.state.requests.filter((r) => r.path.endsWith('AuthenticateByName'))).toHaveLength(
    1,
  );
  const deleted = await app.inject({
    method: 'DELETE',
    url: `/api/v1/connectors/${connection}`,
    headers: { origin, cookie },
  });
  expect(deleted.statusCode).toBe(200);
  expect((await get('/libraries')).json().libraries).toEqual([]);
  expect((await get(`/items/${before.items[0].id}`)).statusCode).toBe(404);
});
it('failed second page leaves published records intact and reports only sanitized failure', async () => {
  await sync();
  const library = (await get('/libraries')).json().libraries[0];
  const before = (await get(`/libraries/${library.id}/items`)).body;
  upstream.state.catalog = Array.from({ length: 101 }, (_, i) => ({
    Id: itemId(i + 1),
    Name: 'New ' + i,
    Type: 'Movie',
  }));
  upstream.state.catalogFailureAt = 100;
  expect((await start()).statusCode).toBe(202);
  expect(await done()).toMatchObject({ state: 'failed', error: 'unavailable' });
  expect((await get(`/libraries/${library.id}/items`)).body).toBe(before);
  expect(logs).not.toContain(upstream.state.token);
});
it('rejects overlapping mutations, and shutdown cancels staging before closing the database', async () => {
  upstream.state.mode = 'slow';
  expect((await start()).statusCode).toBe(202);
  expect((await start()).statusCode).toBe(503);
  expect(
    (
      await app.inject({
        method: 'DELETE',
        url: `/api/v1/connectors/${connection}`,
        headers: { origin, cookie },
      })
    ).statusCode,
  ).toBe(503);
  await app.close();
  upstream.state.mode = 'normal';
  app = await buildApp(fixture.config);
  expect((await get(`/sync/${connection}`)).json().state).toBe('failed');
  expect((await get('/libraries')).json().libraries).toEqual([]);
});
