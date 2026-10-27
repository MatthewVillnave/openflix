import { afterEach, expect, it, vi } from 'vitest';
import * as discovery from '../apps/server/src/discovery.js';
import { buildApp } from '../apps/server/src/app.js';
import { provisionUser } from '../apps/server/src/auth.js';
import { openDatabase } from '../packages/database/dist/index.js';
import { temporaryConfig, testPassword } from './helpers.js';
afterEach(() => vi.restoreAllMocks());
it('requires admin and matching origin; never discovers on GET; drops late replies after logout', async () => {
  const discover = vi
    .spyOn(discovery, 'discoverJellyfin')
    .mockResolvedValue({ candidates: [], unavailable: false });
  const fixture = temporaryConfig({ OPENFLIX_BASE_URL: 'https://openflix.example' }),
    db = openDatabase(fixture.config.databasePath);
  await provisionUser(db, 'operator', testPassword, 'admin');
  await provisionUser(db, 'viewer', testPassword);
  db.close();
  const app = await buildApp(fixture.config);
  try {
    const login = async (username: string) => {
      const r = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: { origin: fixture.config.origin },
        payload: { username, password: testPassword },
      });
      return (r.headers['set-cookie'] as string).split(';')[0]!;
    };
    const post = (cookie?: string, origin = fixture.config.origin, remoteAddress = '127.0.0.2') =>
      app.inject({
        method: 'POST',
        url: '/api/v1/connectors/discover',
        remoteAddress,
        headers: { origin, ...(cookie ? { cookie } : {}) },
        payload: {},
      });
    expect((await post(undefined, fixture.config.origin, '127.0.0.3')).statusCode).toBe(401);
    expect((await post(await login('viewer'), fixture.config.origin, '127.0.0.4')).statusCode).toBe(
      403,
    );
    const cookie = await login('operator');
    expect((await post(cookie, 'https://other.example', '127.0.0.5')).statusCode).toBe(403);
    expect(
      (await app.inject({ url: '/api/v1/connectors/discover', headers: { cookie } })).statusCode,
    ).toBe(404);
    expect(discover).not.toHaveBeenCalled();
    const result = await post(cookie);
    expect(result.statusCode).toBe(200);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(discover).toHaveBeenCalledOnce();
    let resolve!: (result: Awaited<ReturnType<typeof discovery.discoverJellyfin>>) => void;
    discover.mockImplementation(() => new Promise((r) => (resolve = r)));
    const late = post(cookie);
    await vi.waitFor(() => expect(discover).toHaveBeenCalledTimes(2));
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { origin: fixture.config.origin, cookie },
      payload: {},
    });
    resolve({
      candidates: [{ name: 'Private', serverId: 's', baseUrl: 'http://192.168.1.20' }],
      unavailable: false,
    });
    expect((await late).statusCode).toBe(401);
  } finally {
    await app.close();
    fixture.cleanup();
  }
});
