/** Jellyfin-only planning, DTOs, reporting and authenticated binary transport. */
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';
import { z } from 'zod';
import type { Api } from '@jellyfin/sdk/lib/api.js';
import { getMediaInfoApi } from '@jellyfin/sdk/lib/utils/api/media-info-api.js';
import { getSessionApi } from '@jellyfin/sdk/lib/utils/api/session-api.js';
import { ConnectorError } from '@openflix/connector-core';
import type {
  ClientProfile,
  PlaybackInfo,
  PlaybackSession,
  PlaybackStream,
  PlaybackStreamRequest,
} from '@openflix/connector-core';
const id = z.string().regex(/^[a-zA-Z0-9-]{1,128}$/);
const streamSchema = z.object({
  Type: z.string(),
  Codec: z.string().max(64).nullish(),
  Profile: z.string().max(64).nullish(),
  Index: z.number().int().nonnegative(),
  IsExternal: z.boolean().optional(),
  BitDepth: z.number().nullish(),
  Channels: z.number().int().positive().max(64).nullish(),
  Level: z.number().positive().nullish(),
  Width: z.number().int().positive().max(32768).nullish(),
  Height: z.number().int().positive().max(32768).nullish(),
  IsInterlaced: z.boolean().optional(),
  VideoRangeType: z.string().nullish(),
  AverageFrameRate: z.number().positive().nullish(),
});
const sourceSchema = z.object({
  Id: id,
  Protocol: z.string(),
  Container: z.string().max(64),
  SupportsDirectPlay: z.boolean(),
  IsRemote: z.boolean().optional(),
  IsInfiniteStream: z.boolean().optional(),
  RequiresOpening: z.boolean().optional(),
  RequiresClosing: z.boolean().optional(),
  VideoType: z.string().nullish(),
  RunTimeTicks: z.number().int().positive().max(864000000000),
  MediaStreams: z.array(streamSchema).max(128),
  DefaultAudioStreamIndex: z.number().int().nullish(),
});
const responseSchema = z.object({
  PlaySessionId: id,
  ErrorCode: z.string().nullish(),
  MediaSources: z.array(sourceSchema).max(16),
});
type Access = <T>(
  action: (api: Api, credential: { userId: string; token: string }) => Promise<T>,
) => Promise<T>;
const profiles = {
  'mp4-h264-aac': {
    Type: 'Video' as const,
    Container: 'mp4',
    VideoCodec: 'h264',
    AudioCodec: 'aac',
  },
  'webm-vp8-opus': {
    Type: 'Video' as const,
    Container: 'webm',
    VideoCodec: 'vp8',
    AudioCodec: 'opus',
  },
  mp3: { Type: 'Audio' as const, Container: 'mp3', AudioCodec: 'mp3' },
  wav: { Type: 'Audio' as const, Container: 'wav', AudioCodec: 'pcm_s16le' },
};
function choose(
  source: z.infer<typeof sourceSchema>,
  profile: ClientProfile,
): Pick<PlaybackInfo, 'kind' | 'contentType'> | undefined {
  if (
    source.Protocol !== 'File' ||
    source.IsRemote ||
    !source.SupportsDirectPlay ||
    source.IsInfiniteStream ||
    source.RequiresOpening ||
    source.RequiresClosing ||
    (source.VideoType && source.VideoType !== 'VideoFile')
  )
    return;
  const videos = source.MediaStreams.filter((s) => s.Type === 'Video' && !s.IsExternal);
  const audios = source.MediaStreams.filter((s) => s.Type === 'Audio' && !s.IsExternal);
  // A native element may choose a different track; require every embedded audio track to be supported.
  if (audios.some((a) => !a.Channels || a.Channels > 2)) return;
  if (videos.length === 0) {
    if (!audios.length) return;
    if (
      source.Container === 'mp3' &&
      profile.formats.includes('mp3') &&
      audios.every((a) => a.Codec === 'mp3')
    )
      return { kind: 'audio', contentType: 'audio/mpeg' };
    if (
      source.Container === 'wav' &&
      profile.formats.includes('wav') &&
      audios.every((a) => a.Codec === 'pcm_s16le')
    )
      return { kind: 'audio', contentType: 'audio/wav' };
    return;
  }
  if (videos.length !== 1) return;
  const v = videos[0]!;
  if (
    !v.Width ||
    !v.Height ||
    v.Width > 1920 ||
    v.Height > 1080 ||
    (v.BitDepth != null && v.BitDepth !== 8) ||
    v.IsInterlaced ||
    (v.VideoRangeType && v.VideoRangeType !== 'SDR') ||
    (v.AverageFrameRate != null && v.AverageFrameRate > 30)
  )
    return;
  if (
    source.Container === 'mp4' &&
    profile.formats.includes('mp4-h264-aac') &&
    v.Codec === 'h264' &&
    ['Baseline', 'Constrained Baseline', 'Main', 'High'].includes(v.Profile ?? '') &&
    v.Level != null &&
    v.Level <= 41 &&
    audios.every((a) => a.Codec === 'aac' && (!a.Profile || a.Profile === 'LC'))
  )
    return { kind: 'video', contentType: 'video/mp4' };
  if (
    source.Container === 'webm' &&
    profile.formats.includes('webm-vp8-opus') &&
    v.Codec === 'vp8' &&
    audios.every((a) => a.Codec === 'opus')
  )
    return { kind: 'video', contentType: 'video/webm' };
}
export function validRange(range: string): boolean {
  const m = /^bytes=(\d{0,15})-(\d{0,15})$/.exec(range);
  if (!m || (!m[1] && !m[2])) return false;
  if (!m[1]) return Number(m[2]) > 0;
  return !m[2] || Number(m[2]) >= Number(m[1]);
}
export function playbackOperations(access: Access) {
  return {
    async getPlaybackInfo(itemId: string, profile: ClientProfile): Promise<PlaybackInfo> {
      if (
        !/^[a-fA-F0-9-]{16,64}$/.test(itemId) ||
        !Array.isArray(profile.formats) ||
        !profile.formats.length ||
        profile.formats.length > 4 ||
        profile.formats.some((f) => !Object.hasOwn(profiles, f))
      )
        throw new ConnectorError('invalid_configuration');
      return access(async (api, credential) => {
        const data = responseSchema.parse(
          (
            await getMediaInfoApi(api).getPostedPlaybackInfo({
              itemId,
              playbackInfoDto: {
                UserId: credential.userId,
                EnableDirectPlay: true,
                EnableDirectStream: false,
                EnableTranscoding: false,
                AutoOpenLiveStream: false,
                StartTimeTicks: 0,
                DeviceProfile: {
                  Name: 'OpenFlix M4 direct',
                  MaxStreamingBitrate: 100000000,
                  DirectPlayProfiles: profile.formats.map((f) => profiles[f]),
                  TranscodingProfiles: [],
                },
              },
            })
          ).data,
        );
        if (data.ErrorCode) throw new ConnectorError('unsupported');
        for (const source of data.MediaSources) {
          const selected = choose(source, profile);
          if (selected) {
            const plan: PlaybackInfo = {
              itemId,
              sourceId: source.Id,
              sessionId: data.PlaySessionId,
              ...selected,
              mode: 'direct',
              durationMs: source.RunTimeTicks / 10000,
            };
            if (JSON.stringify(plan).includes(credential.token))
              throw new ConnectorError('invalid_response');
            return plan;
          }
        }
        throw new ConnectorError('unsupported');
      });
    },
    async openPlaybackStream(
      plan: PlaybackInfo,
      request: PlaybackStreamRequest,
    ): Promise<PlaybackStream> {
      if (
        !id.safeParse(plan.itemId).success ||
        !id.safeParse(plan.sourceId).success ||
        !id.safeParse(plan.sessionId).success ||
        (request.range && !validRange(request.range))
      )
        throw new ConnectorError('invalid_configuration');
      return access(async (api) => {
        // Construct only the inspected static endpoint. Never follow a DTO URL or filesystem path.
        const url = new URL(
          api.getUri(
            `/${plan.kind === 'audio' ? 'Audio' : 'Videos'}/${encodeURIComponent(plan.itemId)}/stream`,
          ),
        );
        url.search = new URLSearchParams({
          static: 'true',
          mediaSourceId: plan.sourceId,
          playSessionId: plan.sessionId,
          deviceId: api.deviceInfo.id,
        }).toString();
        return new Promise<PlaybackStream>((resolve, reject) => {
          const fail = (
            code:
              | 'unavailable'
              | 'timeout'
              | 'invalid_response'
              | 'unsafe_redirect'
              | 'unauthorized'
              | 'not_found',
          ) => reject(new ConnectorError(code));
          const upstream = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
            method: request.method,
            agent: false,
            signal: request.signal,
            headers: {
              Authorization: api.authorizationHeader,
              Accept: plan.contentType,
              'Accept-Encoding': 'identity',
              ...(request.range ? { Range: request.range } : {}),
            },
            maxHeaderSize: 16384,
          });
          const deadline = setTimeout(() => upstream.destroy(new ConnectorError('timeout')), 5000);
          deadline.unref();
          upstream.setTimeout(30000, () => upstream.destroy(new ConnectorError('timeout')));
          upstream.on('error', () => {
            clearTimeout(deadline);
            fail(request.signal.aborted ? 'timeout' : 'unavailable');
          });
          upstream.once('response', (response) => {
            clearTimeout(deadline);
            const status = response.statusCode ?? 0;
            const cancel = () => {
              response.destroy();
              upstream.destroy();
            };
            const invalid = (code: Parameters<typeof fail>[0]) => {
              cancel();
              fail(code);
            };
            if (status >= 300 && status < 400) return invalid('unsafe_redirect');
            if (status === 401 || status === 403) return invalid('unauthorized');
            if (status === 404) return invalid('not_found');
            if (![200, 206, 416].includes(status)) return invalid('unavailable');
            const headers: Record<string, string> = {};
            const contentRange = response.headers['content-range'];
            if (status === 416) {
              if (!request.range || !contentRange || !/^bytes \*\/\d{1,15}$/.test(contentRange))
                return invalid('invalid_response');
              headers['content-range'] = contentRange;
              cancel();
              resolve({ status: 416, headers, cancel });
              return;
            }
            const mime = response.headers['content-type']?.split(';')[0]?.trim().toLowerCase();
            if (
              (mime !== plan.contentType &&
                !(plan.contentType === 'audio/wav' && mime === 'audio/x-wav')) ||
              (response.headers['content-encoding'] &&
                response.headers['content-encoding'] !== 'identity')
            )
              return invalid('invalid_response');
            headers['content-type'] = plan.contentType;
            const length = response.headers['content-length'];
            if (length !== undefined) {
              if (!/^\d{1,15}$/.test(length)) return invalid('invalid_response');
              headers['content-length'] = length;
            }
            if (status === 206) {
              const m =
                contentRange && /^bytes (\d{1,15})-(\d{1,15})\/(\d{1,15})$/.exec(contentRange);
              if (
                !request.range ||
                !m ||
                Number(m[2]) < Number(m[1]) ||
                Number(m[3]) <= Number(m[2]) ||
                (length !== undefined && Number(length) !== Number(m[2]) - Number(m[1]) + 1)
              )
                return invalid('invalid_response');
              const requested = /^bytes=(\d*)-(\d*)$/.exec(request.range)!;
              const total = Number(m[3]);
              const expectedStart = requested[1]
                ? Number(requested[1])
                : Math.max(0, total - Number(requested[2]));
              const expectedEnd =
                requested[1] && requested[2]
                  ? Math.min(total - 1, Number(requested[2]))
                  : total - 1;
              if (Number(m[1]) !== expectedStart || Number(m[2]) !== expectedEnd)
                return invalid('invalid_response');
              headers['content-range'] = contentRange!;
            }
            if (response.headers['accept-ranges'] === 'bytes') headers['accept-ranges'] = 'bytes';
            if (request.method === 'HEAD') {
              cancel();
              resolve({ status: status as 200 | 206, headers, cancel });
              return;
            }
            response.on('error', () => {});
            const body = Readable.from(
              (async function* () {
                try {
                  for await (const chunk of response) yield chunk;
                } catch {
                  throw new ConnectorError('unavailable');
                } finally {
                  cancel();
                }
              })(),
              { objectMode: false, highWaterMark: 65536 },
            );
            body.on('error', () => {});
            body.once('close', cancel);
            resolve({ status: status as 200 | 206, headers, body, cancel });
          });
          upstream.end();
        });
      });
    },
    async reportPlaybackStart(s: PlaybackSession) {
      await access(async (api) => {
        await getSessionApi(api).reportPlaybackStart({ playbackStartInfo: report(s) });
      });
    },
    async reportPlaybackProgress(s: PlaybackSession) {
      await access(async (api) => {
        await getSessionApi(api).reportPlaybackProgress({ playbackProgressInfo: report(s) });
      });
    },
    async reportPlaybackStop(s: PlaybackSession) {
      await access(async (api) => {
        await getSessionApi(api).reportPlaybackStopped({ playbackStopInfo: report(s) });
      });
    },
  };
}
function report(s: PlaybackSession) {
  if (
    ![s.id, s.itemId, s.sourceId].every((v) => id.safeParse(v).success) ||
    !Number.isFinite(s.positionMs) ||
    s.positionMs < 0 ||
    s.positionMs > s.durationMs
  )
    throw new ConnectorError('invalid_configuration');
  return {
    ItemId: s.itemId,
    MediaSourceId: s.sourceId,
    PlaySessionId: s.id,
    PositionTicks: Math.round(s.positionMs * 10000),
    IsPaused: s.paused,
    CanSeek: true,
    PlayMethod: 'DirectPlay' as const,
  };
}
