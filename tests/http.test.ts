import { Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../apps/server/src/app.js';
import { createLogger } from '../apps/server/src/logger.js';
import { openDatabase } from '../packages/database/dist/index.js';
import { provisionUser } from '../apps/server/src/auth.js';
import { temporaryConfig, testPassword } from './helpers.js';
describe('HTTP API security and health', () => {
  let fixture: ReturnType<typeof temporaryConfig>;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let logs: string;
  const origin = 'https://openflix.example';
  beforeEach(async () => {
    fixture = temporaryConfig({
      NODE_ENV: 'production',
      OPENFLIX_BASE_URL: origin,
      OPENFLIX_LOG_LEVEL: 'info',
    });
    const db = openDatabase(fixture.config.databasePath);
    await provisionUser(db, 'alice', testPassword);
    db.close();
    logs = '';
    const sink = new Writable({
      write(chunk, _encoding, callback) {
        logs += String(chunk);
        callback();
      },
    });
    app = await buildApp(fixture.config, createLogger(fixture.config, sink));
  });
  afterEach(async () => {
    await app.close();
    fixture.cleanup();
  });
  async function signIn() {
    return app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin },
      payload: { username: 'alice', password: testPassword },
    });
  }
  it('reports real DB readiness without connector or peer claims', async () => {
    const result = await app.inject('/health');
    expect(result.statusCode).toBe(200);
    expect(result.json()).toEqual({ status: 'healthy', database: 'ok' });
    expect(result.headers['content-security-policy']).toBeDefined();
    expect(result.headers['cache-control']).toBe('no-store');
  });
  it('logs in with secure cookies, resolves identity and revokes on logout', async () => {
    expect((await app.inject('/api/v1/me')).statusCode).toBe(401);
    const result = await signIn();
    expect(result.statusCode).toBe(200);
    const cookie = result.headers['set-cookie'] as string;
    expect(cookie).toContain('__Host-openflix_session=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).not.toContain('Domain=');
    expect(result.json().user.passwordHash).toBeUndefined();
    const headers = { cookie: cookie.split(';')[0]!, origin };
    expect((await app.inject({ url: '/api/v1/me', headers })).json().user.username).toBe('alice');
    expect(
      (await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers })).statusCode,
    ).toBe(204);
    expect((await app.inject({ url: '/api/v1/me', headers })).statusCode).toBe(401);
  });
  it('returns identical errors for unknown users and bad passwords', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin },
      payload: { username: 'alice', password: 'wrong' },
    });
    const unknown = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin },
      payload: { username: 'nobody', password: 'wrong' },
    });
    expect(response.statusCode).toBe(401);
    expect(response.body).toBe(unknown.body);
    expect(response.headers['set-cookie']).toBeUndefined();
  });
  it.each([undefined, 'null', 'https://evil.example', 'https://openflix.example.evil.test'])(
    'rejects unsafe login and logout origins %s',
    async (badOrigin) => {
      for (const url of ['/api/v1/auth/login', '/api/v1/auth/logout']) {
        const result = await app.inject({
          method: 'POST',
          url,
          headers: badOrigin ? { origin: badOrigin } : {},
          payload: { username: 'alice', password: testPassword },
        });
        expect(result.statusCode).toBe(403);
        expect(result.headers['access-control-allow-origin']).toBeUndefined();
      }
    },
  );
  it('validates JSON, rejects extra fields and oversized requests', async () => {
    for (const payload of [
      { username: 'alice' },
      { username: 123, password: testPassword },
      { username: 'alice', password: testPassword, admin: true },
      { username: 'alice', password: '🔑'.repeat(300) },
    ]) {
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/v1/auth/login',
            headers: { origin },
            payload,
          })
        ).statusCode,
      ).toBe(400);
    }
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          headers: { origin },
          payload: { username: 'alice', password: 'x'.repeat(9000) },
        })
      ).statusCode,
    ).toBe(413);
  });
  it('rate limits repeated login attempts, ignoring forged forwarding headers', async () => {
    let status = 0;
    for (let i = 0; i < 11; i++)
      status = (
        await app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          headers: { origin, 'x-forwarded-for': `10.0.0.${i}` },
          payload: {},
        })
      ).statusCode;
    expect(status).toBe(429);
  });
  it('never logs request secrets, raw URLs, tokens, or malicious error input', async () => {
    const result = await signIn();
    const token = result.cookies[0]!.value;
    await app.inject({
      url: '/missing?token=QUERY_SECRET',
      headers: {
        authorization: 'Bearer HEADER_SECRET',
        cookie: `other=COOKIE_SECRET; __Host-openflix_session=${token}`,
        'x-request-id': 'UNTRUSTED_ID',
      },
    });
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin, 'content-type': 'application/json' },
      payload: '{"password":"BROKEN_SECRET"',
    });
    expect(logs).toContain('http.completed');
    expect(logs).toContain('auth.login');
    for (const secret of [
      testPassword,
      token,
      'QUERY_SECRET',
      'HEADER_SECRET',
      'COOKIE_SECRET',
      'BROKEN_SECRET',
      'UNTRUSTED_ID',
      '$argon2id$',
    ])
      expect(logs).not.toContain(secret);
    for (const line of logs.trim().split('\n')) expect(() => JSON.parse(line)).not.toThrow();
  });
  it('does not expose future milestone endpoints', async () => {
    for (const url of [
      '/api/v1/catalog',
      '/api/v1/admin/connectors',
      '/.well-known/openflix',
      '/api/v1/federation/node',
    ])
      expect((await app.inject(url)).statusCode).toBe(404);
  });
});
