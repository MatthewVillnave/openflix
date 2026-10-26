import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import { beforeEach, afterEach, expect, it } from 'vitest';
import { buildApp } from '../apps/server/src/app.js';
import { tokenDigest } from '../apps/server/src/auth.js';
import { EncryptedCredentialStore } from '../apps/server/src/connector-credentials.js';
import { openDatabase, catalogId } from '../packages/database/dist/index.js';
import { jellyfinFixture, upstreamPassword } from './jellyfin-fixture.js';
import { temporaryConfig } from './helpers.js';
const origin = 'https://openflix.example';
const profile = { formats: ['mp4-h264-aac'] };
let local: ReturnType<typeof temporaryConfig>,
  db: ReturnType<typeof openDatabase>,
  app: Awaited<ReturnType<typeof buildApp>>,
  upstream: Awaited<ReturnType<typeof jellyfinFixture>>;
let alice: string, bob: string, ca: string, cb: string, ia: string, ib: string;
let b: Awaited<ReturnType<typeof jellyfinFixture>>['state'];
const headers = (cookie: string) => ({ cookie, origin });
const get = (url: string, cookie = bob) => app.inject({ url, headers: headers(cookie) });
const post = (url: string, payload: object = {}, cookie = bob) =>
  app.inject({ method: 'POST', url, headers: headers(cookie), payload });
const link = (cookie: string, username: string) =>
  post(
    '/api/v1/connectors',
    { name: 'Personal library', baseUrl: upstream.baseUrl, username, password: upstreamPassword },
    cookie,
  );
