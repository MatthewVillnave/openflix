import { randomBytes } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { Writable } from 'node:stream';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../apps/server/src/app.js';
import { createLogger } from '../apps/server/src/logger.js';
import { provisionUser } from '../apps/server/src/auth.js';
import { openDatabase, migrate, migrations } from '../packages/database/dist/index.js';
import { temporaryConfig, testPassword } from './helpers.js';
import { jellyfinFixture, upstreamPassword } from './jellyfin-fixture.js';

describe('administrator media server lifecycle', () => {
  let fixture: ReturnType<typeof temporaryConfig>;
  let upstream: Awaited<ReturnType<typeof jellyfinFixture>>;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let cookie: string;
  let logs: string;
  let logger: ReturnType<typeof createLogger>;
  const origin = 'https://openflix.example';
  beforeEach(async () => {
    fixture = temporaryConfig({
      OPENFLIX_MASTER_KEY: randomBytes(32).toString('base64'),
      OPENFLIX_BASE_URL: origin,
      OPENFLIX_LOG_LEVEL: 'info',
    });
    upstream = await jellyfinFixture();
    const db = openDatabase(fixture.config.databasePath);
    await provisionUser(db, 'operator', testPassword, 'admin');
    await provisionUser(db, 'viewer', testPassword);
    db.close();
    logs = '';
    const sink = new Writable({
      write(chunk, _encoding, callback) {
        logs += String(chunk);
        callback();
      },
    });
    logger = createLogger(fixture.config, sink);
    app = await buildApp(fixture.config, logger);
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin },
      payload: { username: 'operator', password: testPassword },
    });
    cookie = (login.headers['set-cookie'] as string).split(';')[0]!;
  });
  afterEach(async () => {
    await app.close();
    await upstream.close();
    fixture.cleanup();
  });
  const add = () =>
    app.inject({
      method: 'POST',
      url: '/api/v1/connectors',
      headers: { origin, cookie },
      payload: {
        name: 'Living room',
        baseUrl: upstream.baseUrl,
        username: 'fixture-user',
        password: upstreamPassword,
      },
    });
  it('adds, lists, persists encrypted credentials, reloads/reconnects and removes without secret leakage', async () => {
    const added = await add();
    expect(added.statusCode, added.body).toBe(201);
    const id = added.json().connector.id;
    expect(added.json().connector.libraries[0].name).toBe('Accessible movies');
    const listed = await app.inject({ url: '/api/v1/connectors', headers: { cookie } });
    expect(listed.statusCode).toBe(200);
    const db = openDatabase(fixture.config.databasePath);
    const stored = db.getConnector(id)!;
    db.close();
    expect(stored.credentialEnvelope).toContain('aes-256-gcm');
    for (const secret of [upstreamPassword, upstream.state.token, fixture.config.masterKey!]) {
      expect(JSON.stringify(stored)).not.toContain(secret);
      expect(added.body + listed.body + logs).not.toContain(secret);
      for (const suffix of ['', '-wal', '-shm']) {
        const file = fixture.config.databasePath + suffix;
        if (existsSync(file)) expect(readFileSync(file).includes(Buffer.from(secret))).toBe(false);
      }
    }
    expect(added.body + listed.body).not.toContain('credentialEnvelope');
    expect(added.body + listed.body).not.toContain('ciphertext');
    await app.close();
    app = await buildApp(fixture.config, logger);
    const reloaded = await app.inject({ url: '/api/v1/connectors', headers: { cookie } });
    expect(reloaded.json().connectors[0].state).toBe('unverified');
    const tested = await app.inject({
      method: 'POST',
      url: `/api/v1/connectors/${id}/test`,
      headers: { origin, cookie },
      payload: {},
    });
    expect(tested.statusCode, tested.body).toBe(200);
    expect(tested.json().connector.state).toBe('connected');
    expect(
      upstream.state.requests.filter((r) => r.path.endsWith('AuthenticateByName')),
    ).toHaveLength(1);
    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/v1/connectors/${id}`,
      headers: { origin, cookie },
    });
    expect(removed.json()).toEqual({ removed: true, revocation: 'confirmed' });
    expect(upstream.state.revoked).toBe(1);
    expect(
      (await app.inject({ url: '/api/v1/connectors', headers: { cookie } })).json().connectors,
    ).toEqual([]);
    const check = openDatabase(fixture.config.databasePath);
    expect(check.getConnector(id)).toBeUndefined();
    for (const secret of [upstreamPassword, upstream.state.token, fixture.config.masterKey!])
      expect(logs).not.toContain(secret);
    check.close();
  });
  it('rejects anonymous/non-admin access and keeps origin/body security', async () => {
    expect((await app.inject('/api/v1/connectors')).statusCode).toBe(401);
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin },
      payload: { username: 'viewer', password: testPassword },
    });
    const viewer = (login.headers['set-cookie'] as string).split(';')[0]!;
    for (const method of ['GET', 'POST', 'DELETE'] as const) {
      const response = await app.inject({
        method,
        url:
          method === 'DELETE'
            ? '/api/v1/connectors/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
            : '/api/v1/connectors',
        headers: { origin, cookie: viewer },
        ...(method === 'POST'
          ? {
              payload: {
                name: 'Server',
                baseUrl: upstream.baseUrl,
                username: 'fixture-user',
                password: upstreamPassword,
              },
            }
          : {}),
      });
      expect(response.statusCode).toBe(403);
    }
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/connectors',
          headers: { cookie },
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
    expect(upstream.state.requests).toHaveLength(0);
  });
  it('normalizes upstream auth failures and logs no credentials', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/connectors',
      headers: { origin, cookie },
      payload: {
        name: 'Test',
        baseUrl: upstream.baseUrl,
        username: 'fixture-user',
        password: 'bad-upstream-secret',
      },
    });
    expect(response.statusCode).toBe(502);
    expect(response.json().code).toBe('unauthorized');
    expect(logs + response.body).not.toContain('bad-upstream-secret');
    expect(
      (await app.inject({ url: '/api/v1/connectors', headers: { cookie } })).json().connectors,
    ).toEqual([]);
  });
  it('marks failed tests honestly and reports unconfirmed remote revocation when offline', async () => {
    const id = (await add()).json().connector.id;
    upstream.state.mode = 'unreachable';
    const tested = await app.inject({
      method: 'POST',
      url: `/api/v1/connectors/${id}/test`,
      headers: { origin, cookie },
      payload: {},
    });
    expect(tested.statusCode).toBe(502);
    const list = await app.inject({ url: '/api/v1/connectors', headers: { cookie } });
    expect(list.json().connectors[0]).toMatchObject({
      state: 'error',
      lastError: 'unavailable',
      libraries: [],
    });
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/v1/connectors/${id}`,
          headers: { origin, cookie },
        })
      ).json(),
    ).toEqual({ removed: true, revocation: 'unconfirmed' });
  });
  it('fails startup with a wrong/missing key or tampered origin before any upstream request', async () => {
    const id = (await add()).json().connector.id;
    await app.close();
    upstream.state.requests = [];
    await expect(
      buildApp({ ...fixture.config, masterKey: randomBytes(32).toString('base64') }),
    ).rejects.toMatchObject({ code: 'credential_unavailable' });
    await expect(buildApp({ ...fixture.config, masterKey: undefined })).rejects.toMatchObject({
      code: 'credential_unavailable',
    });
    const raw = new Database(fixture.config.databasePath);
    raw
      .prepare('UPDATE media_connectors SET base_url = ? WHERE id = ?')
      .run('http://unexpected.invalid', id);
    raw.close();
    await expect(buildApp(fixture.config)).rejects.toMatchObject({
      code: 'credential_unavailable',
    });
    expect(upstream.state.requests).toHaveLength(0);
  });
  it('keeps foundations available without a key but disables credential creation', async () => {
    await app.close();
    app = await buildApp({ ...fixture.config, masterKey: undefined }, logger);
    expect((await app.inject('/health')).statusCode).toBe(200);
    expect(
      (await app.inject({ url: '/api/v1/connectors', headers: { cookie } })).json()
        .credentialStorageConfigured,
    ).toBe(false);
    expect((await add()).statusCode).toBe(503);
    expect(upstream.state.requests).toHaveLength(0);
  });
});
it('migrates the audited R2 identity schema without changing accounts or sessions', () => {
  const fixture = temporaryConfig();
  try {
    const raw = new Database(fixture.config.databasePath);
    migrate(raw, [migrations[0]!]);
    raw
      .prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?)')
      .run('u', 'name', 'Name', 'test-hash', 'admin', 1);
    raw
      .prepare('INSERT INTO user_sessions VALUES (?, ?, ?, ?)')
      .run('digest', 'u', 1, 9999999999999);
    raw.close();
    const db = openDatabase(fixture.config.databasePath);
    expect(db.findUser('name')?.passwordHash).toBe('test-hash');
    expect(db.sessionUser('digest', 2)?.id).toBe('u');
    expect(db.listConnectors()).toEqual([]);
    db.close();
    const check = new Database(fixture.config.databasePath);
    expect(check.prepare('SELECT count(*) AS n FROM schema_migrations').get()).toEqual({ n: 2 });
    check.close();
  } finally {
    fixture.cleanup();
  }
});
