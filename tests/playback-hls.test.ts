import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  authenticateJellyfin,
  createJellyfinConnector,
} from '../packages/connector-jellyfin/dist/index.js';
import { jellyfinFixture, upstreamPassword } from './jellyfin-fixture.js';
import { playbackSource, playbackItemId, sourceId, playSessionId } from './playback-fixture.js';
import type { PlaybackInfo, PlaybackStream } from '../packages/connector-core/dist/index.js';
let fixture: Awaited<ReturnType<typeof jellyfinFixture>>;
let connector: ReturnType<typeof createJellyfinConnector>;
const resourceBase = '/api/v1/playback/sessions/11111111-1111-4111-8111-111111111111/resources/';
const request = () => ({
  method: 'GET' as const,
  signal: new AbortController().signal,
  resourceBase,
});
const body = async (s: PlaybackStream) => {
  const chunks = [];
  for await (const chunk of s.body!) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString();
};
const plan = () =>
  connector.getPlaybackInfo(playbackItemId, { formats: ['mp4-h264-aac', 'hls-h264-aac'] });
beforeEach(async () => {
  fixture = await jellyfinFixture();
  const auth = await authenticateJellyfin({
    baseUrl: fixture.baseUrl,
    deviceId: 'hls-test',
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
  fixture.state.playback.hls = true;
  fixture.state.playback.sources = [
    {
      ...playbackSource(),
      Container: 'mkv',
      SupportsDirectPlay: false,
      SupportsTranscoding: true,
      TranscodingUrl: `/videos/${playbackItemId}/master.m3u8?DeviceId=fixture&MediaSourceId=${sourceId}&PlaySessionId=${playSessionId}&VideoCodec=h264&AudioCodec=aac&SegmentContainer=ts&h264-audiochannels=2&aac-profile=lc&aac-audiochannels=2&ApiKey=${fixture.state.token}`,
    },
  ];
});
afterEach(async () => fixture.close());
it('plans remux from actual H264/AAC metadata, not MKV extension', async () => {
  const p = await plan();
  expect(p).toMatchObject({ mode: 'remux', videoTranscoded: false });
  expect(JSON.stringify(p)).not.toContain(fixture.state.token);
  expect(JSON.stringify(p)).not.toContain('TranscodingUrl');
});
it.each([
  ['ac3', 'h264', false],
  ['aac', 'hevc', true],
] as const)(
  'plans conversion for %s/%s and reports actual video method',
  async (audio, video, videoTranscoded) => {
    const streams = fixture.state.playback.sources[0]!.MediaStreams as Record<string, unknown>[];
    streams[0]!.Codec = video;
    streams[1]!.Codec = audio;
    const p = await plan();
    expect(p).toMatchObject({ mode: 'transcode', videoTranscoded });
    await connector.reportPlaybackStart({
      id: p.sessionId,
      itemId: p.itemId,
      sourceId: p.sourceId,
      durationMs: p.durationMs,
      positionMs: 0,
      paused: false,
      mode: p.mode,
      videoTranscoded,
    });
    expect(fixture.state.playback.reports[0]!.body.PlayMethod).toBe(
      videoTranscoded ? 'Transcode' : 'DirectStream',
    );
  },
);
it('retains direct MP4 when HLS is available', async () => {
  fixture.state.playback.sources = [playbackSource()];
  expect((await plan()).mode).toBe('direct');
});
it('rewrites master, media and segments to opaque same-origin resources', async () => {
  const p = await plan();
  const master = await body(await connector.openPlaybackStream(p, request()));
  expect(master).not.toContain('api_key');
  expect(master).not.toContain(fixture.baseUrl);
  const child = master.trim().split('\n').at(-1)!;
  expect(child).toMatch(new RegExp('^' + resourceBase + '[a-f0-9]{32}$'));
  const media = await body(
    await connector.openPlaybackResource(p, child.split('/').at(-1)!, request()),
  );
  const segment = media.split('\n').find((line) => line.startsWith(resourceBase))!;
  const bytes = await connector.openPlaybackResource(p, segment.split('/').at(-1)!, request());
  expect(bytes.headers['content-type']).toBe('video/mp2t');
  expect((await body(bytes)).length).toBeGreaterThan(0);
});
it('rewrites URI-bearing initialization attributes rather than passing them through', async () => {
  fixture.state.playback.manifest =
    '#EXTM3U\n#EXT-X-MAP:URI="hls1/main/-1.mp4",BYTERANGE="200@0"\n#EXTINF:6,\nhls1/main/0.ts\n#EXT-X-ENDLIST\n';
  const out = await body(await connector.openPlaybackStream(await plan(), request()));
  expect(out).toMatch(/#EXT-X-MAP:URI="\/api\/v1\/playback\/sessions\/[^" ]+",BYTERANGE="200@0"/);
});
it.each([
  '#EXTM3U\n#EXTINF:6,\nhttps://evil.invalid/videos/x/0.ts\n',
  '#EXTM3U\n#EXTINF:6,\n//evil.invalid/0.ts\n',
  '#EXTM3U\n#EXTINF:6,\nfile:/secret\n',
  '#EXTM3U\n#EXTINF:6,\ndata:text/plain,secret\n',
  '#EXTM3U\n#EXTINF:6,\n../0.ts\n',
  '#EXTM3U\n#EXTINF:6,\n%2e%2e/0.ts\n',
  '#EXTM3U\n#EXTINF:6,\nhls1/main/0.ts?unknown=1\n',
  '#EXTM3U\n#EXTINF:6,\nhls1/main/0.ts?api_key=foreign-token\n',
  '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="secret"\n#EXTINF:6,\nhls1/main/0.ts\n',
  '#EXTM3U\n#EXT-X-MEDIA:TYPE=SUBTITLES,URI="subtitles"\n',
  '#EXTM3U\n#EXT-X-MAP:URI="https://evil.invalid/init.mp4"\n#EXTINF:6,\nhls1/main/0.ts\n',
  '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1,BANDWIDTH=2\nmain.m3u8\n',
  '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nmaster.m3u8\n',
  '#EXTM3U\n#EXTINF:6,\n',
  '#EXTM3U\n' + 'x'.repeat(131073),
])('fails closed for malicious/malformed playlist %#', async (manifest) => {
  fixture.state.playback.manifest = manifest;
  await expect(connector.openPlaybackStream(await plan(), request())).rejects.toMatchObject({
    code: 'invalid_response',
  });
});
it.each(['redirect', 'html', 'error'] as const)('rejects upstream %s', async (mode) => {
  fixture.state.playback.streamMode = mode;
  await expect(connector.openPlaybackStream(await plan(), request())).rejects.toHaveProperty(
    'code',
  );
});
it.each([
  'https://external.invalid/x',
  'file:/secret',
  '/videos/' + playbackItemId + '/master.m3u8?ApiKey=foreign',
  '/videos/' + playbackItemId + '/%2e%2e/master.m3u8',
])('rejects generated unsafe URL %s', async (url) => {
  fixture.state.playback.sources[0]!.TranscodingUrl = url;
  await expect(plan()).rejects.toMatchObject({ code: 'invalid_response' });
});
it('rejects forged resource IDs and plan/source substitution', async () => {
  const p = await plan();
  await expect(connector.openPlaybackResource(p, '0'.repeat(32), request())).rejects.toMatchObject({
    code: 'not_found',
  });
  await expect(
    connector.openPlaybackStream({ ...p, sourceId: 'forged' }, request()),
  ).rejects.toMatchObject({ code: 'not_found' });
});
it('revokes resources and cleans only its own device/session even before reporting start', async () => {
  const p = await plan();
  await connector.closePlayback(p);
  expect(fixture.state.playback.cleanup).toHaveLength(1);
  const query = new URLSearchParams(fixture.state.playback.cleanup[0]);
  expect(query.get('deviceId')).toBe('fixture');
  expect(query.get('playSessionId')).toBe(p.sessionId);
  await expect(connector.openPlaybackStream(p, request())).rejects.toMatchObject({
    code: 'not_found',
  });
});
it('rejects unbounded source dimensions and remote media without opening streams', async () => {
  fixture.state.playback.sources[0]!.IsRemote = true;
  await expect(plan()).rejects.toMatchObject({ code: 'unsupported' });
});

it('supports bounded HEAD manifests and returns a full manifest for native-player ranges', async () => {
  const p = await plan();
  const head = await connector.openPlaybackStream(p, { ...request(), method: 'HEAD' });
  expect(head.status).toBe(200);
  expect(head.body).toBeUndefined();
  const ranged = await connector.openPlaybackStream(p, { ...request(), range: 'bytes=0-5' });
  expect(ranged.status).toBe(200);
  expect(await body(ranged)).toContain('#EXTM3U');
});
it('rejects recursive media playlists instead of expanding without bound', async () => {
  const p = await plan();
  const master = await body(await connector.openPlaybackStream(p, request()));
  fixture.state.playback.mediaManifest = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nmain.m3u8\n';
  await expect(
    connector.openPlaybackResource(p, master.trim().split('/').at(-1)!, request()),
  ).rejects.toMatchObject({ code: 'invalid_response' });
});
it('cancels streamed HLS segment bytes on client abort', async () => {
  const p = await plan();
  const master = await body(await connector.openPlaybackStream(p, request()));
  const media = await body(
    await connector.openPlaybackResource(p, master.trim().split('/').at(-1)!, request()),
  );
  const segment = media
    .split('\n')
    .find((s) => s.startsWith(resourceBase))!
    .split('/')
    .at(-1)!;
  fixture.state.playback.streamMode = 'slow';
  const abort = new AbortController();
  const stream = await connector.openPlaybackResource(p, segment, {
    ...request(),
    signal: abort.signal,
  });
  const iterator = stream.body![Symbol.asyncIterator]();
  await iterator.next();
  abort.abort();
  stream.cancel();
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(fixture.state.playback.cancelled).toBe(1);
});

it('accepts only the same Guid in Jellyfin dashed URL form and rejects another item', async () => {
  const source = fixture.state.playback.sources[0]!;
  source.TranscodingUrl = String(source.TranscodingUrl).replace(
    playbackItemId,
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  );
  const verified = await plan();
  expect(verified.mode).toBe('remux');
  await connector.closePlayback(verified);
  source.TranscodingUrl = String(source.TranscodingUrl).replace(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'dddddddd-dddd-dddd-dddd-dddddddddddd',
  );
  await expect(plan()).rejects.toMatchObject({ code: 'invalid_response' });
});

it('requires known bounded bitrate/sample rate for copy and forces conversion otherwise', async () => {
  const source = fixture.state.playback.sources[0]!;
  const streams = source.MediaStreams as Record<string, unknown>[];
  streams[0]!.BitRate = 9000000;
  streams[1]!.SampleRate = 96000;
  const p = await plan();
  expect(p).toMatchObject({ mode: 'transcode', videoTranscoded: true });
});

it('normalizes only selected-source HEVC options while retaining bounded H264 output', async () => {
  const source = fixture.state.playback.sources[0]!;
  const streams = source.MediaStreams as Record<string, unknown>[];
  streams[0]!.Codec = 'hevc';
  streams[0]!.Level = 60;
  source.TranscodingUrl =
    String(source.TranscodingUrl) +
    '&hevc-level=60&hevc-videobitdepth=8&hevc-profile=main&hevc-audiochannels=2&h264-level=41';
  expect((await plan()).videoTranscoded).toBe(true);
});
it('converts six-channel AC3 to stereo rather than accepting source channel options as output', async () => {
  const source = fixture.state.playback.sources[0]!;
  const streams = source.MediaStreams as Record<string, unknown>[];
  streams[1]!.Codec = 'ac3';
  streams[1]!.Channels = 6;
  source.TranscodingUrl =
    String(source.TranscodingUrl).replace('h264-audiochannels=2', 'h264-audiochannels=6') +
    '&ac3-profile=ac3&ac3-audiochannels=6';
  expect(await plan()).toMatchObject({ mode: 'transcode', videoTranscoded: false });
});

it('does not trust an unsupported synthetic codec merely because transcoding is advertised', async () => {
  const streams = fixture.state.playback.sources[0]!.MediaStreams as Record<string, unknown>[];
  streams[0]!.Codec = 'synthetic-unsupported';
  await expect(plan()).rejects.toMatchObject({ code: 'unsupported' });
});

it('honors lower upstream/user bitrate limits in its copy policy and reporting method', async () => {
  fixture.state.playback.sources[0]!.TranscodingUrl =
    String(fixture.state.playback.sources[0]!.TranscodingUrl) +
    '&VideoBitrate=100000&AudioBitrate=64000';
  expect(await plan()).toMatchObject({ mode: 'transcode', videoTranscoded: true });
});

it.each([
  ['aac', 'h264', 'remux'],
  ['ac3', 'h264', 'transcode'],
  ['aac', 'hevc', 'transcode'],
] as const)('plans %s/%s with zero-dimension subtitles as %s', async (audio, video, mode) => {
  const streams = fixture.state.playback.sources[0]!.MediaStreams as Record<string, unknown>[];
  streams[0]!.Codec = video;
  streams[1]!.Codec = audio;
  streams.push({ Type: 'Subtitle', Index: 2, Codec: 'subrip', Width: 0, Height: 0 });
  expect((await plan()).mode).toBe(mode);
  expect(fixture.state.playback.reports).toHaveLength(0);
});
it.each([undefined, null, 0])(
  'does not open or report HLS when runtime is %s',
  async (RunTimeTicks) => {
    fixture.state.playback.sources[0]!.RunTimeTicks = RunTimeTicks;
    await expect(plan()).rejects.toMatchObject({ code: 'unsupported' });
    expect(fixture.state.requests.filter((r) => r.path.endsWith('/PlaybackInfo'))).toHaveLength(1);
    expect(fixture.state.playback.reports).toHaveLength(0);
    expect(fixture.state.playback.cleanup).toHaveLength(0);
  },
);

it.each([
  ['error', 'unexpected_status', 500, 'application/json'],
  ['html', 'unexpected_content_type', 200, 'text/html'],
  ['redirect', 'unexpected_status', 302, 'missing'],
] as const)(
  'classifies upstream %s without exposing upstream content',
  async (mode, reason, upstreamStatus, upstreamContentType) => {
    fixture.state.playback.streamMode = mode;
    await expect(connector.openPlaybackStream(await plan(), request())).rejects.toMatchObject({
      diagnostic: {
        stage: 'upstream_headers',
        resourceKind: 'master',
        reason,
        upstreamStatus,
        upstreamContentType,
      },
    });
  },
);
it('distinguishes a valid upstream media response from an OpenFlix directive rejection', async () => {
  const p = await plan();
  const master = await body(await connector.openPlaybackStream(p, request()));
  fixture.state.playback.mediaManifest =
    '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="private-token"\n#EXTINF:6,\nhls1/main/0.ts\n';
  await expect(
    connector.openPlaybackResource(p, master.trim().split('/').at(-1)!, request()),
  ).rejects.toMatchObject({
    code: 'invalid_response',
    diagnostic: {
      stage: 'manifest_parse',
      resourceKind: 'media',
      reason: 'unsupported_directive',
      manifestTag: 'EXT-X-KEY',
      upstreamStatus: 200,
      upstreamContentType: 'application/vnd.apple.mpegurl',
    },
  });
});
it('identifies an oversized playlist independently of upstream HTTP status', async () => {
  fixture.state.playback.manifest = '#EXTM3U\n' + 'x'.repeat(4 * 1024 * 1024 + 1);
  await expect(connector.openPlaybackStream(await plan(), request())).rejects.toMatchObject({
    diagnostic: { reason: 'response_limit', resourceKind: 'master', upstreamStatus: 200 },
  });
});

// Mirrors 10.11.11 DynamicHlsPlaylistGenerator: query repeated for every six-second segment.
it.each([120, 240])(
  'handles a %i-minute movie playlist with bounded private resource mappings',
  async (minutes) => {
    const p = await plan();
    const master = await body(await connector.openPlaybackStream(p, request()));
    const query = String(fixture.state.playback.sources[0]!.TranscodingUrl).split('?')[1]!;
    fixture.state.playback.mediaManifest =
      '#EXTM3U\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:6\n#EXT-X-MEDIA-SEQUENCE:0\n' +
      Array.from(
        { length: minutes * 10 },
        (_, n) =>
          `#EXTINF:6.000000, nodesc\nhls1/main/${n}.ts?${query}&runtimeTicks=${n * 60000000}&actualSegmentLengthTicks=60000000\n`,
      ).join('') +
      '#EXT-X-ENDLIST\n';
    expect(Buffer.byteLength(fixture.state.playback.mediaManifest)).toBeGreaterThan(128 * 1024);
    const media = await body(
      await connector.openPlaybackResource(p, master.trim().split('/').at(-1)!, request()),
    );
    const refs = media.split('\n').filter((line) => line.startsWith(resourceBase));
    expect(refs).toHaveLength(minutes * 10);
    expect(new Set(refs).size).toBe(minutes * 10);
    expect(media).not.toContain(fixture.state.token);
    expect(
      await body(
        await connector.openPlaybackResource(p, refs.at(-1)!.split('/').at(-1)!, request()),
      ),
    ).not.toHaveLength(0);
  },
);
