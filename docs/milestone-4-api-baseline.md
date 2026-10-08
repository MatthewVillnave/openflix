# Milestone 4 Jellyfin playback API baseline

Inspected 2026-10-08 before implementation; no household server contacted.

- Official [10.11.11 OpenAPI](https://repo.jellyfin.org/files/openapi/stable/jellyfin-openapi-10.11.11.json), SHA-256 `e29fc369ecae54676caeb50cbbc006b5c4ee959906c00f1e02f6f83db9c227fb` (the schema host redirects to its current storage location).
- Current official SDK repository revision `7685bb8e2c3aeda89ca831c2228923affd022fbb`, [12.2.0 OpenAPI](https://media.githubusercontent.com/media/jellyfin/jellyfin-sdk-typescript/7685bb8e2c3aeda89ca831c2228923affd022fbb/openapi.json), SHA-256 `bc8c668b38b65e48ac6ec8c6f763b4bce36b955a0d4a58a27198ee4ec636ab80`.
- Installed official TypeScript SDK remains 1.0.0, revision `1fdc2aefcf963fec84e7eafe15743dafe8c1d26a`, generated for 12.0.0. Installed generated declarations/implementation and official [MediaInfoApi](https://typescript-sdk.jellyfin.org/classes/generated-client.MediaInfoApi.html), [VideoApi](https://typescript-sdk.jellyfin.org/classes/generated-client.VideoApi.html) and [SessionApi](https://typescript-sdk.jellyfin.org/classes/generated-client.SessionApi.html) documentation were inspected. Compatibility is operation-specific, not a claim about the complete SDK.

## Direct playback and reporting operations

Both inspected schemas provide:

| Operation                         | SDK                                       | Request                                                                            |
| --------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------- |
| POST /Items/{itemId}/PlaybackInfo | MediaInfoApi.getPostedPlaybackInfo        | UserId in body; explicit direct-only policy; no automatic live stream opening      |
| GET/HEAD /Videos/{itemId}/stream  | VideoApi.getVideoStream / headVideoStream | static=true, MediaSourceId, PlaySessionId, DeviceId; authorization header          |
| GET/HEAD /Audio/{itemId}/stream   | AudioApi.getAudioStream / headAudioStream | same bounded source/session parameters                                             |
| POST /Sessions/Playing            | SessionApi.reportPlaybackStart            | ItemId, MediaSourceId, PlaySessionId, PositionTicks, IsPaused, CanSeek, PlayMethod |
| POST /Sessions/Playing/Progress   | SessionApi.reportPlaybackProgress         | actual browser position and pause state, same identity                             |
| POST /Sessions/Playing/Stopped    | SessionApi.reportPlaybackStopped          | last reported position and same identity                                           |

PlaybackInfo response fields inspected: PlaySessionId, ErrorCode, MediaSources including Id, Protocol, Container, SupportsDirectPlay, SupportsDirectStream, SupportsTranscoding, IsRemote, IsInfiniteStream, RequiresOpening/Closing, VideoType, RunTimeTicks, MediaStreams and DefaultAudioStreamIndex. MediaStreams describe Codec, Type, Profile, Level, BitDepth, Channels, Width/Height, VideoRange/VideoRangeType, IsInterlaced, IsExternal and Index. Unconsumed fields, Path, direct/transcoding URLs and required upstream headers must never enter browser responses.

The official 10.11.11 [VideosController](https://github.com/jellyfin/jellyfin/blob/v10.11.11/Jellyfin.Api/Controllers/VideosController.cs) and [AudioController](https://github.com/jellyfin/jellyfin/blob/v10.11.11/Jellyfin.Api/Controllers/AudioController.cs) confirm GET/HEAD static file behavior. Range handling belongs to Jellyfin's file result; OpenFlix must preserve actual 200/206/416 semantics without inventing support or buffering the file. Static remote sources and live/disc sources are excluded from this initial path.

## Transcoding/HLS inspection and scope

10.11.11 exposes GET/HEAD /Videos/{itemId}/master.m3u8 and DELETE /Videos/ActiveEncodings, plus generated HLS segment operations. Current 12.2 reorganizes HLS operations; those legacy paths are absent. A transparent HLS proxy would also require strict authenticated manifest rewriting, source binding, segment validation and browser adaptation. M4's initial supported path is deliberately direct-only, with explicit unsupported-media errors for incompatible formats. No returned TranscodingUrl is followed and no transcoding is silently requested. This does not claim universal codecs or HLS support.

Reporting can change the connector account's Jellyfin watch state. Fixture testing is isolated; Optimus needs explicit operator approval and an authorized test identity before real reporting. No OpenFlix watch-history database is introduced.
