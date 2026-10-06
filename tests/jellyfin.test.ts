import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  authenticateJellyfin,
  createJellyfinConnector,
  validateJellyfinUrl,
} from '../packages/connector-jellyfin/dist/index.js';
import { ConnectorError } from '../packages/connector-core/dist/index.js';
import { jellyfinFixture, upstreamPassword, libraryId, serverId } from './jellyfin-fixture.js';
const deviceId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
describe('Jellyfin URL policy', () => {
  it.each([
    'http://192.168.1.20:8096',
    'http://localhost:8096/jellyfin',
    'https://media.example/jellyfin/',
    'http://[::1]:8096',
  ])('accepts administrator-trusted address %s', (url) =>
    expect(validateJellyfinUrl(url)).toBe(url.replace(/\/$/, '')),
  );
  it.each([
    'https://media.example?',
    'https://media.example#',
    'http://@media.example',
    'file:///etc/passwd',
    'ftp://media.example',
    'http:media.example',
    'https://user:secret@media.example',
    'https://media.example?token=secret',
    'https://media.example/#fragment',
    'https://media.example/a/../b',
    'https://media.example/%2fsecret',
    'https://media.example\\@evil.example',
    'https://media.example/ space',
  ])('rejects unsafe URL %s', (url) =>
    expect(() => validateJellyfinUrl(url)).toThrow(ConnectorError),
  );
});
describe('current Jellyfin SDK wire contract', () => {
  let upstream: Awaited<ReturnType<typeof jellyfinFixture>>;
  beforeEach(async () => {
    upstream = await jellyfinFixture();
  });
  afterEach(async () => upstream.close());
  const login = () =>
    authenticateJellyfin({
      baseUrl: upstream.baseUrl,
      deviceId,
      username: 'fixture-user',
      password: upstreamPassword,
    });
  async function saved() {
    const result = await login();
    const connector = createJellyfinConnector(
      { baseUrl: upstream.baseUrl, credential: { id: deviceId } },
      {
        async read() {
          return Uint8Array.from(result.secret);
        },
        async store() {
          return { id: deviceId };
        },
        async delete() {},
      },
    );
    return { result, connector };
  }
  it.each(['12.1.0', '12.0.0', '10.11.1'])(
    'authenticates and enumerates only user-visible libraries for schema %s',
    async (version) => {
      upstream.state.version = version;
      const { result, connector } = await saved();
      expect(result.server).toEqual({ id: serverId, name: 'Fixture Jellyfin', version });
      expect(result.libraries).toEqual([
        {
          id: libraryId,
          name: 'Accessible movies',
          mediaTypes: ['movie'],
          type: 'movie',
          upstreamType: 'movies',
        },
      ]);
      expect(Buffer.from(result.secret).toString()).not.toContain(upstreamPassword);
      await connector.connect();
      expect(await connector.testConnection()).toEqual({
        ok: true,
        serverName: 'Fixture Jellyfin',
      });
      expect(await connector.getLibraries()).toEqual(result.libraries);
      expect(
        upstream.state.requests.every(
          (r) => !r.path.includes('MediaFolders') && !r.path.includes('Items'),
        ),
      ).toBe(true);
      await connector.disconnect();
      expect(upstream.state.revoked).toBe(1);
      expect(await connector.testConnection()).toMatchObject({ ok: false, code: 'unauthorized' });
      result.secret.fill(0);
    },
  );
  it('normalizes unknown collection kinds without inheriting object properties', async () => {
    upstream.state.collectionType = '__proto__';
    const result = await login();
    expect(result.libraries[0]!.mediaTypes).toEqual([]);
    result.secret.fill(0);
  });
  it('normalizes authentication failure without leaking request secrets', async () => {
    await expect(
      authenticateJellyfin({
        baseUrl: upstream.baseUrl,
        deviceId,
        username: 'fixture-user',
        password: 'wrong-fixture-secret',
      }),
    ).rejects.toMatchObject({
      code: 'unauthorized',
      message: 'Media server authentication was rejected.',
    });
  });
  it.each([
    ['unreachable', 'unavailable'],
    ['redirect', 'unsafe_redirect'],
    ['malformed', 'invalid_response'],
    ['slow', 'timeout'],
    ['oversized', 'unavailable'],
  ] as const)('normalizes %s and never follows redirects', async (mode, code) => {
    upstream.state.mode = mode;
    await expect(login()).rejects.toMatchObject({ code });
    expect(upstream.state.requests).toHaveLength(1);
  });
  it.each(['Users/AuthenticateByName', 'UserViews'])(
    'does not forward credentials across a redirect from %s',
    async (endpoint) => {
      const trap = await jellyfinFixture();
      try {
        upstream.state.mode = 'redirect';
        upstream.state.redirectPath = `/jellyfin/${endpoint}`;
        upstream.state.redirectTarget = `${trap.baseUrl}/credential-trap`;
        await expect(login()).rejects.toMatchObject({ code: 'unsafe_redirect' });
        expect(trap.state.requests).toHaveLength(0);
        if (endpoint === 'UserViews') expect(upstream.state.revoked).toBe(1);
      } finally {
        await trap.close();
      }
    },
  );
  it('rejects unsupported versions before sending a password', async () => {
    upstream.state.version = '10.8.13';
    await expect(login()).rejects.toMatchObject({ code: 'unsupported' });
    expect(upstream.state.requests).toHaveLength(1);
    expect(upstream.state.requests[0]!.body).toBe('');
  });
  it('refuses to forward a saved credential if server identity changes', async () => {
    const { connector } = await saved();
    upstream.state.requests = [];
    upstream.state.serverId = '44444444444444444444444444444444';
    await expect(connector.connect()).rejects.toMatchObject({ code: 'identity_mismatch' });
    expect(upstream.state.requests).toHaveLength(1);
    expect(upstream.state.requests[0]!.authorization).not.toContain(upstream.state.token);
  });
  it('rejects a secret echoed in server metadata and revokes the newly issued session', async () => {
    upstream.state.name = upstreamPassword;
    await expect(login()).rejects.toMatchObject({ code: 'invalid_response' });
    expect(upstream.state.revoked).toBe(1);
  });
});
