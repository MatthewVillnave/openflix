import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { buildApp } from '../apps/server/src/app.js';
import { provisionUser } from '../apps/server/src/auth.js';
import { openDatabase } from '../packages/database/dist/index.js';
import { normalizeItem } from '../packages/connector-jellyfin/dist/catalog.js';
import { validateArtwork } from '../packages/connector-jellyfin/dist/artwork.js';
import { jellyfinFixture, upstreamPassword } from './jellyfin-fixture.js';
import { temporaryConfig, testPassword } from './helpers.js';
const origin = 'https://openflix.example';
let fixture: ReturnType<typeof temporaryConfig>,
  upstream: Awaited<ReturnType<typeof jellyfinFixture>>,
  app: Awaited<ReturnType<typeof buildApp>>,
  cookie: string,
  viewer: string,
  item: string,
  connection: string;
beforeEach(async () => {
  fixture = temporaryConfig({
    OPENFLIX_BASE_URL: origin,
    OPENFLIX_MASTER_KEY: randomBytes(32).toString('base64'),
  });
  upstream = await jellyfinFixture();
  upstream.state.catalog = [
    {
      Id: 'a'.repeat(32),
      Type: 'Movie',
      Name: 'Fixture movie',
      Overview: '<script>plain text</script>',
      Genres: ['Drama'],
    },
  ];
  const db = openDatabase(fixture.config.databasePath);
  await provisionUser(db, 'operator', testPassword, 'admin');
  await provisionUser(db, 'viewer', testPassword);
  db.close();
  app = await buildApp(fixture.config);
  const login = async (username: string) => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin },
      payload: { username, password: testPassword },
    });
    return String(response.headers['set-cookie']).split(';')[0]!;
  };
  cookie = await login('operator');
  viewer = await login('viewer');
  const added = await app.inject({
    method: 'POST',
    url: '/api/v1/connectors',
    headers: { origin, cookie },
    payload: {
      name: 'Fixture',
      baseUrl: upstream.baseUrl,
      username: 'fixture-user',
      password: upstreamPassword,
    },
  });
  expect(added.statusCode).toBe(201);
  connection = added.json().connector.id;
  await app.inject({
    method: 'POST',
    url: `/api/v1/catalog/sync/${connection}`,
    headers: { origin, cookie },
    payload: {},
  });
  for (let i = 0; i < 100; i++) {
    const status = await app.inject({
      url: `/api/v1/catalog/sync/${connection}`,
      headers: { cookie },
    });
    if (status.json().state !== 'syncing') break;
    await delay(5);
  }
  const works = await app.inject({ url: '/api/v1/catalog/works', headers: { cookie } });
  item = works.json().items[0].representativeItemId;
});
afterEach(async () => {
  await app?.close();
  await upstream?.close();
  fixture?.cleanup();
});
const image = (session = cookie, suffix = 'poster') =>
  app.inject({
    url: `/api/v1/catalog/items/${item}/artwork/${suffix}`,
    headers: { cookie: session },
  });
it('serves only authenticated bounded raster derivatives without caching or upstream secrets', async () => {
  expect((await image('')).statusCode).toBe(401);
  const response = await image();
  expect(response.statusCode).toBe(200);
  expect(response.headers['content-type']).toBe('image/jpeg');
  expect(response.headers['cache-control']).toBe('private, no-store');
  expect(response.rawPayload).toEqual(upstream.state.artwork.bytes);
  const request = upstream.state.requests.find((r) => r.path.includes('/Images/'))!;
  const url = new URL(request.path, 'https://fixture');
  expect(url.searchParams.get('format')).toBe('Jpg');
  expect(url.searchParams.get('maxWidth')).toBe('480');
  expect(url.searchParams.get('quality')).toBe('85');
  expect(response.body).not.toContain(upstream.state.token);
  expect((await image(viewer, 'backdrop')).statusCode).toBe(404);
  expect((await image(viewer, 'poster?url=https://example.org')).statusCode).toBe(400);
  expect((await image(viewer, 'svg')).statusCode).toBe(400);
});
it('fails safely for missing catalog identity, active content, excessive bytes, and redirects', async () => {
  const before = upstream.state.requests.length;
  const missing = await app.inject({
    url: `/api/v1/catalog/items/item_${'b'.repeat(64)}/artwork/poster`,
    headers: { cookie },
  });
  expect(missing.statusCode).toBe(404);
  expect(upstream.state.requests.length).toBe(before);
  upstream.state.artwork.bytes = Buffer.from('<svg onload="alert(1)"/>');
  upstream.state.artwork.contentType = 'image/svg+xml';
  expect((await image()).statusCode).toBe(502);
  upstream.state.artwork.bytes = Buffer.alloc(2 * 1024 * 1024 + 1);
  upstream.state.artwork.contentType = 'image/jpeg';
  expect((await image()).statusCode).toBe(502);
  upstream.state.mode = 'redirect';
  upstream.state.redirectPath = '/jellyfin/Items/';
  expect((await image()).statusCode).toBe(502);
  expect(upstream.state.requests.some((r) => r.path === '/credential-trap')).toBe(false);
});
it('rejects late responses after logout and caps concurrent artwork requests', async () => {
  upstream.state.artwork.delay = 200;
  const pending = Array.from({ length: 4 }, () => image().then((r) => r.statusCode));
  for (
    let i = 0;
    i < 100 && upstream.state.requests.filter((r) => r.path.includes('/Images/')).length < 4;
    i++
  )
    await delay(5);
  expect((await image()).statusCode).toBe(429);
  await app.inject({
    method: 'POST',
    url: '/api/v1/auth/logout',
    headers: { origin, cookie },
    payload: {},
  });
  expect(await Promise.all(pending)).toEqual([401, 401, 401, 401]);
  expect((await image(cookie)).statusCode).toBe(401);
});
it('normalizes bounded detail text and rejects unsafe or excessive metadata/image dimensions', () => {
  const raw = upstream.state.catalog[0]!;
  expect(normalizeItem(raw)).toMatchObject({
    overview: '<script>plain text</script>',
    genres: ['Drama'],
  });
  expect(() => normalizeItem({ ...raw, Overview: 'x'.repeat(5121) })).toThrow();
  expect(() => normalizeItem({ ...raw, Genres: Array(33).fill('Drama') })).toThrow();
  const jpeg = Buffer.from(upstream.state.artwork.bytes);
  jpeg.writeUInt16BE(5000, 7);
  expect(() => validateArtwork(jpeg, 'image/jpeg')).toThrow();
  expect(() => validateArtwork(Buffer.from('<html>'), 'image/jpeg')).toThrow();
});

