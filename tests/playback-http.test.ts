import { randomBytes } from 'node:crypto';
import { Writable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { buildApp } from '../apps/server/src/app.js';
import { tokenDigest } from '../apps/server/src/auth.js';
import { createLogger } from '../apps/server/src/logger.js';
import { EncryptedCredentialStore } from '../apps/server/src/connector-credentials.js';
import { openDatabase, catalogId } from '../packages/database/dist/index.js';
import { authenticateJellyfin } from '../packages/connector-jellyfin/dist/index.js';
import type { PlaybackView, MediaType } from '../packages/shared/dist/index.js';
import { temporaryConfig } from './helpers.js';
import { jellyfinFixture, libraryId, upstreamPassword } from './jellyfin-fixture.js';
import { playbackItemId, playbackSource, sourceId, playSessionId } from './playback-fixture.js';
const origin = 'https://openflix.example';
let local: ReturnType<typeof temporaryConfig>,
  upstream: Awaited<ReturnType<typeof jellyfinFixture>>;
let app: Awaited<ReturnType<typeof buildApp>>, db: ReturnType<typeof openDatabase>;
let admin: string, other: string, viewer: string, logs: string;
const itemId = catalogId('item', 'source', playbackItemId);
const profile = { formats: ['mp4-h264-aac', 'webm-vp8-opus', 'mp3', 'wav'] };
const seed = (type: MediaType = 'movie') => {
  const run = db.catalog.begin('source', null);
  db.catalog.stageLibrary(run, { id: libraryId, name: 'Fixture', mediaTypes: [], type: 'unknown' });
  db.catalog.stagePage(run, libraryId, [
    { id: playbackItemId, libraryId, type, title: 'Fixture item', providerIds: {} },
  ]);
  db.catalog.publish(run);
};
beforeEach(async () => {
  local = temporaryConfig({
    OPENFLIX_MASTER_KEY: randomBytes(32).toString('base64'),
    OPENFLIX_BASE_URL: origin,
    OPENFLIX_LOG_LEVEL: 'info',
  });
  upstream = await jellyfinFixture();
  const auth = await authenticateJellyfin({
    baseUrl: upstream.baseUrl,
    deviceId: 'source',
    username: 'fixture-user',
    password: upstreamPassword,
  });
  db = openDatabase(local.config.databasePath);
  const vault = new EncryptedCredentialStore(db, local.config.masterKey!);
  vault.create(
    {
      id: 'source',
      name: 'Fixture',
      type: 'jellyfin',
      baseUrl: upstream.baseUrl,
      server: auth.server,
      libraries: auth.libraries,
      state: 'connected',
      lastCheckedAt: null,
      lastError: null,
      createdAt: Date.now(),
    },
    auth.secret,
  );
  vault.destroy();
  auth.secret.fill(0);
  const cookie = (id: string, role: 'admin' | 'user') => {
    db.createUser(
      { id, username: id, displayName: id, role, passwordHash: 'fixture-no-login' },
      Date.now(),
    );
    const token = randomBytes(32).toString('base64url');
    db.createSession(tokenDigest(token), id, Date.now(), Date.now() + 86400000);
    return `${local.config.cookieName}=${token}`;
  };
  admin = cookie('admin', 'admin');
  other = cookie('other-admin', 'admin');
  viewer = cookie('viewer', 'user');
  seed();
  logs = '';
  app = await buildApp(
    local.config,
    createLogger(
      local.config,
      new Writable({
        write(chunk, _enc, cb) {
          logs += String(chunk);
          cb();
        },
      }),
    ),
  );
});
afterEach(async () => {
  vi.restoreAllMocks();
  await app.close();
  db.close();
  await upstream.close();
  local.cleanup();
});
const post = (path: string, payload: Record<string, unknown>, cookie = admin, withOrigin = true) =>
  app.inject({
    method: 'POST',
    url: '/api/v1/playback' + path,
    headers: { cookie, ...(withOrigin ? { origin } : {}) },
    payload,
  });
const start = (cookie = admin, id = itemId) => post('/sessions', { itemId: id, profile }, cookie);
async function prepared() {
  const r = await start();
  expect(r.statusCode).toBe(201);
  return r.json<PlaybackView>();
}
it.each(['movie', 'episode', 'audio'] as const)(
  'authorizes a normalized playable %s without exposing secrets or source URLs',
  async (type) => {
    seed(type);
    if (type === 'audio') {
      upstream.state.playback.sources = [playbackSource('audio')];
      upstream.state.playback.mime = 'audio/wav';
    }
    const result = await start();
    expect(result.statusCode).toBe(201);
    expect(result.json()).toMatchObject({
      itemId,
      mode: 'direct',
      kind: type === 'audio' ? 'audio' : 'video',
    });
    expect(Object.keys(result.json()).sort()).toEqual(
      [
        'id',
        'itemId',
        'kind',
        'mode',
        'contentType',
        'durationMs',
        'expiresAt',
        'streamPath',
      ].sort(),
    );
    for (const secret of [
      upstream.state.token,
      upstreamPassword,
      local.config.masterKey!,
      upstream.baseUrl,
      '/private/',
      'credentialEnvelope',
    ])
      expect(result.body + logs).not.toContain(secret);
    expect(upstream.state.playback.reports).toHaveLength(0); // planning is not fabricated playback
  },
);
it.each(['series', 'season', 'album', 'artist', 'playlist', 'unknown'] as const)(
  'rejects navigation-only %s',
  async (type) => {
    seed(type);
    expect((await start()).statusCode).toBe(415);
  },
);
it('rejects missing items, removed connectors and unavailable upstream', async () => {
  expect((await start(admin, 'item_' + '0'.repeat(64))).statusCode).toBe(404);
  upstream.state.mode = 'unreachable';
  expect((await start()).statusCode).toBe(502);
  db.removeConnector('source');
  expect((await start()).statusCode).toBe(404);
});
it('denies unauthenticated, ordinary-user and cross-origin initiation', async () => {
  expect((await start('')).statusCode).toBe(401);
  expect((await start(viewer)).statusCode).toBe(403);
  expect((await post('/sessions', { itemId, profile }, admin, false)).statusCode).toBe(403);
});
it('requires the original login on every GET/HEAD/report/stop; IDs never bypass authentication', async () => {
  const s = await prepared();
  for (const method of ['GET', 'HEAD'] as const) {
    expect((await app.inject({ method, url: s.streamPath })).statusCode).toBe(401);
    expect(
      (await app.inject({ method, url: s.streamPath, headers: { cookie: viewer } })).statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ method, url: s.streamPath, headers: { cookie: other } })).statusCode,
    ).toBe(410);
  }
  expect(
    (
      await post(
        `/sessions/${s.id}/progress`,
        { event: 'start', positionMs: 0, paused: false },
        other,
      )
    ).statusCode,
  ).toBe(410);
  expect((await post(`/sessions/${s.id}/stop`, {}, other)).statusCode).toBe(410);
  expect(
    (
      await app.inject({
        url: s.streamPath,
        headers: { cookie: admin, 'sec-fetch-site': 'cross-site' },
      })
    ).statusCode,
  ).toBe(403);
});
it('rejects arbitrary source/URL injection, path traversal and extra query selectors', async () => {
  expect(
    (await post('/sessions', { itemId, profile, connectorId: 'other', url: 'file:///etc/passwd' }))
      .statusCode,
  ).toBe(400);
  expect((await post('/sessions', { itemId: '../escape', profile })).statusCode).toBe(400);
  const s = await prepared();
  expect(
    (
      await app.inject({
        url: s.streamPath + '?sourceId=other&url=http://attacker',
        headers: { cookie: admin },
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await app.inject({
        url: '/api/v1/playback/sessions/not-a-session/stream',
        headers: { cookie: admin },
      })
    ).statusCode,
  ).toBe(400);
});
it('preserves GET, HEAD, 206 and 416 semantics with byte-exact content', async () => {
  const s = await prepared();
  const full = await app.inject({ url: s.streamPath, headers: { cookie: admin } });
  expect(full.statusCode).toBe(200);
  expect(full.rawPayload).toEqual(upstream.state.playback.bytes);
  expect(full.headers['cache-control']).toContain('no-store');
  const head = await app.inject({ method: 'HEAD', url: s.streamPath, headers: { cookie: admin } });
  expect(head.statusCode).toBe(200);
  expect(head.rawPayload.length).toBe(0);
  expect(head.headers['content-length']).toBe('4096');
  const range = await app.inject({
    url: s.streamPath,
    headers: { cookie: admin, range: 'bytes=100-199' },
  });
  expect(range.statusCode).toBe(206);
  expect(range.headers['content-range']).toBe('bytes 100-199/4096');
  expect(range.rawPayload).toEqual(upstream.state.playback.bytes.subarray(100, 200));
  const unsatisfied = await app.inject({
    url: s.streamPath,
    headers: { cookie: admin, range: 'bytes=9999-' },
  });
  expect(unsatisfied.statusCode).toBe(416);
  expect(unsatisfied.headers['content-range']).toBe('bytes */4096');
  expect(unsatisfied.rawPayload.length).toBe(0);
  expect(
    (await app.inject({ url: s.streamPath, headers: { cookie: admin, range: 'bytes=1-2,4-5' } }))
      .statusCode,
  ).toBe(416);
});
it('fails cleanly on incompatible media and rejects unsafe stream content/redirects', async () => {
  upstream.state.playback.sources = [{ ...playbackSource(), Container: 'mkv' }];
  expect((await start()).statusCode).toBe(415);
  upstream.state.playback.sources = [playbackSource()];
  const s = await prepared();
  for (const mode of ['html', 'redirect', 'error'] as const) {
    upstream.state.playback.streamMode = mode;
    const response = await app.inject({ url: s.streamPath, headers: { cookie: admin } });
    expect(response.statusCode).toBe(502);
    expect(response.body + logs).not.toContain('synthetic-private');
  }
});
it('reports real start, pause/seek/progress and stop without issuing another login', async () => {
  const s = await prepared();
  expect(
    (await post(`/sessions/${s.id}/progress`, { event: 'progress', positionMs: 0, paused: true }))
      .statusCode,
  ).toBe(409);
  expect(
    (await post(`/sessions/${s.id}/progress`, { event: 'start', positionMs: 0, paused: false }))
      .statusCode,
  ).toBe(204);
  expect(
    (
      await post(`/sessions/${s.id}/progress`, {
        event: 'progress',
        positionMs: 8000,
        paused: true,
      })
    ).statusCode,
  ).toBe(204);
  expect(
    (
      await post(`/sessions/${s.id}/progress`, {
        event: 'progress',
        positionMs: 12001,
        paused: true,
      })
    ).statusCode,
  ).toBe(400);
  expect((await post(`/sessions/${s.id}/stop`, {})).statusCode).toBe(204);
  await expect.poll(() => upstream.state.playback.reports.length).toBe(3);
  expect(upstream.state.playback.reports[1]!.body).toMatchObject({
    PositionTicks: 80000000,
    IsPaused: true,
  });
  expect(upstream.state.playback.reports[2]!.body.PositionTicks).toBe(80000000);
  expect((await app.inject({ url: s.streamPath, headers: { cookie: admin } })).statusCode).toBe(
    410,
  );
  expect(upstream.state.requests.filter((r) => r.path.endsWith('AuthenticateByName'))).toHaveLength(
    1,
  );
});
it('expires grants without changing clock/timer configuration and removes them on restart', async () => {
  const s = await prepared();
  const now = Date.now();
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 301000);
  expect((await app.inject({ url: s.streamPath, headers: { cookie: admin } })).statusCode).toBe(
    410,
  );
  clock.mockRestore();
  const fresh = await prepared();
  await app.close();
  app = await buildApp(local.config);
  expect((await app.inject({ url: fresh.streamPath, headers: { cookie: admin } })).statusCode).toBe(
    410,
  );
  expect(db.catalog.item(itemId)).toBeDefined();
  expect((await start()).statusCode).toBe(201);
});
it('bounds grant counts and rejects oversized request bodies', async () => {
  await prepared();
  await prepared();
  expect((await start()).statusCode).toBe(429);
  expect((await post('/sessions', { itemId, profile, junk: 'x'.repeat(9000) })).statusCode).toBe(
    413,
  );
});
it('aborts in-flight bytes after logout and rejects subsequent requests', async () => {
  upstream.state.playback.streamMode = 'slow';
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error();
  const s = await prepared();
  const stop = new AbortController();
  const response = await fetch(`http://127.0.0.1:${address.port}${s.streamPath}`, {
    headers: { cookie: admin },
    signal: stop.signal,
  });
  expect(response.status).toBe(200);
  const reader = response.body!.getReader();
  await reader.read();
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        headers: { cookie: admin, origin },
      })
    ).statusCode,
  ).toBe(204);
  await expect.poll(() => upstream.state.playback.cancelled, { timeout: 3000 }).toBe(1);
  stop.abort();
  await reader.cancel().catch(() => {});
  expect((await app.inject({ url: s.streamPath, headers: { cookie: admin } })).statusCode).toBe(
    401,
  );
});
it('cancels on browser disconnect and source removal, and releases the stream slot', async () => {
  upstream.state.playback.streamMode = 'slow';
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error();
  const s = await prepared();
  const response = await fetch(`http://127.0.0.1:${address.port}${s.streamPath}`, {
    headers: { cookie: admin },
  });
  const reader = response.body!.getReader();
  await reader.read();
  await reader.cancel();
  await expect.poll(() => upstream.state.playback.cancelled).toBe(1);
  db.removeConnector('source');
  await delay(10);
  expect((await app.inject({ url: s.streamPath, headers: { cookie: admin } })).statusCode).toBe(
    410,
  );
});
it('bounds concurrent stream sockets and releases capacity after cancellation', async () => {
  upstream.state.playback.streamMode = 'slow';
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error();
  const s = await prepared();
  const url = `http://127.0.0.1:${address.port}${s.streamPath}`;
  const first = await fetch(url, { headers: { cookie: admin } });
  const second = await fetch(url, { headers: { cookie: admin } });
  expect((await app.inject({ url: s.streamPath, headers: { cookie: admin } })).statusCode).toBe(
    429,
  );
  await first.body!.cancel();
  await second.body!.cancel();
  await expect.poll(() => upstream.state.playback.cancelled).toBe(2);
  upstream.state.playback.streamMode = 'normal';
  expect((await app.inject({ url: s.streamPath, headers: { cookie: admin } })).statusCode).toBe(
    200,
  );
});
it('concurrent planning cannot exceed per-user session capacity', async () => {
  const results = await Promise.all([start(), start(), start(), start()]);
  expect(results.filter((r) => r.statusCode === 201)).toHaveLength(2);
  expect(results.filter((r) => r.statusCode === 429)).toHaveLength(2);
});
it('normalizes reporting failure and permits cleanup without persisting playback state', async () => {
  const s = await prepared();
  upstream.state.playback.reportFailure = true;
  expect(
    (await post(`/sessions/${s.id}/progress`, { event: 'start', positionMs: 1200, paused: false }))
      .statusCode,
  ).toBe(502);
  expect((await post(`/sessions/${s.id}/stop`, {})).statusCode).toBe(204);
  for (const secret of [upstream.state.token, upstreamPassword, local.config.masterKey!])
    expect(logs).not.toContain(secret);
});

