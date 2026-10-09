/** Jellyfin 10.11.x-only HLS paths and private resource mappings. No URL leaves this package. */
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import type { Api } from '@jellyfin/sdk/lib/api.js';
import { ConnectorError } from '@openflix/connector-core';
import type { PlaybackInfo, PlaybackStreamRequest, PlaybackStream } from '@openflix/connector-core';
import { binaryTransport } from './playback-transport.js';
const bad = (): never => {
  throw new ConnectorError('invalid_response');
};
const playlistLimit = 128 * 1024;
const key = () => randomBytes(16).toString('hex');
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
interface Resource {
  id: string;
  url: URL;
  kind: 'playlist' | 'segment' | 'init';
  depth: number;
  ancestors: string[];
}
const queryNames = new Set([
  'deviceid',
  'mediasourceid',
  'playsessionid',
  'videocodec',
  'audiocodec',
  'audiostreamindex',
  'videostreamindex',
  'videobitrate',
  'audiobitrate',
  'audiosamplerate',
  'audiochannels',
  'maxaudiochannels',
  'transcodingmaxaudiochannels',
  'segmentcontainer',
  'segmentlength',
  'minsegments',
  'breakonnonkeyframes',
  'requireavc',
  'requirenonanamorphic',
  'enableaudiovbrencoding',
  'enablempegtsm2tsmode',
  'copytimestamps',
  'tag',
  'transcodereasons',
  'context',
  'profile',
  'level',
  'maxwidth',
  'maxheight',
  'width',
  'height',
  'maxframerate',
  'framerate',
  'maxvideobitdepth',
  'maxaudiobitdepth',
  'maxrefframes',
  'allowvideostreamcopy',
  'allowaudiostreamcopy',
  'enableautostreamcopy',
  'subtitleStreamIndex'.toLowerCase(),
  'enableadaptivebitratestreaming',
  'enabletrickplay',
  'starttimeticks',
  'runtimeTicks'.toLowerCase(),
  'actualsegmentlengthticks',
  'cpucorelimit',
  'deinterlace',
  'alwaysburninsubtitlewhentranscoding',
  'h264-audiochannels',
  'aac-profile',
  'aac-audiochannels',
  'h264-profile',
  'h264-level',
  'h264-videobitdepth',
  'h264-videorangetype',
  'h264-width',
  'h264-height',
  'h264-maxframerate',
]);
export class HlsPlayback {
  private readonly resources = new Map<string, Resource>();
  private readonly byUrl = new Map<string, Resource>();
  private closed = false;
  readonly root: Resource;
  constructor(
    private readonly api: Api,
    private token: string,
    readonly plan: PlaybackInfo,
    raw: string,
    private readonly videoCopy: boolean,
    private readonly audioCopy: boolean,
    private readonly audioIndex: number,
    private readonly videoIndex: number,
    private readonly sourceCodecs: readonly string[],
  ) {
    this.root = this.add(this.normalize(raw, new URL(api.getUri('/')), true), 0, [], 'playlist');
  }
  private normalize(raw: string, parent: URL, generated = false): URL {
    if (raw.length > 8192 || /[\s\\\u0000-\u001f]/.test(raw) || raw.startsWith('//')) return bad();
    const rawPath = raw.split(/[?#]/)[0]!;
    if (rawPath.includes('%') || rawPath.split('/').some((p) => p === '.' || p === '..'))
      return bad();
    const absolute = /^[a-z][a-z0-9+.-]*:/i.test(raw);
    if (absolute && !generated) return bad();
    const base = new URL(this.api.getUri('/'));
    const prefix = base.pathname.replace(/\/$/, '');
    let url: URL;
    try {
      if (raw.startsWith('/') && /^\/videos\//i.test(raw)) url = new URL(prefix + raw, base.origin);
      else url = new URL(raw, parent);
    } catch {
      return bad();
    }
    if (
      url.origin !== base.origin ||
      url.protocol !== base.protocol ||
      url.username ||
      url.password ||
      url.hash
    )
      return bad();
    // Jellyfin StreamInfo appends a Guid in dashed form; DTO IDs use the N form.
    const pattern = new RegExp(
      '^' +
        escape(prefix) +
        '/videos/([a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/(?:master\\.m3u8|main\\.m3u8|hls1/main/(?:-1|[0-9]{1,6})\\.(?:ts|mp4))$',
      'i',
    );
    const match = pattern.exec(url.pathname);
    if (
      !match ||
      match[1]!.replaceAll('-', '').toLowerCase() !==
        this.plan.itemId.replaceAll('-', '').toLowerCase()
    )
      return bad();
    url.pathname = url.pathname.replace(
      match[1]!,
      this.plan.itemId.replaceAll('-', '').toLowerCase(),
    );
    const clean = new URLSearchParams(),
      seen = new Set<string>();
    for (const [name, value] of url.searchParams) {
      const lower = name.toLowerCase();
      if (seen.has(lower)) return bad();
      seen.add(lower);
      if (lower === 'apikey' || lower === 'api_key') {
        if (value !== this.token) return bad();
        continue;
      }
      const sourceOption = /^([a-z0-9_]{1,32})-(profile|level|videobitdepth|audiochannels)$/.exec(
        lower,
      );
      const knownSourceOption = sourceOption && this.sourceCodecs.includes(sourceOption[1]!);
      if (
        (!queryNames.has(lower) && !knownSourceOption) ||
        value.length > 1024 ||
        !/^[A-Za-z0-9.,_-]*$/.test(value)
      )
        return bad();
      // StreamInfo carries input-codec options as well as H264/AAC output options.
      // Only recognized properties of the selected input codecs may be discarded.
      if (knownSourceOption && !['h264', 'aac'].includes(sourceOption[1]!)) continue;
      clean.set(lower, value);
    }
    for (const [name, expected] of [
      ['mediasourceid', this.plan.sourceId],
      ['playsessionid', this.plan.sessionId],
      ['deviceid', this.api.deviceInfo.id],
    ]) {
      if (clean.has(name) && clean.get(name) !== expected) return bad();
      if (generated && !clean.has(name)) return bad();
      clean.set(name, expected);
    }
    for (const [name, index] of [
      ['audiostreamindex', this.audioIndex],
      ['videostreamindex', this.videoIndex],
    ] as const) {
      if (clean.has(name) && clean.get(name) !== String(index)) return bad();
      clean.set(name, String(index));
    }
    if (
      generated &&
      (clean.get('videocodec') !== 'h264' ||
        clean.get('audiocodec') !== 'aac' ||
        clean.get('segmentcontainer') !== 'ts')
    )
      return bad();
    for (const [name, max] of [
      ['videobitrate', 6000000],
      ['audiobitrate', 192000],
      ['audiosamplerate', 48000],
      ['maxwidth', 1920],
      ['maxheight', 1080],
      ['maxframerate', 30],
      ['maxvideobitdepth', 8],
      ['transcodingmaxaudiochannels', 2],
      ['segmentlength', 6],
      ['cpucorelimit', 2],
    ] as const) {
      const value = clean.get(name);
      if (value !== null && (!/^\d+(?:\.\d+)?$/.test(value) || Number(value) <= 0)) return bad();
      clean.set(name, String(value === null ? max : Math.min(max, Number(value))));
    }
    if (
      clean.has('width') &&
      (!/^\d+$/.test(clean.get('width')!) || Number(clean.get('width')) > 1920)
    )
      return bad();
    if (
      clean.has('height') &&
      (!/^\d+$/.test(clean.get('height')!) || Number(clean.get('height')) > 1080)
    )
      return bad();
    if (clean.has('subtitleStreamIndex'.toLowerCase()) && clean.get('subtitlestreamindex') !== '-1')
      return bad();
    if (
      clean.has('static') ||
      clean.get('alwaysburninsubtitlewhentranscoding')?.toLowerCase() === 'true'
    )
      return bad();
    for (const name of ['h264-audiochannels', 'aac-audiochannels'])
      if (clean.has(name)) {
        const value = clean.get(name)!;
        if (!/^\d{1,2}$/.test(value) || Number(value) < 1 || Number(value) > 64) return bad();
        if (this.audioCopy && Number(value) > 2) return bad();
        clean.set(name, String(Math.min(2, Number(value))));
      }
    if (this.audioCopy && clean.has('aac-profile') && clean.get('aac-profile') !== 'lc')
      return bad();
    if (!this.audioCopy) clean.set('aac-profile', 'lc');
    if (clean.has('h264-level')) {
      const value = clean.get('h264-level')!;
      if (!/^\d+(?:\.\d+)?$/.test(value) || Number(value) <= 0) return bad();
      if (this.videoCopy && Number(value) > 41) return bad();
      clean.set('h264-level', String(Math.min(41, Number(value))));
    }
    if (
      this.videoCopy &&
      clean.has('h264-profile') &&
      !['baseline', 'constrainedbaseline', 'main', 'high'].includes(clean.get('h264-profile')!)
    )
      return bad();
    if (!this.videoCopy) {
      clean.set('h264-profile', 'high');
      clean.set('h264-level', '41');
      clean.set('h264-videobitdepth', '8');
    }
    clean.set('subtitlestreamindex', '-1');
    clean.set('allowvideostreamcopy', String(this.videoCopy));
    clean.set('allowaudiostreamcopy', String(this.audioCopy));
    clean.set('enableautostreamcopy', 'true');
    clean.set('enableadaptivebitratestreaming', 'false');
    clean.set('enabletrickplay', 'false');
    clean.set('videocodec', 'h264');
    clean.set('audiocodec', 'aac');
    clean.set('segmentcontainer', 'ts');
    clean.sort();
    url.search = clean.toString();
    return url;
  }
  private add(url: URL, depth: number, ancestors: string[], expected?: Resource['kind']): Resource {
    if (
      this.closed ||
      ancestors.some((ancestor) => new URL(ancestor).pathname === url.pathname) ||
      depth > 2
    )
      return bad();
    const kind = url.pathname.endsWith('.m3u8')
      ? 'playlist'
      : url.pathname.endsWith('/-1.mp4')
        ? 'init'
        : 'segment';
    if (expected && kind !== expected) return bad();
    const existing = this.byUrl.get(url.href);
    if (existing) return existing;
    if (
      this.resources.size >= 4096 ||
      (kind === 'playlist' &&
        [...this.resources.values()].filter((r) => r.kind === 'playlist').length >= 16)
    )
      return bad();
    const result: Resource = { id: key(), url, kind, depth, ancestors };
    this.resources.set(result.id, result);
    this.byUrl.set(url.href, result);
    return result;
  }
  private rewrite(text: string, parent: Resource, base: string): string {
    if (!/^\/api\/v1\/playback\/sessions\/[a-f0-9-]{36}\/resources\/$/.test(base)) return bad();
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    if (lines[0] !== '#EXTM3U' || lines.length > 4096) return bad();
    let pending: 'playlist' | 'segment' | undefined,
      master = false,
      media = false;
    const result: string[] = [];
    const reference = (raw: string, kind: Resource['kind']) => {
      const target = this.normalize(raw, parent.url);
      if (kind === 'playlist' && parent.depth >= 2) return bad();
      const resource = this.add(
        target,
        parent.depth + (kind === 'playlist' ? 1 : 0),
        [...parent.ancestors, parent.url.href],
        kind,
      );
      return base + resource.id;
    };
    for (const line of lines) {
      if (!line) continue;
      if (line.length > 8192 || /[\u0000-\u0008\u000b-\u001f]/.test(line)) return bad();
      if (!line.startsWith('#')) {
        if (!pending) return bad();
        result.push(reference(line, pending));
        pending = undefined;
        continue;
      }
      const [tag] = line.split(':');
      if (tag === '#EXT-X-STREAM-INF') {
        if (pending || media) return bad();
        master = true;
        pending = 'playlist';
        const attrs = parseAttributes(line.slice(tag.length + 1));
        if (!attrs.BANDWIDTH || !/^\d{1,9}$/.test(attrs.BANDWIDTH)) return bad();
        if (
          Object.keys(attrs).some(
            (k) =>
              ![
                'BANDWIDTH',
                'AVERAGE-BANDWIDTH',
                'CODECS',
                'RESOLUTION',
                'FRAME-RATE',
                'VIDEO-RANGE',
              ].includes(k),
          )
        )
          return bad();
      } else if (tag === '#EXTINF') {
        if (pending || master || !/^#EXTINF:\d+(?:\.\d+)?,[^\r\n]*$/.test(line)) return bad();
        media = true;
        pending = 'segment';
      } else if (tag === '#EXT-X-MAP') {
        if (master) return bad();
        media = true;
        const attrs = parseAttributes(line.slice(tag.length + 1));
        if (!attrs.URI || Object.keys(attrs).some((k) => !['URI', 'BYTERANGE'].includes(k)))
          return bad();
        const uri = reference(attrs.URI, 'init');
        if (attrs.BYTERANGE && !/^\d+(?:@\d+)?$/.test(attrs.BYTERANGE)) return bad();
        result.push(
          `#EXT-X-MAP:URI="${uri}"${attrs.BYTERANGE ? `,BYTERANGE="${attrs.BYTERANGE}"` : ''}`,
        );
        continue;
      } else if (
        [
          '#EXTM3U',
          '#EXT-X-ENDLIST',
          '#EXT-X-DISCONTINUITY',
          '#EXT-X-INDEPENDENT-SEGMENTS',
        ].includes(tag!)
      ) {
        if (line !== tag) return bad();
      } else if (
        [
          '#EXT-X-VERSION',
          '#EXT-X-TARGETDURATION',
          '#EXT-X-MEDIA-SEQUENCE',
          '#EXT-X-DISCONTINUITY-SEQUENCE',
        ].includes(tag!)
      ) {
        if (!new RegExp('^' + tag + ':[0-9]{1,10}$').test(line)) return bad();
      } else if (tag === '#EXT-X-PLAYLIST-TYPE') {
        if (!/^#EXT-X-PLAYLIST-TYPE:(VOD|EVENT)$/.test(line)) return bad();
      } else if (tag === '#EXT-X-BYTERANGE') {
        if (!/^#EXT-X-BYTERANGE:\d+(?:@\d+)?$/.test(line)) return bad();
      } else if (tag === '#EXT-X-START') {
        const attrs = parseAttributes(line.slice(tag.length + 1));
        if (
          !attrs['TIME-OFFSET'] ||
          !/^-?\d+(?:\.\d+)?$/.test(attrs['TIME-OFFSET']) ||
          Object.keys(attrs).some((k) => !['TIME-OFFSET', 'PRECISE'].includes(k))
        )
          return bad();
      } else return bad(); // Keys, DRM, subtitles, external tracks, low-latency and unknown tags fail closed.
      result.push(line);
    }
    if (pending || (!master && !media)) return bad();
    const output = result.join('\n') + '\n';
    if (
      output.includes(this.token) ||
      /api[_-]?key|authorization|access[_-]?token/i.test(output) ||
      Buffer.byteLength(output) > playlistLimit
    )
      return bad();
    return output;
  }
  async open(
    api: Api,
    id: string | undefined,
    request: PlaybackStreamRequest,
  ): Promise<PlaybackStream> {
    if (this.closed) throw new ConnectorError('not_found');
    const resource = id ? this.resources.get(id) : this.root;
    if (!resource) throw new ConnectorError('not_found');
    if (resource.kind !== 'playlist') {
      const mime = resource.url.pathname.endsWith('.ts') ? 'video/mp2t' : 'video/mp4';
      return binaryTransport(
        api,
        resource.url,
        { ...request, signal: AbortSignal.any([request.signal, AbortSignal.timeout(30000)]) },
        mime,
        mime === 'video/mp4' ? ['video/mp4', 'application/mp4'] : [mime],
        64 * 1024 * 1024,
        12000,
      );
    }
    if (!request.resourceBase) throw new ConnectorError('invalid_configuration');
    const { range: _range, ...manifestRequest } = request;
    const upstream = await binaryTransport(
      api,
      resource.url,
      {
        ...manifestRequest,
        method: 'GET',
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(30000)]),
      },
      'application/vnd.apple.mpegurl',
      ['application/vnd.apple.mpegurl', 'application/x-mpegurl', 'audio/mpegurl'],
      playlistLimit,
      12000,
    );
    if (upstream.status !== 200 || !upstream.body) {
      upstream.cancel();
      return bad();
    }
    const chunks: Buffer[] = [];
    let size = 0;
    try {
      for await (const chunk of upstream.body) {
        size += chunk.length;
        if (size > playlistLimit) return bad();
        chunks.push(chunk);
      }
      let text: string;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
      } catch {
        return bad();
      }
      const rewritten = this.rewrite(text, resource, request.resourceBase);
      return {
        status: 200,
        headers: {
          'content-type': 'application/vnd.apple.mpegurl',
          'content-length': String(Buffer.byteLength(rewritten)),
        },
        ...(request.method === 'HEAD' ? {} : { body: Readable.from([rewritten]) }),
        cancel: () => {},
      };
    } finally {
      upstream.cancel();
    }
  }
  close() {
    this.closed = true;
    this.resources.clear();
    this.byUrl.clear();
    this.token = '';
  }
}
/** Strict quoted attribute parser, not URI substring replacement. */
export function parseAttributes(value: string): Record<string, string> {
  const out: Record<string, string> = {};
  let rest = value;
  while (rest) {
    const m = /^([A-Z0-9-]+)=(?:"([^"\r\n]*)"|([^,\r\n]+))(?:,|$)/.exec(rest);
    if (!m || Object.hasOwn(out, m[1]!) || Object.keys(out).length >= 16) return bad();
    out[m[1]!] = m[2] ?? m[3]!;
    rest = rest.slice(m[0].length);
  }
  return out;
}
