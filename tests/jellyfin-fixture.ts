/** Disposable wire fixture derived from the pinned official OpenAPI operations.
 * It is not a real Jellyfin integration or a replacement for Optimus's audit. */
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
export const serverId = '11111111111111111111111111111111';
export const userId = '22222222222222222222222222222222';
export const libraryId = '33333333333333333333333333333333';
export const upstreamPassword = 'fixture-only-jellyfin-password';
export async function jellyfinFixture() {
  const state = {
    collectionType: 'movies',
    version: '12.1.0',
    serverId,
    name: 'Fixture Jellyfin',
    token: randomBytes(32).toString('hex'),
    redirectPath: '',
    redirectTarget: '/credential-trap',
    valid: false,
    revoked: 0,
    mode: 'normal' as 'normal' | 'redirect' | 'malformed' | 'unreachable' | 'slow' | 'oversized',
    requests: [] as { path: string; authorization: string; body: string }[],
  };
  const server = createServer(async (request, response) => {
    const path = request.url ?? '/';
    let body = '';
    for await (const chunk of request) body += String(chunk);
    const authorization = request.headers.authorization ?? '';
    state.requests.push({ path, authorization, body });
    const json = (data: unknown, status = 200) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(data));
    };
    if (state.mode === 'unreachable') {
      request.socket.destroy();
      return;
    }
    if (state.mode === 'slow') return;
    if (state.mode === 'redirect' && (!state.redirectPath || path.startsWith(state.redirectPath))) {
      response.writeHead(302, { location: state.redirectTarget });
      response.end();
      return;
    }
    if (state.mode === 'malformed') {
      json({ AccessToken: state.token, garbage: true });
      return;
    }
    if (state.mode === 'oversized') {
      json({ padding: 'x'.repeat(1024 * 1024 + 100) });
      return;
    }
    if (path === '/jellyfin/System/Info/Public') {
      json({
        Id: state.serverId,
        ServerName: state.name,
        Version: state.version,
        ProductName: 'Jellyfin',
      });
      return;
    }
    if (path === '/jellyfin/Users/AuthenticateByName' && request.method === 'POST') {
      const input = JSON.parse(body);
      if (input.Username !== 'fixture-user' || input.Pw !== upstreamPassword) {
        json({ error: 'wrong password' }, 401);
        return;
      }
      state.valid = true;
      json({
        AccessToken: state.token,
        User: { Id: userId, Name: 'fixture-user' },
        ServerId: state.serverId,
      });
      return;
    }
    if (!state.valid || !authorization.includes(`Token="${state.token}"`)) {
      json({}, 401);
      return;
    }
    if (path === '/jellyfin/Users/Me') {
      json({ Id: userId, Name: 'fixture-user' });
      return;
    }
    if (path.startsWith('/jellyfin/UserViews?')) {
      const url = new URL(path, 'http://fixture');
      if (
        url.searchParams.get('userId') !== userId ||
        url.searchParams.get('includeHidden') !== 'false' ||
        url.searchParams.get('includeExternalContent') !== 'false'
      ) {
        json({}, 400);
        return;
      }
      json({
        Items: [{ Id: libraryId, Name: 'Accessible movies', CollectionType: state.collectionType }],
        TotalRecordCount: 1,
      });
      return;
    }
    if (path === '/jellyfin/Sessions/Logout' && request.method === 'POST') {
      state.valid = false;
      state.revoked++;
      response.writeHead(204);
      response.end();
      return;
    }
    json({}, 404);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fixture listener failed');
  return {
    state,
    baseUrl: `http://127.0.0.1:${address.port}/jellyfin`,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