async function preparedHls() {
  upstream.state.playback.hls = true;
  upstream.state.playback.sources = [
    {
      ...playbackSource(),
      Container: 'mkv',
      SupportsDirectPlay: false,
      SupportsTranscoding: true,
      TranscodingUrl: `/videos/${playbackItemId}/master.m3u8?DeviceId=source&MediaSourceId=${sourceId}&PlaySessionId=${playSessionId}&VideoCodec=h264&AudioCodec=aac&SegmentContainer=ts&ApiKey=${upstream.state.token}`,
    },
  ];
  const r = await post('/sessions', {
    itemId,
    profile: { formats: ['mp4-h264-aac', 'hls-h264-aac'] },
  });
  expect(r.statusCode).toBe(201);
  return r.json<PlaybackView>();
}
it('authorizes every HLS manifest/segment with role and original login binding', async () => {
  const g = await preparedHls();
  const root = await app.inject({ url: g.streamPath, headers: { cookie: admin } });
  expect(root.statusCode).toBe(200);
  const child = root.body.split('\n').find((s) => s.startsWith('/api/'))!;
  const media = await app.inject({ url: child, headers: { cookie: admin } });
  expect(media.statusCode).toBe(200);
  const segment = media.body.split('\n').find((s) => s.startsWith('/api/'))!;
  for (const url of [g.streamPath, child, segment]) {
    expect((await app.inject({ url })).statusCode).toBe(401);
    expect((await app.inject({ url, headers: { cookie: viewer } })).statusCode).toBe(403);
    expect((await app.inject({ url, headers: { cookie: other } })).statusCode).toBe(410);
  }
  expect((await app.inject({ url: segment, headers: { cookie: admin } })).statusCode).toBe(200);
  expect(root.body + media.body + logs).not.toContain(upstream.state.token);
});
it('revokes HLS segments on logout and connector removal', async () => {
  const g = await preparedHls();
  await app.inject({ url: g.streamPath, headers: { cookie: admin } });
  db.revokeSession(tokenDigest(admin.split('=')[1]!));
  expect((await app.inject({ url: g.streamPath, headers: { cookie: admin } })).statusCode).toBe(
    401,
  );
  db.removeConnector('source');
  expect((await app.inject({ url: g.streamPath, headers: { cookie: other } })).statusCode).toBe(
    410,
  );
});
it('rejects forged HLS resource identifiers, query injection and source switching', async () => {
  const g = await preparedHls();
  expect(
    (
      await app.inject({
        url: `/api/v1/playback/sessions/${g.id}/resources/${'0'.repeat(32)}`,
        headers: { cookie: admin },
      })
    ).statusCode,
  ).toBe(404);
  expect(
    (
      await app.inject({
        url: g.streamPath + '?url=https://evil.invalid',
        headers: { cookie: admin },
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await app.inject({
        url: `/api/v1/playback/sessions/${g.id}/resources/%2e%2e`,
        headers: { cookie: admin },
      })
    ).statusCode,
  ).toBe(404);
});
it('stop cancels HLS and scopes cleanup without waiting for a start report', async () => {
  const g = await preparedHls();
  expect((await post(`/sessions/${g.id}/stop`, {})).statusCode).toBe(204);
  await delay(30);
  expect(upstream.state.playback.cleanup).toHaveLength(1);
  expect((await app.inject({ url: g.streamPath, headers: { cookie: admin } })).statusCode).toBe(
    410,
  );
});

it('HLS expiry and restart invalidate grants while persisted credentials remain usable', async () => {
  const g = await preparedHls();
  const now = Date.now();
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 301000);
  expect((await app.inject({ url: g.streamPath, headers: { cookie: admin } })).statusCode).toBe(
    410,
  );
  clock.mockRestore();
  await app.close();
  app = await buildApp(local.config);
  expect((await app.inject({ url: g.streamPath, headers: { cookie: admin } })).statusCode).toBe(
    410,
  );
  expect((await preparedHls()).mode).toBe('remux');
});

it('keeps HLS upstream and parser diagnostics internal and secret-safe', async () => {
  const grant = await preparedHls();
  upstream.state.playback.streamMode = 'error';
  const upstreamError = await app.inject({ url: grant.streamPath, headers: { cookie: admin } });
  expect(upstreamError.statusCode).toBe(502);
  expect(logs).toContain('"upstreamStatus":500');
  expect(logs).toContain('"reason":"unexpected_status"');
  expect(upstreamError.body).not.toContain('diagnostic');
  upstream.state.playback.streamMode = 'normal';
  upstream.state.playback.manifest =
    '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="synthetic-private-token"\n#EXTINF:6,\nhls1/main/0.ts\n';
  const parserError = await app.inject({ url: grant.streamPath, headers: { cookie: admin } });
  expect(parserError.statusCode).toBe(502);
  expect(logs).toContain('"upstreamStatus":200');
  expect(logs).toContain('"stage":"manifest_parse"');
  expect(parserError.body).not.toContain('diagnostic');
  for (const secret of [
    upstream.state.token,
    upstreamPassword,
    'synthetic-private-token',
    'must-not-escape',
    upstream.baseUrl,
  ])
    expect(logs + parserError.body + upstreamError.body).not.toContain(secret);
});
it.each([null, undefined])(
  'classifies unavailable duration without sending invented playback reports (%s)',
  async (runtime) => {
    upstream.state.playback.sources = [{ ...playbackSource(), RunTimeTicks: runtime }];
    const response = await start();
    expect(response.statusCode).toBe(415);
    expect(logs).toContain('"reason":"insufficient_runtime"');
    expect(response.body).not.toContain('insufficient_runtime');
    expect(upstream.state.playback.reports).toEqual([]);
  },
);
