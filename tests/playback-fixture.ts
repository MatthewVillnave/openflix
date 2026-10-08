import type { IncomingMessage, ServerResponse } from 'node:http';
export const playbackItemId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
export const sourceId = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
export const playSessionId = 'cccccccccccccccccccccccccccccccc';
export function playbackSource(kind: 'video' | 'audio' = 'video'): Record<string, unknown> {
  return {
    Id: sourceId,
    Protocol: 'File',
    Container: kind === 'video' ? 'mp4' : 'wav',
    SupportsDirectPlay: true,
    IsRemote: false,
    IsInfiniteStream: false,
    RequiresOpening: false,
    RunTimeTicks: 120000000,
    VideoType: 'VideoFile',
    Path: '/private/household-path-must-not-escape',
    TranscodingUrl: 'https://unsafe.invalid/?api_key=must-not-follow',
    MediaStreams:
      kind === 'video'
        ? [
            {
              Type: 'Video',
              Index: 0,
              Codec: 'h264',
              Profile: 'High',
              Level: 40,
              BitDepth: 8,
              Width: 320,
              Height: 180,
              VideoRangeType: 'SDR',
            },
            { Type: 'Audio', Index: 1, Codec: 'aac', Profile: 'LC', Channels: 2 },
          ]
        : [{ Type: 'Audio', Index: 0, Codec: 'pcm_s16le', Channels: 1 }],
  };
}
export function playbackFixtureState() {
  return {
    sources: [playbackSource()],
    forbidden: false,
    reports: [] as { path: string; body: Record<string, unknown> }[],
    reportFailure: false,
    streamMode: 'normal' as
      | 'normal'
      | 'redirect'
      | 'html'
      | 'slow'
      | 'bad-range'
      | 'wrong-range'
      | 'ignore-range'
      | 'error',
    bytes: Buffer.from(Array.from({ length: 4096 }, (_, i) => i % 256)),
    mime: 'video/mp4',
    cancelled: 0,
    streamRequests: [] as { method: string; range: string | undefined; source: string | null }[],
  };
}
export function servePlayback(
  state: ReturnType<typeof playbackFixtureState>,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  body: string,
): boolean {
  const json = (data: unknown, status = 200) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(data));
  };
  if (/\/Items\/[^/]+\/PlaybackInfo$/.test(url.pathname)) {
    const input = JSON.parse(body);
    if (
      input.EnableTranscoding !== false ||
      input.EnableDirectStream !== false ||
      input.AutoOpenLiveStream !== false ||
      !input.UserId
    ) {
      json({}, 400);
      return true;
    }
    if (state.forbidden) json({}, 403);
    else json({ PlaySessionId: playSessionId, MediaSources: state.sources });
    return true;
  }
  if (/\/Sessions\/Playing(?:\/Progress|\/Stopped)?$/.test(url.pathname)) {
    state.reports.push({ path: url.pathname, body: JSON.parse(body) });
    res.writeHead(state.reportFailure ? 503 : 204);
    res.end();
    return true;
  }
  if (!/\/(Videos|Audio)\/[^/]+\/stream$/.test(url.pathname)) return false;
  state.streamRequests.push({
    method: req.method!,
    range: req.headers.range,
    source: url.searchParams.get('mediaSourceId'),
  });
  if (
    url.searchParams.get('static') !== 'true' ||
    url.searchParams.get('mediaSourceId') !== sourceId ||
    url.searchParams.get('playSessionId') !== playSessionId
  ) {
    json({}, 400);
    return true;
  }
  if (state.streamMode === 'redirect') {
    res.writeHead(302, { location: '/credential-trap' });
    res.end();
    return true;
  }
  if (state.streamMode === 'error') {
    json({ error: '/private/path?api_key=synthetic-private' }, 500);
    return true;
  }
  if (state.streamMode === 'html') {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<script>secret</script>');
    return true;
  }
  if (state.streamMode === 'slow') {
    res.writeHead(200, { 'content-type': state.mime });
    res.write(state.bytes);
    const timer = setInterval(() => res.write(state.bytes), 50);
    res.once('close', () => {
      state.cancelled++;
      clearInterval(timer);
    });
    return true;
  }
  let start = 0,
    end = state.bytes.length - 1,
    status = 200;
  const headers: Record<string, string> = { 'content-type': state.mime, 'accept-ranges': 'bytes' };
  if (req.headers.range && state.streamMode !== 'ignore-range') {
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range)!;
    start = m[1] ? Number(m[1]) : Math.max(0, state.bytes.length - Number(m[2]));
    end = m[1] && m[2] ? Math.min(end, Number(m[2])) : end;
    if (start >= state.bytes.length) {
      res.writeHead(416, { 'content-range': `bytes */${state.bytes.length}` });
      res.end('upstream-error-must-not-escape');
      return true;
    }
    status = 206;
    headers['content-range'] =
      state.streamMode === 'bad-range'
        ? 'bytes 3-1/2'
        : state.streamMode === 'wrong-range'
          ? 'bytes 50-59/4096'
          : `bytes ${start}-${end}/${state.bytes.length}`;
  }
  headers['content-length'] = String(end - start + 1);
  res.writeHead(status, headers);
  res.end(req.method === 'HEAD' ? undefined : state.bytes.subarray(start, end + 1));
  return true;
}
