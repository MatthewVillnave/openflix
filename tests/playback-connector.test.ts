import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  authenticateJellyfin,
  createJellyfinConnector,
} from '../packages/connector-jellyfin/dist/index.js';
import { jellyfinFixture, upstreamPassword } from './jellyfin-fixture.js';
import { playbackSource, playbackItemId, sourceId } from './playback-fixture.js';
let fixture: Awaited<ReturnType<typeof jellyfinFixture>>;
let connector: ReturnType<typeof createJellyfinConnector>;
beforeEach(async () => {
  fixture = await jellyfinFixture();
  const auth = await authenticateJellyfin({
    baseUrl: fixture.baseUrl,
    deviceId: 'playback-fixture',
    username: 'fixture-user',
    password: upstreamPassword,
  });
  connector = createJellyfinConnector(
    { baseUrl: fixture.baseUrl, credential: { id: 'fixture' } },
    {
      read: async () => Uint8Array.from(auth.secret),
      store: async () => ({ id: 'fixture' }),
      delete: async () => {},
    },
  );
});
afterEach(async () => fixture.close());
const plan = () =>
  connector.getPlaybackInfo(playbackItemId, {
    formats: ['mp4-h264-aac', 'webm-vp8-opus', 'mp3', 'wav'],
  });
it.each(['video', 'audio'] as const)(
  'plans normalized %s without credentials, DTOs or upstream URLs',
  async (kind) => {
    fixture.state.playback.sources = [playbackSource(kind)];
    const result = await plan();
    expect(result).toMatchObject({
      itemId: playbackItemId,
      sourceId,
      mode: 'direct',
      kind,
      durationMs: 12000,
    });
    for (const secret of [fixture.state.token, '/private/', 'https://', 'api_key', 'MediaSources'])
      expect(JSON.stringify(result)).not.toContain(secret);
    const request = fixture.state.requests.find((r) => r.path.endsWith('/PlaybackInfo'))!;
    expect(JSON.parse(request.body)).toMatchObject({
      EnableDirectPlay: true,
      EnableTranscoding: false,
      EnableDirectStream: false,
      AutoOpenLiveStream: false,
    });
  },
);
it.each([
  { Protocol: 'Http' },
  { IsRemote: true },
  { IsInfiniteStream: true },
  { RequiresOpening: true },
  { RequiresClosing: true },
  { VideoType: 'Dvd' },
  { Container: 'mkv' },
  { SupportsDirectPlay: false },
  { MediaStreams: [{ Type: 'Video', Index: 0, Codec: 'hevc' }] },
  { MediaStreams: [{ Type: 'Audio', Index: 0, Codec: 'aac', Channels: 6 }] },
])('rejects incompatible or unsafe source %j', async (change) => {
  fixture.state.playback.sources = [{ ...playbackSource(), ...change }];
  await expect(plan()).rejects.toMatchObject({ code: 'unsupported' });
});
it('requires a browser capability match and rejects untrusted capabilities', async () => {
  await expect(
    connector.getPlaybackInfo(playbackItemId, { formats: ['wav'] }),
  ).rejects.toMatchObject({ code: 'unsupported' });
  await expect(
    connector.getPlaybackInfo(playbackItemId, { formats: ['https://attacker'] as never }),
  ).rejects.toMatchObject({ code: 'invalid_configuration' });
});
it('rejects invalid source IDs and permission failures without raw upstream errors', async () => {
  fixture.state.playback.sources = [{ ...playbackSource(), Id: '../escape' }];
  await expect(plan()).rejects.toMatchObject({ code: 'invalid_response' });
  fixture.state.playback.forbidden = true;
  await expect(plan()).rejects.toMatchObject({ code: 'unauthorized' });
});
it('normalizes unavailable upstream errors', async () => {
  fixture.state.mode = 'unreachable';
  await expect(plan()).rejects.toMatchObject({ code: 'unavailable' });
});
it.each([undefined, 'bytes=10-19', 'bytes=4000-', 'bytes=-7'])(
  'streams actual bytes with correct range %s',
  async (range) => {
    const result = await connector.openPlaybackStream(await plan(), {
      method: 'GET',
      ...(range ? { range } : {}),
      signal: new AbortController().signal,
    });
    const chunks = [];
    for await (const chunk of result.body!) chunks.push(chunk);
    const bytes = Buffer.concat(chunks);
    expect(result.status).toBe(range ? 206 : 200);
    expect(bytes).toEqual(
      range === 'bytes=10-19'
        ? fixture.state.playback.bytes.subarray(10, 20)
        : range === 'bytes=4000-'
          ? fixture.state.playback.bytes.subarray(4000)
          : range === 'bytes=-7'
            ? fixture.state.playback.bytes.subarray(-7)
            : fixture.state.playback.bytes,
    );
    expect(Number(result.headers['content-length'])).toBe(bytes.length);
    expect(fixture.state.playback.streamRequests[0]!.source).toBe(sourceId);
  },
);
it('supports HEAD and forwards 416 range metadata without upstream error body', async () => {
  const p = await plan();
  const head = await connector.openPlaybackStream(p, {
    method: 'HEAD',
    signal: new AbortController().signal,
  });
  expect(head.body).toBeUndefined();
  expect(head.headers['content-length']).toBe('4096');
  const result = await connector.openPlaybackStream(p, {
    method: 'GET',
    range: 'bytes=9000-',
    signal: new AbortController().signal,
  });
  expect(result.status).toBe(416);
  expect(result.headers['content-range']).toBe('bytes */4096');
  expect(result.body).toBeUndefined();
});
it.each(['redirect', 'html', 'bad-range', 'wrong-range', 'error'] as const)(
  'rejects unsafe binary response %s',
  async (mode) => {
    fixture.state.playback.streamMode = mode;
    await expect(
      connector.openPlaybackStream(await plan(), {
        method: 'GET',
        range: 'bytes=0-9',
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({
      code:
        mode === 'redirect'
          ? 'unsafe_redirect'
          : mode === 'error'
            ? 'unavailable'
            : 'invalid_response',
    });
    expect(fixture.state.requests.some((r) => r.path.includes('credential-trap'))).toBe(false);
  },
);
it('preserves 200 when upstream ignores Range rather than inventing a partial response', async () => {
  fixture.state.playback.streamMode = 'ignore-range';
  const result = await connector.openPlaybackStream(await plan(), {
    method: 'GET',
    range: 'bytes=0-9',
    signal: new AbortController().signal,
  });
  expect(result.status).toBe(200);
  expect(result.headers['content-range']).toBeUndefined();
  result.cancel();
});
it('cancels the upstream socket on client abort without reading the whole stream', async () => {
  fixture.state.playback.streamMode = 'slow';
  const stop = new AbortController();
  const result = await connector.openPlaybackStream(await plan(), {
    method: 'GET',
    signal: stop.signal,
  });
  const first = await result.body![Symbol.asyncIterator]().next();
  expect(first.value.length).toBeLessThanOrEqual(8192);
  stop.abort();
  result.cancel();
  await expect.poll(() => fixture.state.playback.cancelled).toBe(1);
});
it('reports only supplied playback positions and distinguishes start/progress/stop', async () => {
  const p = await plan();
  const s = {
    id: p.sessionId,
    itemId: p.itemId,
    sourceId: p.sourceId,
    durationMs: p.durationMs,
    positionMs: 1234,
    paused: false,
  };
  await connector.reportPlaybackStart(s);
  await connector.reportPlaybackProgress({ ...s, positionMs: 9000, paused: true });
  await connector.reportPlaybackStop({ ...s, positionMs: 9000 });
  expect(
    fixture.state.playback.reports.map((r) => [r.path.split('/').at(-1), r.body.PositionTicks]),
  ).toEqual([
    ['Playing', 12340000],
    ['Progress', 90000000],
    ['Stopped', 90000000],
  ]);
  await expect(connector.reportPlaybackProgress({ ...s, positionMs: -1 })).rejects.toMatchObject({
    code: 'invalid_configuration',
  });
});
it('returns unsupported for a valid empty media-source response', async () => {
  fixture.state.playback.sources = [];
  await expect(plan()).rejects.toMatchObject({ code: 'unsupported' });
});

it.each([{ Channels: -1 }, { Width: -1 }, { Height: 0 }, { AverageFrameRate: 0 }])(
  'rejects malformed media dimensions/channels %j',
  async (change) => {
    const source = playbackSource();
    const streams = source.MediaStreams as Record<string, unknown>[];
    const index = 'Channels' in change ? 1 : 0;
    streams[index] = { ...streams[index], ...change };
    fixture.state.playback.sources = [source];
    await expect(plan()).rejects.toMatchObject({ code: 'invalid_response' });
  },
);
