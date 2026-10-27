/** Disposable wire fixture derived from the pinned official OpenAPI operations.
 * It is not a real Jellyfin integration or a replacement for Optimus's audit. */
import { playbackFixtureState, servePlayback } from './playback-fixture.js';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
export const serverId = '11111111111111111111111111111111';
export const userId = '22222222222222222222222222222222';
export const libraryId = '33333333333333333333333333333333';
export const upstreamPassword = 'fixture-only-jellyfin-password';
/** Structural folders observed by Optimus on Jellyfin 10.11.11, including null-type TV. */
export function observedCatalog(types: readonly string[]): Record<string, unknown>[] {
  return types.map((Type, i) => ({
    Id: (i + 1).toString(16).padStart(32, '0'),
    Name: `Observed fixture item ${i + 1}`,
    Type,
  }));
}
export async function jellyfinFixture() {
  const state = {
    artwork: {
      bytes: Buffer.from([255, 216, 255, 192, 0, 8, 8, 0, 1, 0, 1, 1, 255, 217]),
      contentType: 'image/jpeg',
      delay: 0,
      wait: undefined as Promise<void> | undefined,
    },
    authWait: undefined as Promise<void> | undefined,
    catalogWait: undefined as Promise<void> | undefined,
    itemWait: undefined as Promise<void> | undefined,
    itemAborts: 0,
    permissionDelay: 0,
    playback: playbackFixtureState(),
    collectionType: 'movies' as string | null,
    libraryName: 'Accessible movies',
    catalog: [] as Record<string, unknown>[],
    catalogByLibrary: new Map<string, Record<string, unknown>[]>(),
    extraLibraries: [] as { Id: string; Name: string; CollectionType: string | null }[],
    hideLibraries: false,
    catalogFailureAt: -1,
    pageOverride: undefined as undefined | ((offset: number, limit: number) => unknown),
    version: '12.1.0',
    serverId,
    serverIdResponses: [] as string[],
    name: 'Fixture Jellyfin',
    token: randomBytes(32).toString('hex'),
    redirectPath: '',
    redirectTarget: '/credential-trap',
    valid: false,
    revoked: 0,
    mode: 'normal' as 'normal' | 'redirect' | 'malformed' | 'unreachable' | 'slow' | 'oversized',
    requests: [] as { path: string; authorization: string; body: string }[],
  };
  const accounts = new Map<string, { id: string; state: typeof state }>();
  const rootState = state;
  const server = createServer(async (request, response) => {
    const path = request.url ?? '/';
    let body = '';
    for await (const chunk of request) body += String(chunk);
    const authorization = request.headers.authorization ?? '';
    const loginName =
      path === '/jellyfin/Users/AuthenticateByName'
        ? (JSON.parse(body || '{}').Username as string)
        : undefined;
    const account = loginName
      ? accounts.get(loginName)
      : [...accounts.values()].find((a) => authorization.includes(`Token="${a.state.token}"`));
    const state = account?.state ?? rootState;
    const currentUserId = account?.id ?? userId;
    const currentUsername = loginName && account ? loginName : 'fixture-user';
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
      if (state.permissionDelay)
        await new Promise((resolve) => setTimeout(resolve, state.permissionDelay));
      json({
        Id: state.serverIdResponses.shift() ?? state.serverId,
        ServerName: state.name,
        Version: state.version,
        ProductName: 'Jellyfin',
      });
      return;
    }
    if (path === '/jellyfin/Users/AuthenticateByName' && request.method === 'POST') {
      const input = JSON.parse(body);
      if (input.Username !== currentUsername || input.Pw !== upstreamPassword) {
        json({ error: 'wrong password' }, 401);
        return;
      }
      await state.authWait;
      state.valid = true;
      json({
        AccessToken: state.token,
        User: { Id: currentUserId, Name: currentUsername },
        ServerId: state.serverId,
      });
      return;
    }
    if (!state.valid || !authorization.includes(`Token="${state.token}"`)) {
      json({}, 401);
      return;
    }
    if (path === '/jellyfin/Users/Me') {
      json({ Id: currentUserId, Name: currentUsername });
      return;
    }
    if (path.startsWith('/jellyfin/UserViews?')) {
      const url = new URL(path, 'http://fixture');
      if (
        url.searchParams.get('userId') !== currentUserId ||
        url.searchParams.get('includeHidden') !== 'false' ||
        url.searchParams.get('includeExternalContent') !== 'false'
      ) {
        json({}, 400);
        return;
      }
      json({
        Items: state.hideLibraries
          ? []
          : [
              { Id: libraryId, Name: state.libraryName, CollectionType: state.collectionType },
              ...state.extraLibraries,
            ],
        TotalRecordCount: state.hideLibraries ? 0 : 1 + state.extraLibraries.length,
      });
      return;
    }
    const catalogUrl = new URL(path, 'http://fixture');
    if (servePlayback(state.playback, request, response, catalogUrl, body)) return;
    if (/^\/jellyfin\/Items\/[a-f0-9]+\/Images\/(Primary|Backdrop)$/.test(catalogUrl.pathname)) {
      if (state.artwork.delay)
        await new Promise((resolve) => setTimeout(resolve, state.artwork.delay));
      await state.artwork.wait;
      response.writeHead(200, { 'content-type': state.artwork.contentType });
      response.end(state.artwork.bytes);
      return;
    }
    if (catalogUrl.pathname === '/jellyfin/Items') {
      await state.catalogWait;
      const query = catalogUrl.searchParams;
      if (query.has('ids')) {
        if (state.permissionDelay)
          await new Promise((resolve) => setTimeout(resolve, state.permissionDelay));
        response.once('close', () => {
          if (!response.writableEnded) state.itemAborts++;
        });
        await state.itemWait;
        if (response.destroyed) return;
        if (query.get('userId') !== currentUserId) {
          json({}, 403);
          return;
        }
        const requested = query.getAll('ids').flatMap((value) => value.split(','));
        const items = state.catalog.filter((item) => requested.includes(String(item.Id)));
        json({ Items: items, StartIndex: 0, TotalRecordCount: items.length });
        return;
      }
      if (
        query.get('userId') !== currentUserId ||
        query.get('recursive') !== 'true' ||
        query.get('enableImages') !== 'false' ||
        query.get('enableUserData') !== 'false'
      ) {
        json({}, 400);
        return;
      }
      const offset = Number(query.get('startIndex')),
        limit = Number(query.get('limit'));
      if (state.catalogFailureAt >= 0 && offset >= state.catalogFailureAt) {
        json({ secret: state.token }, 500);
        return;
      }
      const items = state.catalogByLibrary.get(query.get('parentId') ?? '') ?? state.catalog;
      json(
        state.pageOverride
          ? state.pageOverride(offset, limit)
          : {
              Items: items.slice(offset, offset + limit),
              TotalRecordCount: items.length,
              StartIndex: offset,
            },
      );
      return;
    }
    if (catalogUrl.pathname.startsWith('/jellyfin/Items/')) {
      if (state.permissionDelay)
        await new Promise((resolve) => setTimeout(resolve, state.permissionDelay));
      if (state.hideLibraries) {
        json({}, 404);
        return;
      }
      response.once('close', () => {
        if (!response.writableEnded) state.itemAborts++;
      });
      await state.itemWait;
      if (response.destroyed) return;
      if (catalogUrl.searchParams.get('userId') !== currentUserId) {
        json({}, 403);
        return;
      }
      const item = state.catalog.find((v) => v.Id === catalogUrl.pathname.split('/').at(-1));
      json(item ?? {}, item ? 200 : 404);
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
    addAccount(name: string, id: string) {
      const personal: typeof state = {
        ...rootState,
        token: randomBytes(32).toString('hex'),
        valid: false,
        revoked: 0,
        requests: [],
        catalog: [],
        playback: playbackFixtureState(),
        artwork: { ...rootState.artwork },
      };
      accounts.set(name, { id, state: personal });
      return personal as typeof state;
    },
    baseUrl: `http://127.0.0.1:${address.port}/jellyfin`,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
