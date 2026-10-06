// Verification-only protocol fixture, never a real Jellyfin integration claim.
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
const password = process.env.OPENFLIX_VERIFY_JELLYFIN_PASSWORD;
const seed = process.env.OPENFLIX_VERIFY_JELLYFIN_TOKEN;
if (!password || !seed) throw new Error('Disposable fixture credentials are required');
const restored = existsSync('/state/sessions.json')
  ? JSON.parse(readFileSync('/state/sessions.json', 'utf8'))
  : { authentications: 0, revocations: 0, sessions: [] };
const sessions = new Set(restored.sessions);
let authentications = restored.authentications,
  revocations = restored.revocations;
const digest = (token) =>
  createHash('sha256')
    .update(token ?? '')
    .digest('hex');
const persist = () =>
  writeFileSync(
    '/state/sessions.json',
    JSON.stringify({ authentications, revocations, sessions: [...sessions] }),
    { mode: 0o600 },
  );
let catalogMode = 'normal';
const itemId = (n) => n.toString(16).padStart(32, '0');
const server = createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 8192) {
      res.writeHead(413);
      res.end();
      return;
    }
  }
  const send = (data, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };
  if (req.url?.startsWith('/__fixture/catalog?')) {
    catalogMode = new URL(req.url, 'http://fixture').searchParams.get('mode');
    send({ ok: true });
    return;
  }
  if (req.url === '/__fixture/state') {
    send({ authentications, revocations, active: sessions.size });
    return;
  }
  if (req.url === '/jellyfin/System/Info/Public') {
    send({
      Id: '11111111111111111111111111111111',
      ServerName: 'Disposable Jellyfin fixture',
      Version: '10.11.11',
    });
    return;
  }
  if (req.url === '/jellyfin/Users/AuthenticateByName' && req.method === 'POST') {
    let input;
    try {
      input = JSON.parse(body);
    } catch {
      send({}, 400);
      return;
    }
    if (input.Username !== 'fixture-user' || input.Pw !== password) {
      send({}, 401);
      return;
    }
    const token = seed + (++authentications).toString(16).padStart(8, '0');
    sessions.add(digest(token));
    persist();
    send({
      AccessToken: token,
      ServerId: '11111111111111111111111111111111',
      User: { Id: '22222222222222222222222222222222' },
    });
    return;
  }
  const token = /Token="([A-Za-z0-9]+)"/.exec(req.headers.authorization ?? '')?.[1];
  if (!sessions.has(digest(token))) {
    send({}, 401);
    return;
  }
  if (req.url === '/jellyfin/Users/Me') {
    send({ Id: '22222222222222222222222222222222' });
    return;
  }
  if (req.url.startsWith('/jellyfin/UserViews?')) {
    const url = new URL(req.url, 'http://fixture');
    if (
      url.searchParams.get('userId') !== '22222222222222222222222222222222' ||
      url.searchParams.get('includeHidden') !== 'false' ||
      url.searchParams.get('includeExternalContent') !== 'false'
    ) {
      send({}, 400);
      return;
    }
    send({
      Items: [
        {
          Id: '33333333333333333333333333333333',
          Name: 'Fixture movies',
          CollectionType: 'movies',
        },
        { Id: '44444444444444444444444444444444', Name: 'Tv shows', CollectionType: null },
      ],
    });
    return;
  }
  const url = new URL(req.url, 'http://fixture');
  if (url.pathname === '/jellyfin/Items') {
    const q = url.searchParams,
      offset = Number(q.get('startIndex')),
      limit = Number(q.get('limit'));
    if (
      q.get('userId') !== '22222222222222222222222222222222' ||
      q.get('recursive') !== 'true' ||
      q.get('enableImages') !== 'false' ||
      q.get('enableUserData') !== 'false'
    ) {
      send({}, 400);
      return;
    }
    const tv = q.get('parentId') === '44444444444444444444444444444444';
    if (!tv && catalogMode === 'partial' && offset >= 100) {
      send({ error: 'fixture scan interrupted' }, 500);
      return;
    }
    const items = tv
      ? [
          { Id: itemId(1001), Name: 'Fixture series', Type: 'Series' },
          {
            Id: itemId(1002),
            Name: 'Fixture season',
            Type: 'Season',
            ParentId: itemId(1001),
            SeriesId: itemId(1001),
            IndexNumber: 1,
          },
          {
            Id: itemId(1003),
            Name: 'Fixture episode',
            Type: 'Episode',
            ParentId: itemId(1002),
            SeriesId: itemId(1001),
            SeasonId: itemId(1002),
            IndexNumber: 1,
            ParentIndexNumber: 1,
          },
        ]
      : Array.from({ length: catalogMode === 'updated' ? 204 : 205 }, (_, i) => ({
          Id: itemId(i + 1),
          Name:
            i === 0 && catalogMode !== 'normal'
              ? 'Changed fixture movie'
              : `Fixture movie ${String(i + 1).padStart(3, '0')}`,
          Type: 'Movie',
          ProductionYear: 2026,
        }));
    send({
      Items: items.slice(offset, offset + limit),
      StartIndex: offset,
      TotalRecordCount: items.length,
    });
    return;
  }
  if (req.url === '/jellyfin/Sessions/Logout' && req.method === 'POST') {
    sessions.delete(digest(token));
    revocations++;
    persist();
    res.writeHead(204);
    res.end();
    return;
  }
  send({}, 404);
});
server.listen(8096, '0.0.0.0');
process.once('SIGTERM', () => {
  server.closeAllConnections();
  server.close();
});