it('isolates artwork and credentials across connectors with identical upstream item IDs', async () => {
  const other = await jellyfinFixture();
  try {
    other.state.serverId = '4'.repeat(32);
    other.state.catalog = [{ ...upstream.state.catalog[0], Name: 'Other fixture movie' }];
    other.state.artwork.bytes = Buffer.from(other.state.artwork.bytes);
    other.state.artwork.bytes.writeUInt16BE(2, 7);
    const added = await app.inject({
      method: 'POST',
      url: '/api/v1/connectors',
      headers: { origin, cookie },
      payload: {
        name: 'Other',
        baseUrl: other.baseUrl,
        username: 'fixture-user',
        password: upstreamPassword,
      },
    });
    expect(added.statusCode).toBe(201);
    const otherConnection = added.json().connector.id;
    await app.inject({
      method: 'POST',
      url: `/api/v1/catalog/sync/${otherConnection}`,
      headers: { origin, cookie },
      payload: {},
    });
    for (let i = 0; i < 100; i++) {
      const status = await app.inject({
        url: `/api/v1/catalog/sync/${otherConnection}`,
        headers: { cookie },
      });
      if (status.json().state !== 'syncing') break;
      await delay(5);
    }
    const works = await app.inject({ url: '/api/v1/catalog/works', headers: { cookie } });
    const second = works
      .json()
      .items.find(
        (work: { title: string }) => work.title === 'Other fixture movie',
      ).representativeItemId;
    expect(second).not.toBe(item);
    const [firstImage, secondImage] = await Promise.all([
      image(),
      app.inject({
        url: `/api/v1/catalog/items/${second}/artwork/poster`,
        headers: { cookie },
      }),
    ]);
    expect(firstImage.statusCode).toBe(200);
    expect(secondImage.statusCode).toBe(200);
    expect(firstImage.rawPayload).toEqual(upstream.state.artwork.bytes);
    expect(secondImage.rawPayload).toEqual(other.state.artwork.bytes);
    for (const [server, foreign] of [
      [upstream, other],
      [other, upstream],
    ]) {
      const requests = server!.state.requests.filter((request) =>
        request.path.includes('/Images/'),
      );
      expect(requests).toHaveLength(1);
      expect(requests[0]!.authorization).toContain(server!.state.token);
      expect(
        server!.state.requests.every(
          (request) => !request.authorization.includes(foreign!.state.token),
        ),
      ).toBe(true);
      expect(firstImage.body + secondImage.body).not.toContain(server!.state.token);
    }
  } finally {
    await other.close();
  }
});
it('withholds an in-flight artwork response after its source is removed', async () => {
  let release!: () => void;
  upstream.state.artwork.wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pending = image().then((response) => response);
  try {
    for (
      let i = 0;
      i < 100 && !upstream.state.requests.some((request) => request.path.includes('/Images/'));
      i++
    )
      await delay(5);
    expect(upstream.state.requests.some((request) => request.path.includes('/Images/'))).toBe(true);
    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/v1/connectors/${connection}`,
      headers: { origin, cookie },
    });
    expect(removed.statusCode).toBe(200);
    expect(removed.json().removed).toBe(true);
  } finally {
    release();
  }
  const response = await pending;
  expect(response.statusCode).toBe(404);
  expect(response.headers['content-type']).not.toBe('image/jpeg');
  expect(response.body).not.toContain(upstream.state.token);
  const count = upstream.state.requests.length;
  expect((await image()).statusCode).toBe(404);
  expect(upstream.state.requests).toHaveLength(count);
});