async function sync(id: string, cookie: string) {
  expect((await post('/api/v1/catalog/sync/' + id, {}, cookie)).statusCode).toBe(202);
  await expect
    .poll(async () => (await get('/api/v1/catalog/sync/' + id, cookie)).json().state)
    .toBe('successful');
}
beforeEach(async () => {
  local = temporaryConfig({
    OPENFLIX_BASE_URL: origin,
    OPENFLIX_MASTER_KEY: randomBytes(32).toString('base64'),
  });
  upstream = await jellyfinFixture();
  upstream.state.catalog = [
    { Id: 'a'.repeat(32), Name: 'Alice private movie', Type: 'Movie', ProviderIds: { Tmdb: '42' } },
  ];
  b = upstream.addAccount('bob-jellyfin', '9'.repeat(32));
  b.catalog = [
    { Id: 'd'.repeat(32), Name: 'Bob private movie', Type: 'Movie', ProviderIds: { Tmdb: '42' } },
  ];
  b.libraryName = 'Bob library';
  b.artwork.bytes = Buffer.from(b.artwork.bytes);
  b.artwork.bytes.writeUInt16BE(2, 7);
  db = openDatabase(local.config.databasePath);
  const session = (id: string, role: 'admin' | 'user') => {
    db.createUser(
      { id, username: id, displayName: id, role, passwordHash: 'synthetic-no-password-login' },
      Date.now(),
    );
    const token = randomBytes(32).toString('base64url');
    db.createSession(tokenDigest(token), id, Date.now(), Date.now() + 3600000);
    return local.config.cookieName + '=' + token;
  };
  alice = session('alice', 'admin');
  bob = session('bob', 'user');
  app = await buildApp(local.config);
  const added = await link(alice, 'fixture-user');
  expect(added.statusCode, added.body).toBe(201);
  ca = added.json().connector.id;
  const second = await link(bob, 'bob-jellyfin');
  expect(second.statusCode, second.body).toBe(201);
  cb = second.json().connector.id;
  await sync(ca, alice);
  await sync(cb, bob);
  ia = catalogId('item', ca, 'a'.repeat(32));
  ib = catalogId('item', cb, 'd'.repeat(32));
});
afterEach(async () => {
  await app?.close();
  db?.close();
  await upstream?.close();
  local?.cleanup();
});
it('separates same-server identities, catalogs, representatives, counts, and guessed IDs in both directions', async () => {
  for (const [cookie, own, foreign, ownItem, foreignItem, title] of [
    [alice, ca, cb, ia, ib, 'Alice private movie'],
    [bob, cb, ca, ib, ia, 'Bob private movie'],
  ] as const) {
    const connections = await get('/api/v1/connectors', cookie);
    expect(connections.json().connectors.map((v: { id: string }) => v.id)).toEqual([own]);
    const works = (await get('/api/v1/catalog/works', cookie)).json();
    expect(works.items).toHaveLength(1);
    expect(works.items[0]).toMatchObject({
      title,
      memberCount: 1,
      connectionCount: 1,
      sourceCount: 1,
      representativeItemId: ownItem,
    });
    const detail = (await get('/api/v1/catalog/works/' + works.items[0].id, cookie)).json();
    expect(detail.sources.total).toBe(1);
    expect(detail.sources.items[0].connectorId).toBe(own);
    expect((await get('/api/v1/catalog/items/' + foreignItem, cookie)).statusCode).toBe(404);
    expect(
      (await get('/api/v1/catalog/items/' + foreignItem + '/artwork/poster', cookie)).statusCode,
    ).toBe(404);
    expect((await post('/api/v1/catalog/sync/' + foreign, {}, cookie)).statusCode).toBe(404);
    expect((await post('/api/v1/connectors/' + foreign + '/test', {}, cookie)).statusCode).toBe(
      404,
    );
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: '/api/v1/connectors/' + foreign,
          headers: headers(cookie),
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await post('/api/v1/playback/sessions', { itemId: foreignItem, profile }, cookie))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await post(
          '/api/v1/playback/sessions',
          { groupId: works.items[0].id, sourceItemId: foreignItem, profile },
          cookie,
        )
      ).statusCode,
    ).toBe(404);
    const libraries = (await get('/api/v1/catalog/libraries', cookie)).json().libraries;
    expect(libraries).toHaveLength(1);
    expect(libraries[0].connectorId).toBe(own);
    expect(
      (
        await get(
          '/api/v1/catalog/libraries/' + catalogId('lib', foreign, '3'.repeat(32)) + '/items',
          cookie,
        )
      ).statusCode,
    ).toBe(404);
    expect((await get('/api/v1/catalog/items/' + ownItem, cookie)).statusCode).toBe(200);
  }
  const artworkA = await get('/api/v1/catalog/items/' + ia + '/artwork/poster', alice),
    artworkB = await get('/api/v1/catalog/items/' + ib + '/artwork/poster', bob);
  expect(artworkA.statusCode).toBe(200);
  expect(artworkB.statusCode).toBe(200);
  expect(artworkA.rawPayload.equals(artworkB.rawPayload)).toBe(false);
  expect(
    b.requests
      .filter((r) => r.authorization)
      .every((r) => !r.authorization.includes(upstream.state.token)),
  ).toBe(true);
});
it('binds credential envelopes to owner/server and rejects wrong-user reads and swapped ciphertext', async () => {
  const vault = new EncryptedCredentialStore(db, local.config.masterKey!);
  try {
    await expect(vault.forUser('bob').read({ id: ca })).rejects.toMatchObject({
      code: 'credential_unavailable',
    });
    const raw = new Database(local.config.databasePath),
      original = db.getConnector(ca)!.credentialEnvelope;
    raw
      .prepare('UPDATE media_connectors SET credential_envelope=? WHERE id=?')
      .run(db.getConnector(cb)!.credentialEnvelope, ca);
    await expect(vault.forUser('alice').read({ id: ca })).rejects.toMatchObject({
      code: 'credential_unavailable',
    });
    raw.prepare('UPDATE media_connectors SET credential_envelope=? WHERE id=?').run(original, ca);
    db.createUser(
      {
        id: 'charlie',
        username: 'charlie',
        displayName: 'Charlie',
        role: 'user',
        passwordHash: 'synthetic',
      },
      Date.now(),
    );
    raw.prepare('UPDATE media_connectors SET owner_user_id=? WHERE id=?').run('charlie', ca);
    await expect(vault.forUser('charlie').read({ id: ca })).rejects.toMatchObject({
      code: 'credential_unavailable',
    });
    raw.prepare('UPDATE media_connectors SET owner_user_id=? WHERE id=?').run('alice', ca);
    raw.close();
    const secret = await vault.forUser('alice').read({ id: ca });
    secret.fill(0);
  } finally {
    vault.destroy();
  }
});
it('uses only the personal playback token, fences grant/report IDs, and stores source-specific resume privately', async () => {
  const pa = await post('/api/v1/playback/sessions', { itemId: ia, profile }, alice),
    pb = await post('/api/v1/playback/sessions', { itemId: ib, profile }, bob);
  expect(pa.statusCode, pa.body).toBe(201);
  expect(pb.statusCode, pb.body).toBe(201);
  const sa = pa.json(),
    sb = pb.json();
  expect((await get(sa.streamPath, bob)).statusCode).toBe(410);
  expect(
    (
      await post(
        '/api/v1/playback/sessions/' + sa.id + '/progress',
        { event: 'start', positionMs: 3000, paused: false },
        bob,
      )
    ).statusCode,
  ).toBe(410);
  expect(
    (
      await post(
        '/api/v1/playback/sessions/' + sb.id + '/progress',
        { event: 'start', positionMs: 4000, paused: false },
        bob,
      )
    ).statusCode,
  ).toBe(204);
  expect(b.playback.reports).toHaveLength(1);
  expect(upstream.state.playback.reports).toHaveLength(0);
  expect(db.forUser('bob').resume(ib)?.positionMs).toBe(4000);
  expect(db.forUser('alice').resume(ib)).toBeUndefined();
  expect(db.forUser('alice').resume(ia)).toBeUndefined();
  await post('/api/v1/playback/sessions/' + sb.id + '/stop', {}, bob);
  const resumed = await post('/api/v1/playback/sessions', { itemId: ib, profile }, bob);
  expect(resumed.json().resumePositionMs).toBe(4000);
  await post('/api/v1/auth/logout', {}, bob);
  expect((await get(resumed.json().streamPath, bob)).statusCode).toBe(401);
  expect(db.forUser('bob').getConnector(cb)).toBeDefined();
  expect(b.revoked).toBe(0);
  expect((await get(sa.streamPath, alice)).statusCode).toBe(200);
});
it('denies fresh details/artwork/playback after upstream item access is revoked', async () => {
  b.catalog = [];
  const blocked = await get('/api/v1/catalog/works');
  expect(blocked.statusCode).toBe(503);
  expect(blocked.body).not.toContain('Bob private movie');
  expect((await get('/api/v1/catalog/items/' + ib)).statusCode).toBe(404);
  expect((await get('/api/v1/catalog/items/' + ib + '/artwork/poster')).statusCode).toBe(502);
  expect((await post('/api/v1/playback/sessions', { itemId: ib, profile })).statusCode).toBe(502);
  expect(b.requests.some((r) => r.path.includes('/PlaybackInfo'))).toBe(false);
  await sync(cb, bob);
  expect((await get('/api/v1/catalog/works')).json().total).toBe(0);
});
it('disconnect removes only the owner connection/resume; reconnect gets fresh IDs and cannot reuse old grants', async () => {
  db.forUser('bob').saveResume(ib, 4000, 12000);
  const started = await post('/api/v1/playback/sessions', { itemId: ib, profile }),
    session = started.json();
  expect(started.statusCode).toBe(201);
  const removed = await app.inject({
    method: 'DELETE',
    url: '/api/v1/connectors/' + cb,
    headers: headers(bob),
  });
  expect(removed.statusCode).toBe(200);
  expect(b.revoked).toBe(1);
  expect(upstream.state.revoked).toBe(0);
  expect(db.forUser('bob').resume(ib)).toBeUndefined();
  expect((await get(session.streamPath)).statusCode).toBe(410);
  const linked = await link(bob, 'bob-jellyfin');
  expect(linked.statusCode).toBe(201);
  expect(linked.json().connector.id).not.toBe(cb);
  await sync(linked.json().connector.id, bob);
  expect((await get('/api/v1/catalog/items/' + ib)).statusCode).toBe(404);
  expect((await get('/api/v1/catalog/items/' + ia, alice)).statusCode).toBe(200);
});
it('rejects unapproved destinations before sending a password and keeps legacy records quarantined', async () => {
  const requests = b.requests.length;
  expect(
    (
      await post('/api/v1/connectors', {
        name: 'Unapproved',
        baseUrl: 'http://127.0.0.1:9',
        username: 'bob-jellyfin',
        password: upstreamPassword,
      })
    ).statusCode,
  ).toBe(400);
  expect(b.requests.length).toBe(requests);
  const vault = new EncryptedCredentialStore(db, local.config.masterKey!);
  vault.create(
    { ...db.getConnector(ca)!, id: 'legacy', baseUrl: 'http://legacy.invalid' },
    Buffer.from('legacy-secret'),
  );
  vault.destroy();
  const run = db.catalog.begin('legacy', null);
  db.catalog.stageLibrary(run, { id: 'legacy-lib', name: 'Legacy', mediaTypes: ['movie'] });
  db.catalog.stagePage(run, 'legacy-lib', [
    {
      id: 'legacy-item',
      libraryId: 'legacy-lib',
      title: 'Legacy hidden',
      type: 'movie',
      providerIds: {},
    },
  ]);
  db.catalog.publish(run);
  expect(db.catalog.item(catalogId('item', 'legacy', 'legacy-item'))).toBeDefined();
  for (const cookie of [alice, bob]) {
    expect(
      (await get('/api/v1/catalog/items/' + catalogId('item', 'legacy', 'legacy-item'), cookie))
        .statusCode,
    ).toBe(404);
    expect((await get('/api/v1/catalog/works', cookie)).body).not.toContain('Legacy hidden');
  }
});
it('withholds delayed artwork after logout without affecting another person', async () => {
  let release!: () => void;
  b.artwork.wait = new Promise<void>((r) => (release = r));
  const pending = get('/api/v1/catalog/items/' + ib + '/artwork/poster').then((r) => r.statusCode);
  try {
    await expect.poll(() => b.requests.some((r) => r.path.includes('/Images/'))).toBe(true);
    await post('/api/v1/auth/logout', {}, bob);
    release();
    expect(await pending).toBe(401);
    expect((await get('/api/v1/catalog/items/' + ia, alice)).statusCode).toBe(200);
  } finally {
    release();
  }
});
it('does not persist a new Jellyfin session if OpenFlix logout wins the authentication race', async () => {
  await app.inject({ method: 'DELETE', url: '/api/v1/connectors/' + cb, headers: headers(bob) });
  const before = b.requests.filter((r) => r.path.endsWith('AuthenticateByName')).length;
  let release!: () => void;
  b.authWait = new Promise<void>((r) => (release = r));
  const pending = link(bob, 'bob-jellyfin').then((r) => r.statusCode);
  try {
    await expect
      .poll(() => b.requests.filter((r) => r.path.endsWith('AuthenticateByName')).length)
      .toBe(before + 1);
    await post('/api/v1/auth/logout', {}, bob);
    release();
    expect(await pending).toBe(502);
    expect(db.forUser('bob').listConnectors()).toEqual([]);
    expect(b.revoked).toBe(2);
    expect(b.valid).toBe(false);
  } finally {
    release();
  }
});
it.each(['logout', 'disconnect'] as const)(
  'cancels an in-flight personal sync on %s without publishing stale data',
  async (action) => {
    const before = b.requests.filter((r) => r.path.startsWith('/jellyfin/Items?')).length;
    let release!: () => void;
    b.catalogWait = new Promise<void>((r) => (release = r));
    b.catalog = [{ Id: 'e'.repeat(32), Name: 'Must not publish', Type: 'Movie' }];
    try {
      expect((await post('/api/v1/catalog/sync/' + cb)).statusCode).toBe(202);
      await expect
        .poll(() => b.requests.filter((r) => r.path.startsWith('/jellyfin/Items?')).length)
        .toBe(before + 1);
      if (action === 'logout') {
        await post('/api/v1/auth/logout', {}, bob);
        release();
        await expect.poll(() => db.catalog.status(cb).state).toBe('failed');
      } else {
        const removing = app
          .inject({ method: 'DELETE', url: '/api/v1/connectors/' + cb, headers: headers(bob) })
          .then((r) => r.statusCode);
        await expect.poll(() => db.getConnector(cb)).toBeUndefined();
        release();
        expect(await removing).toBe(200);
      }
      expect(db.catalog.item(catalogId('item', cb, 'e'.repeat(32)))).toBeUndefined();
      expect(db.catalog.item(ia)).toBeDefined();
    } finally {
      release();
    }
  },
);
it('denies token-revoked catalog reads including empty pages, and hides revoked library metadata', async () => {
  b.valid = false;
  for (const path of [
    '/api/v1/catalog/works',
    '/api/v1/catalog/works?offset=999',
    '/api/v1/catalog/libraries',
  ]) {
    const response = await get(path);
    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain('Bob');
  }
  const connections = await get('/api/v1/connectors');
  expect(connections.json().connectors[0].libraries).toEqual([]);
  b.valid = true;
  b.hideLibraries = true;
  expect((await get('/api/v1/catalog/libraries')).statusCode).toBe(503);
  expect((await get('/api/v1/catalog/works', alice)).statusCode).toBe(200);
});
it('checks an approved server identity before forwarding a new personal password', async () => {
  await app.inject({ method: 'DELETE', url: '/api/v1/connectors/' + cb, headers: headers(bob) });
  const count = b.requests.filter((r) => r.path.endsWith('AuthenticateByName')).length;
  upstream.state.serverId = 'f'.repeat(32);
  const result = await link(bob, 'bob-jellyfin');
  expect(result.statusCode).toBe(502);
  expect(result.json().code).toBe('identity_mismatch');
  expect(b.requests.filter((r) => r.path.endsWith('AuthenticateByName'))).toHaveLength(count);
  expect(db.forUser('bob').listConnectors()).toEqual([]);
});
it('bounds metadata authorization work and refuses oversized source groups without contacting upstream', async () => {
  const run = db.catalog.begin(cb, null),
    libraryId = '3'.repeat(32);
  db.catalog.stageLibrary(run, { id: libraryId, name: 'Bob library', mediaTypes: ['movie'] });
  const rows = Array.from({ length: 257 }, (_, i) => ({
    id: (i + 1).toString(16).padStart(32, '0'),
    libraryId,
    title: 'Oversized private group',
    type: 'movie' as const,
    providerIds: { Tmdb: '998' },
  }));
  for (let offset = 0; offset < rows.length; offset += 100)
    db.catalog.stagePage(run, libraryId, rows.slice(offset, offset + 100));
  db.catalog.publish(run);
  const before = b.requests.length,
    result = await get('/api/v1/catalog/works');
  expect(result.statusCode).toBe(503);
  expect(result.body).not.toContain('Oversized private group');
  expect(b.requests).toHaveLength(before);
});
