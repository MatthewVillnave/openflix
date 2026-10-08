// Verification-only protocol fixture, never a real Jellyfin integration claim.
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, createReadStream, statSync } from 'node:fs';
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
let catalogMode = 'normal',
  playbackMode = 'normal';
const playbackStats = { bytes: 0, cancelled: 0, reports: 0, ranges: 0 };
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
  if (req.url?.startsWith('/__fixture/playback?')) {
    playbackMode = new URL(req.url, 'http://fixture').searchParams.get('mode');
    send({ ok: true });
    return;
  }
  if (req.url === '/__fixture/state') {
    send({ authentications, revocations, active: sessions.size, playback: playbackStats });
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
        { Id: '66666666666666666666666666666666', Name: 'Fixture music', CollectionType: 'music' },
      ],
    });
    return;
  }
  const url = new URL(req.url, 'http://fixture');
  const playbackMatch = /^\/jellyfin\/Items\/([a-f0-9]{32})\/PlaybackInfo$/.exec(url.pathname);
  if (playbackMatch && req.method === 'POST') {
    const id = playbackMatch[1],
      audio = id === itemId(2001),
      episode = id === itemId(1003);
    const input = JSON.parse(body);
    if (input.EnableTranscoding !== false || input.AutoOpenLiveStream !== false) {
      send({}, 400);
      return;
    }
    send({
      PlaySessionId: '77777777777777777777777777777777',
      MediaSources: [
        {
          Id: id,
          Protocol: 'File',
          IsRemote: false,
          SupportsDirectPlay: true,
          RunTimeTicks: 120000000,
          Container: audio ? 'wav' : episode ? 'webm' : 'mp4',
          VideoType: audio ? undefined : 'VideoFile',
          Path: '/private/fixture-only-path',
          MediaStreams: audio
            ? [{ Index: 1, Type: 'Audio', Codec: 'pcm_s16le', Channels: 1 }]
            : [
                {
                  Index: 0,
                  Type: 'Video',
                  Codec: episode ? 'vp8' : 'h264',
                  Profile: episode ? undefined : 'Baseline',
                  Level: 30,
                  Width: 320,
                  Height: 180,
                  BitDepth: 8,
                  AverageFrameRate: 15,
                },
                {
                  Index: 1,
                  Type: 'Audio',
                  Codec: episode ? 'opus' : 'aac',
                  Profile: episode ? undefined : 'LC',
                  Channels: 2,
                },
              ],
        },
      ],
    });
    return;
  }
  if (
    /^\/jellyfin\/Sessions\/Playing(?:\/(?:Progress|Stopped))?$/.test(url.pathname) &&
    req.method === 'POST'
  ) {
    const report = JSON.parse(body);
    if (!Number.isSafeInteger(report.PositionTicks) || report.PositionTicks < 0) {
      send({}, 400);
      return;
    }
    playbackStats.reports++;
    res.writeHead(204);
    res.end();
    return;
  }
  const streamMatch = /^\/jellyfin\/(Videos|Audio)\/([a-f0-9]{32})\/stream$/.exec(url.pathname);
  if (streamMatch && ['GET', 'HEAD'].includes(req.method)) {
    const id = streamMatch[2],
      audio = id === itemId(2001),
      episode = id === itemId(1003);
    if (url.searchParams.get('static') !== 'true' || url.searchParams.get('mediaSourceId') !== id) {
      send({}, 400);
      return;
    }
    const file = audio ? '/media/track.wav' : episode ? '/media/episode.webm' : '/media/movie.mp4';
    const size = playbackMode === 'large' ? 4 * 1024 ** 3 : statSync(file).size;
    let start = 0,
      end = size - 1;
    if (req.headers.range) {
      playbackStats.ranges++;
      const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if (!match) {
        res.writeHead(416, { 'Content-Range': `bytes */${size}` });
        res.end();
        return;
      }
      if (match[1]) {
        start = Number(match[1]);
        if (match[2]) end = Math.min(end, Number(match[2]));
      } else start = Math.max(0, size - Number(match[2]));
      if (start >= size || end < start) {
        res.writeHead(416, { 'Content-Range': `bytes */${size}` });
        res.end();
        return;
      }
    }
    const headers = {
      'Content-Type': audio ? 'audio/wav' : episode ? 'video/webm' : 'video/mp4',
      'Content-Length': end - start + 1,
      'Accept-Ranges': 'bytes',
    };
    if (req.headers.range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    res.writeHead(req.headers.range ? 206 : 200, headers);
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    const chunk = Buffer.alloc(65536);
    const source =
      playbackMode === 'large'
        ? Readable.from(
            (function* () {
              let remaining = end - start + 1;
              while (remaining) {
                const n = Math.min(chunk.length, remaining);
                remaining -= n;
                playbackStats.bytes += n;
                yield chunk.subarray(0, n);
              }
            })(),
            { objectMode: false, highWaterMark: 65536 },
          )
        : createReadStream(file, { start, end });
    res.on('close', () => {
      if (!res.writableFinished) playbackStats.cancelled++;
      source.destroy();
    });
    source.pipe(res);
    return;
  }
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
    const music = q.get('parentId') === '66666666666666666666666666666666';
    const tv = q.get('parentId') === '44444444444444444444444444444444';
    if (!tv && catalogMode === 'partial' && offset >= 100) {
      send({ error: 'fixture scan interrupted' }, 500);
      return;
    }
    const items = music
      ? [{ Id: itemId(2001), Name: 'Fixture track', Type: 'Audio' }]
      : tv
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
    // Real 10.11.11 scans include structural Folder records in both media families.
    if (!music)
      items.push({ Id: itemId(tv ? 1099 : 999), Name: 'Structural folder', Type: 'Folder' });
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
