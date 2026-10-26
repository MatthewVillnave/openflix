import { expect, it } from 'vitest';
import { buildApp } from '../apps/server/src/app.js';
import { temporaryConfig, testPassword } from './helpers.js';

it('permits exactly one initial owner, survives restart, and retains normal login', async () => {
  const fixture = temporaryConfig();
  let app = await buildApp(fixture.config);
  const origin = fixture.config.origin;
  const create = (username: string, password = testPassword, requestOrigin = origin) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/auth/setup',
      headers: { origin: requestOrigin },
      payload: { username, password },
    });
  try {
    expect((await app.inject('/api/v1/auth/setup')).json()).toEqual({ setupRequired: true });
    expect((await create('alice', 'short')).statusCode).toBe(400);
    expect((await create('alice', testPassword, 'https://evil.example')).statusCode).toBe(403);
    const results = await Promise.all([create('alice'), create('bob')]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    const winner = results[0]!.statusCode === 201 ? 'alice' : 'bob';
    expect((await app.inject('/api/v1/auth/setup')).json()).toEqual({ setupRequired: false });
    await app.close();
    app = await buildApp(fixture.config);
    expect((await create('third')).statusCode).toBe(409);
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin },
      payload: { username: winner, password: testPassword },
    });
    expect(login.statusCode).toBe(200);
    expect(login.json().user.role).toBe('admin');
    expect(login.body).not.toContain(testPassword);
  } finally {
    await app.close();
    fixture.cleanup();
  }
});
