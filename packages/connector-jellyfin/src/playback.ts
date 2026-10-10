/** Jellyfin-only planning, DTOs, reporting and authenticated binary transport. */
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { binaryTransport } from './playback-transport.js';
import { HlsPlayback } from './hls.js';
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
// Shared DTO fields are bounded, not required to have video/audio semantics on subtitles or data.
const streamSchema = z.object({
  Type: z.string().min(1).max(64),
  Codec: z.string().max(64).nullish(),
  Profile: z.string().max(64).nullish(),
  Index: z.number().int().nonnegative(),
  IsExternal: z.boolean().optional(),
  BitDepth: z.number().int().nonnegative().max(64).nullish(),
  Channels: z.number().int().nonnegative().max(64).nullish(),
  Level: z.number().nonnegative().max(1000).nullish(),
  BitRate: z.number().int().nonnegative().max(1000000000).nullish(),
  SampleRate: z.number().int().nonnegative().max(384000).nullish(),
  Width: z.number().int().nonnegative().max(32768).nullish(),
  Height: z.number().int().nonnegative().max(32768).nullish(),
  IsInterlaced: z.boolean().optional(),
  IsAVC: z.boolean().nullish(),
  VideoRangeType: z.string().max(64).nullish(),
  AverageFrameRate: z.number().nonnegative().max(1000).nullish(),
  RealFrameRate: z.number().nonnegative().max(1000).nullish(),
});
const sourceSchema = z.object({
  Id: id,
  Protocol: z.string(),
  Container: z.string().max(64).nullish(),
  SupportsDirectPlay: z.boolean(),
  SupportsTranscoding: z.boolean().optional(),
  TranscodingUrl: z.string().max(8192).nullish(),
  IsRemote: z.boolean().optional(),
  IsInfiniteStream: z.boolean().optional(),
  RequiresOpening: z.boolean().optional(),
  RequiresClosing: z.boolean().optional(),
  VideoType: z.string().nullish(),
  RunTimeTicks: z.number().int().nonnegative().max(864000000000).nullish(),
  MediaStreams: z.array(streamSchema).max(128).nullish(),
  DefaultAudioStreamIndex: z.number().int().nullish(),
});
const responseSchema = z.object({
  PlaySessionId: id,
  ErrorCode: z.string().nullish(),
  MediaSources: z.array(sourceSchema).max(16),
});
function parsePlaybackInfo(value: unknown) {
  const parsed = responseSchema.safeParse(value);
  if (!parsed.success)
    throw new ConnectorError('invalid_response', {
      stage: 'planning',
      resourceKind: 'playback_info',
      reason: 'malformed_metadata',
    });
  return parsed.data;
}
type Source = z.infer<typeof sourceSchema>;
function hasRuntime(source: Source): source is Source & { RunTimeTicks: number } {
  return source.RunTimeTicks != null && source.RunTimeTicks > 0;
}
function invalidFrameRate(stream: z.infer<typeof streamSchema>, max: number): boolean {
  return [stream.AverageFrameRate, stream.RealFrameRate].some(
    (rate) => rate != null && (rate <= 0 || rate > max),
  );
}
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
  const videos = (source.MediaStreams ?? []).filter((s) => s.Type === 'Video' && !s.IsExternal);
  const audios = (source.MediaStreams ?? []).filter((s) => s.Type === 'Audio' && !s.IsExternal);
  // A native element may choose a different track; require every embedded audio track to be supported.
  if (audios.some((a) => !a.Channels || a.Channels > 2 || (a.BitDepth != null && a.BitDepth <= 0)))
    return;
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
    (v.BitDepth != null && v.BitDepth <= 0) ||
    v.Width > 1920 ||
    v.Height > 1080 ||
    (v.BitDepth != null && v.BitDepth !== 8) ||
    v.IsInterlaced ||
    (v.VideoRangeType && v.VideoRangeType !== 'SDR') ||
    invalidFrameRate(v, 30)
  )
    return;
  if (
    source.Container === 'mp4' &&
    profile.formats.includes('mp4-h264-aac') &&
    v.Codec === 'h264' &&
    ['Baseline', 'Constrained Baseline', 'Main', 'High'].includes(v.Profile ?? '') &&
    v.Level != null &&
    v.Level > 0 &&
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
function hlsSource(source: z.infer<typeof sourceSchema>) {
  if (
    source.Protocol !== 'File' ||
    source.IsRemote ||
    source.IsInfiniteStream ||
    source.RequiresOpening ||
    source.RequiresClosing ||
    (source.VideoType && source.VideoType !== 'VideoFile') ||
    !hasRuntime(source) ||
    source.RunTimeTicks > 144000000000
  )
    return;
  const videos = (source.MediaStreams ?? []).filter((s) => s.Type === 'Video' && !s.IsExternal);
  const audios = (source.MediaStreams ?? []).filter((s) => s.Type === 'Audio' && !s.IsExternal);
  if (videos.length !== 1 || !audios.length) return;
  const v = videos[0]!;
  if (
    !v.Codec ||
    !v.Width ||
    !v.Height ||
    (v.BitDepth != null && v.BitDepth <= 0) ||
    v.Width > 1920 ||
    v.Height > 1080 ||
    v.IsInterlaced ||
    (v.VideoRangeType && v.VideoRangeType !== 'SDR') ||
    invalidFrameRate(v, 60)
  )
    return;
  const a = audios.find((a) => a.Index === source.DefaultAudioStreamIndex) ?? audios[0]!;
  if (
    !a.Codec ||
    !a.Channels ||
    (a.BitDepth != null && a.BitDepth <= 0) ||
    !['h264', 'hevc', 'h265', 'vp8', 'vp9', 'av1', 'mpeg2video', 'mpeg4', 'vc1'].includes(
      v.Codec,
    ) ||
    ![
      'aac',
      'ac3',
      'eac3',
      'dts',
      'truehd',
      'flac',
      'mp3',
      'opus',
      'vorbis',
      'alac',
      'pcm_s16le',
      'pcm_s24le',
      'pcm_f32le',
    ].includes(a.Codec)
  )
    return;
  return {
    durationMs: source.RunTimeTicks / 10000,
    videoCopy:
      v.Codec === 'h264' &&
      v.BitRate != null &&
      v.BitRate > 0 &&
      v.BitRate <= 6000000 &&
      v.BitDepth === 8 &&
      ['Baseline', 'Constrained Baseline', 'Main', 'High'].includes(v.Profile ?? '') &&
      v.Level != null &&
      v.Level > 0 &&
      v.Level <= 41 &&
      (v.AverageFrameRate ?? v.RealFrameRate) != null &&
      (v.AverageFrameRate ?? v.RealFrameRate)! <= 30 &&
      (source.Container !== 'avi' || v.IsAVC === true),
    sourceCodecs: [v.Codec, a.Codec],
    audioIndex: a.Index,
    videoIndex: v.Index,
    audioCopy:
      a.Codec === 'aac' &&
      a.Channels <= 2 &&
      a.BitRate != null &&
      a.BitRate > 0 &&
      a.BitRate <= 192000 &&
      a.SampleRate != null &&
      a.SampleRate > 0 &&
      a.SampleRate <= 48000 &&
      (!a.Profile || a.Profile === 'LC'),
  };
}
export function playbackOperations(access: Access) {
  const hls = new Map<string, HlsPlayback>();
  return {
    async getPlaybackInfo(
      itemId: string,
      profile: ClientProfile,
      policy?: { singleVersionOnly: boolean },
    ): Promise<PlaybackInfo> {
      if (
        !/^[a-fA-F0-9-]{16,64}$/.test(itemId) ||
        !Array.isArray(profile.formats) ||
        !profile.formats.length ||
        profile.formats.length > 5 ||
        profile.formats.some((f) => f !== 'hls-h264-aac' && !Object.hasOwn(profiles, f))
      )
        throw new ConnectorError('invalid_configuration');
      return access(async (api, credential) => {
        const data = parsePlaybackInfo(
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
                  DirectPlayProfiles: profile.formats
                    .filter((f): f is keyof typeof profiles => f !== 'hls-h264-aac')
                    .map((f) => profiles[f]),
                  TranscodingProfiles: [],
                },
              },
            })
          ).data,
        );
        if (data.ErrorCode) throw new ConnectorError('unsupported');
        if (policy?.singleVersionOnly && data.MediaSources.length !== 1)
          throw new ConnectorError('unsupported');
        for (const source of data.MediaSources) {
          if (!hasRuntime(source)) continue;
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
        if (profile.formats.includes('hls-h264-aac') && data.MediaSources.some(hlsSource)) {
          const fallback = parsePlaybackInfo(
            (
              await getMediaInfoApi(api).getPostedPlaybackInfo({
                itemId,
                playbackInfoDto: {
                  UserId: credential.userId,
                  EnableDirectPlay: true,
                  EnableDirectStream: true,
                  EnableTranscoding: true,
                  AutoOpenLiveStream: false,
                  StartTimeTicks: 0,
                  SubtitleStreamIndex: -1,
                  MaxStreamingBitrate: 6192000,
                  DeviceProfile: {
                    Name: 'OpenFlix M4 R1 HLS',
                    MaxStreamingBitrate: 6192000,
                    DirectPlayProfiles: profile.formats
                      .filter((f): f is keyof typeof profiles => f !== 'hls-h264-aac')
                      .map((f) => profiles[f]),
                    TranscodingProfiles: [
                      {
                        Type: 'Video',
                        Container: 'ts',
                        Protocol: 'hls',
                        VideoCodec: 'h264',
                        AudioCodec: 'aac',
                        Context: 'Streaming',
                        MaxAudioChannels: '2',
                        SegmentLength: 6,
                        MinSegments: 1,
                        EnableSubtitlesInManifest: false,
                      },
                    ],
                    CodecProfiles: [
                      {
                        Type: 'Video',
                        Codec: 'h264',
                        Conditions: [
                          { Condition: 'LessThanEqual', Property: 'Width', Value: '1920' },
                          { Condition: 'LessThanEqual', Property: 'Height', Value: '1080' },
                          { Condition: 'LessThanEqual', Property: 'VideoBitDepth', Value: '8' },
                          { Condition: 'LessThanEqual', Property: 'VideoLevel', Value: '41' },
                          { Condition: 'LessThanEqual', Property: 'VideoFramerate', Value: '30' },
                        ],
                      },
                      {
                        Type: 'VideoAudio',
                        Codec: 'aac',
                        Conditions: [
                          { Condition: 'LessThanEqual', Property: 'AudioChannels', Value: '2' },
                        ],
                      },
                    ],
                  },
                },
              })
            ).data,
          );
          if (fallback.ErrorCode) throw new ConnectorError('unsupported');
          if (
            policy?.singleVersionOnly &&
            (fallback.MediaSources.length !== 1 ||
              fallback.MediaSources[0]?.Id !== data.MediaSources[0]?.Id)
          )
            throw new ConnectorError('unsupported');
          for (const source of fallback.MediaSources) {
            const copy = hlsSource(source);
            if (!copy || !source.SupportsTranscoding || !source.TranscodingUrl) continue;
            // Server/user limits may be narrower than our client profile. Honor them in the reported method.
            const target = new URL(source.TranscodingUrl, api.getUri('/'));
            const limit = (name: string, max: number) => {
              const raw = [...target.searchParams].find(([key]) => key.toLowerCase() === name)?.[1];
              return raw === undefined ? max : Math.min(max, Number(raw));
            };
            const video = (source.MediaStreams ?? []).find(
              (s) => s.Type === 'Video' && !s.IsExternal,
            )!;
            const audio = (source.MediaStreams ?? []).find((s) => s.Index === copy.audioIndex)!;
            copy.videoCopy &&=
              video.BitRate! <= limit('videobitrate', 6000000) &&
              video.Width! <= limit('maxwidth', 1920) &&
              video.Height! <= limit('maxheight', 1080) &&
              (video.AverageFrameRate ?? video.RealFrameRate)! <= limit('maxframerate', 30);
            copy.audioCopy &&=
              audio.BitRate! <= limit('audiobitrate', 192000) &&
              audio.SampleRate! <= limit('audiosamplerate', 48000) &&
              audio.Channels! <= limit('transcodingmaxaudiochannels', 2);
            const plan: PlaybackInfo = {
              itemId,
              sourceId: source.Id,
              sessionId: fallback.PlaySessionId,
              kind: 'video',
              mode: copy.videoCopy && copy.audioCopy ? 'remux' : 'transcode',
              videoTranscoded: !copy.videoCopy,
              contentType: 'application/vnd.apple.mpegurl',
              durationMs: copy.durationMs,
            };
            if (hls.size >= 8 || hls.has(plan.sessionId)) throw new ConnectorError('unsupported');
            hls.set(
              plan.sessionId,
              new HlsPlayback(
                api,
                credential.token,
                plan,
                source.TranscodingUrl,
                copy.videoCopy,
                copy.audioCopy,
                copy.audioIndex,
                copy.videoIndex,
                copy.sourceCodecs,
              ),
            );
            return plan;
          }
        }
        throw new ConnectorError('unsupported', {
          stage: 'planning',
          resourceKind: 'playback_info',
          reason:
            data.MediaSources.length > 0 && data.MediaSources.every((s) => !hasRuntime(s))
              ? 'insufficient_runtime'
              : 'no_supported_source',
        });
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
        if (plan.mode !== 'direct') {
          const playback = hls.get(plan.sessionId);
          if (!playback || playback.plan !== plan) throw new ConnectorError('not_found');
          return playback.open(api, undefined, request);
        }
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
        return binaryTransport(
          api,
          url,
          request,
          plan.contentType,
          plan.contentType === 'audio/wav' ? ['audio/wav', 'audio/x-wav'] : [plan.contentType],
        );
      });
    },
    async openPlaybackResource(
      plan: PlaybackInfo,
      resourceId: string,
      request: PlaybackStreamRequest,
    ): Promise<PlaybackStream> {
      if (!/^[a-f0-9]{32}$/.test(resourceId)) throw new ConnectorError('not_found');
      const playback = hls.get(plan.sessionId);
      if (!playback || playback.plan !== plan) throw new ConnectorError('not_found');
      return access((api) => playback.open(api, resourceId, request));
    },
    async closePlayback(plan: PlaybackInfo) {
      const playback = hls.get(plan.sessionId);
      if (!playback || playback.plan !== plan) return;
      hls.delete(plan.sessionId);
      playback.close();
      await access(
        (api) =>
          new Promise<void>((resolve, reject) => {
            const url = new URL(api.getUri('/Videos/ActiveEncodings'));
            url.search = new URLSearchParams({
              deviceId: api.deviceInfo.id,
              playSessionId: plan.sessionId,
            }).toString();
            const req = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
              url,
              {
                method: 'DELETE',
                headers: { Authorization: api.authorizationHeader },
                maxHeaderSize: 16384,
              },
              (res) => {
                res.resume();
                if (res.statusCode === 204) resolve();
                else reject(new ConnectorError('unavailable'));
              },
            );
            const timer = setTimeout(() => req.destroy(new Error('deadline')), 5000);
            req.once('close', () => clearTimeout(timer));
            req.once('error', () => reject(new ConnectorError('unavailable')));
            req.end();
          }),
      );
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
    PlayMethod: (s.mode && s.mode !== 'direct'
      ? s.videoTranscoded
        ? 'Transcode'
        : 'DirectStream'
      : 'DirectPlay') as 'DirectPlay' | 'DirectStream' | 'Transcode',
  };
}
