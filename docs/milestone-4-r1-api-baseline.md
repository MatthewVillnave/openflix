# Milestone 4 R1 API baseline

Target: Jellyfin **10.11.11**; installed official TypeScript SDK **1.0.0**, unchanged. The SDK was generated from API 12.0.0 revision `1fdc2aefcf963fec84e7eafe15743dafe8c1d26a`.

Inspected official stable [10.11.11 OpenAPI](https://repo.jellyfin.org/files/openapi/stable/jellyfin-openapi-10.11.11.json), SHA-256 `e29fc369ecae54676caeb50cbbc006b5c4ee959906c00f1e02f6f83db9c227fb`. Also compared the [current SDK schema](https://github.com/jellyfin/jellyfin-sdk-typescript/blob/7685bb8e2c3aeda89ca831c2228923affd022fbb/openapi.json), API 12.2.0, SHA-256 `bc8c668b38b65e48ac6ec8c6f763b4bce36b955a0d4a58a27198ee4ec636ab80`. The newer schema omits the legacy dynamic HLS and active-encoding operations. This is operation-specific 10.11.11 support, not SDK-wide/newer-server HLS compatibility.

Read official v10.11.11 implementations:

- [MediaInfoHelper](https://github.com/jellyfin/jellyfin/blob/v10.11.11/Jellyfin.Api/Helpers/MediaInfoHelper.cs): profile and user-permission-dependent source capabilities; ordinary HTTP DirectStream disabled unless explicitly forced; generation of TranscodingUrl.
- [StreamInfo](https://github.com/jellyfin/jellyfin/blob/v10.11.11/MediaBrowser.Model/Dlna/StreamInfo.cs): generated root-relative master URL, dashed Guid path representation (DTO IDs use undashed Guid strings), codec-qualified audio/profile parameters and token-bearing ApiKey query.
- [DynamicHlsController](https://github.com/jellyfin/jellyfin/blob/v10.11.11/Jellyfin.Api/Controllers/DynamicHlsController.cs): copy-codec selection, playlists and authenticated segments.
- [HlsSegmentController](https://github.com/jellyfin/jellyfin/blob/v10.11.11/Jellyfin.Api/Controllers/HlsSegmentController.cs): scoped encoding cleanup.

## Operations consumed

SDK `getPostedPlaybackInfo`: POST `/Items/{itemId}/PlaybackInfo`. First request retains the direct-only M4 profile. If direct selection fails and the browser supports HLS, a second bounded request permits HLS transcoding with H264/AAC, MPEG-TS segments, no manifest subtitles, and explicit bitrate/channel/dimension constraints. Jellyfin AAC streams report Level zero; this is accepted for audio without weakening positive H264 video-level selection. Consume only PlaySessionId, ErrorCode, MediaSources and validated local-source/stream metadata (including bitrate, sample rate and selected AV indices). StreamInfo carries source-qualified HEVC/AC3/etc. options alongside output H264/AAC options; only the supported properties of the inspected selected source codecs are recognized and removed when irrelevant to the output. Server-generated TranscodingUrl is private and strictly checked, then its token query is removed.

Jellyfin-only HTTP transport handles GET/HEAD `/Videos/{itemId}/master.m3u8`, GET `/Videos/{itemId}/main.m3u8`, GET/HEAD `/Videos/{itemId}/hls1/main/{segmentId}.ts` (and validated MP4 initialization/resource references). These operations are absent from the installed generated SDK. Never use the less restrictive legacy `/hls` routes. Requests authenticate by header; redirects are rejected.

SDK session APIs report POST `/Sessions/Playing`, `/Sessions/Playing/Progress`, `/Sessions/Playing/Stopped`. DirectPlay means native file playback; DirectStream means video copied (including audio-only conversion); Transcode means video re-encoded. Positions come from the browser media element. Reporting can change Jellyfin watch state.

DELETE `/Videos/ActiveEncodings` requires **both** configured connector deviceId and the verified PlaySessionId. Cleanup never invokes a global stop operation. Failures are best-effort and sanitized.

The disposable integration pins official image `jellyfin/jellyfin:10.11.11@sha256:aefb67e6a7ff1debdd154a78a7bbb780fd0c873d8639210a7f6a2016ad2b35db`. All media are locally generated test patterns. No household requests are permitted.
