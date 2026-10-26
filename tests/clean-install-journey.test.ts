import { randomBytes } from 'node:crypto';
import { expect, it } from 'vitest';
import { buildApp } from '../apps/server/src/app.js';
import { provisionUser } from '../apps/server/src/auth.js';
import { catalogId, openDatabase } from '../packages/database/dist/index.js';
import { jellyfinFixture, upstreamPassword } from './jellyfin-fixture.js';
import { temporaryConfig, testPassword } from './helpers.js';

it('supports a fresh owner and isolated second user through the wire fixture across restart', async () => {
  const local = temporaryConfig({ OPENFLIX_MASTER_KEY: randomBytes(32).toString('base64') });
  const upstream = await jellyfinFixture();
  upstream.state.catalog = [{ Id: 'a'.repeat(32), Name: 'Owner film', Type: 'Movie' }];
  const other = upstream.addAccount('other', '9'.repeat(32));
  other.catalog = [{ Id: 'd'.repeat(32), Name: 'Other film', Type: 'Movie' }];
  let app = await buildApp(local.config);
  const origin = local.config.origin;
  const post = (url: string, payload: object, cookie?: string) =>
    app.inject({
      method: 'POST',
      url,
      headers: { origin, ...(cookie ? { cookie } : {}) },
      payload,
    });
  const get = (url: string, cookie: string) => app.inject({ url, headers: { cookie, origin } });
  const login = async (username: string) => {
    const response = await post('/api/v1/auth/login', { username, password: testPassword });
    expect(response.statusCode).toBe(200);
    return (response.headers['set-cookie'] as string).split(';')[0]!;
  };
  const connect = async (cookie: string, username: string) => {
    const response = await post(
      '/api/v1/connectors',
      { name: 'Fixture library', baseUrl: upstream.baseUrl, username, password: upstreamPassword },
      cookie,
    );
    expect(response.statusCode, response.body).toBe(201);
    const id = response.json().connector.id as string;
    expect((await post('/api/v1/catalog/sync/' + id, {}, cookie)).statusCode).toBe(202);
    await expect
      .poll(async () => (await get('/api/v1/catalog/sync/' + id, cookie)).json().state)
      .toBe('successful');
    return id;
  };
  try {
    expect(
      (await post('/api/v1/auth/setup', { username: 'owner', password: testPassword })).statusCode,
    ).toBe(201);
    let owner = await login('owner');
    const ownerConnection = await connect(owner, 'fixture-user');
    const ownerItem = catalogId('item', ownerConnection, 'a'.repeat(32));
    expect((await get('/api/v1/catalog/works?type=movie', owner)).json().items[0].title).toBe(
      'Owner film',
    );
    const database = openDatabase(local.config.databasePath);
    await provisionUser(database, 'other', testPassword);
    database.close();
    const second = await login('other');
    const secondConnection = await connect(second, 'other');
    const secondItem = catalogId('item', secondConnection, 'd'.repeat(32));
    expect((await get('/api/v1/catalog/works?type=movie', second)).json().items[0].title).toBe(
      'Other film',
    );
    expect((await get('/api/v1/catalog/items/' + ownerItem, second)).statusCode).toBe(404);
    expect((await get('/api/v1/catalog/items/' + secondItem, owner)).statusCode).toBe(404);
    const playback = await post(
      '/api/v1/playback/sessions',
      { itemId: ownerItem, profile: { formats: ['mp4-h264-aac'] } },
      owner,
    );
    expect(playback.statusCode, playback.body).toBe(201);
    const session = playback.json();
    expect((await get(session.streamPath, owner)).statusCode).toBe(200);
    expect((await get(session.streamPath, second)).statusCode).toBe(410);
    expect(
      (
        await post(
          '/api/v1/playback/sessions/' + session.id + '/progress',
          { event: 'start', positionMs: 4000, paused: false },
          owner,
        )
      ).statusCode,
    ).toBe(204);
    await post('/api/v1/playback/sessions/' + session.id + '/stop', {}, owner);
    expect((await post('/api/v1/auth/logout', {}, owner)).statusCode).toBe(204);
    expect((await get('/api/v1/catalog/works', owner)).statusCode).toBe(401);
    await app.close();
    app = await buildApp(local.config);
    owner = await login('owner');
    expect((await get('/api/v1/catalog/works?type=movie', owner)).json().items[0].title).toBe(
      'Owner film',
    );
    const resumed = await post(
      '/api/v1/playback/sessions',
      { itemId: ownerItem, profile: { formats: ['mp4-h264-aac'] } },
      owner,
    );
    expect(resumed.statusCode, resumed.body).toBe(201);
    expect(resumed.json().resumePositionMs).toBe(4000);
  } finally {
    await app.close();
    await upstream.close();
    local.cleanup();
  }
});
