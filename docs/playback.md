# Milestone 4 direct-play foundation

> This guide describes the original direct-only implementation. Accepted M4 R2 also includes [HLS remux/transcoding and revised bounds](status.md#playback-scope). Statements below about deferred HLS and direct-only limits describe the original scope, not the current release.

M4 brokers actual media bytes from a trusted administrator-configured Jellyfin connector. It does not change the audited catalog, SQLite schema/storage boundary, authentication, credential encryption or connector URL policy. Read the [official API baseline](milestone-4-api-baseline.md) and [verification procedure](milestone-4-verification.md).

## Authorization and trust

Catalog visibility is not playback permission. Only OpenFlix administrators may initiate, stream, report or stop playback. Administrators are trusted to use all configured connectors; ordinary users remain denied even when they can browse imported metadata. There is no implicit sharing switch or per-user Jellyfin mapping. The connector's Jellyfin identity still determines upstream access. Changes to upstream permissions can invalidate playback; catalog metadata may remain visible until resynchronization.

The client supplies an OpenFlix catalog item ID and a short allowlisted capability list. The server resolves the source and upstream item internally. It rejects navigation objects (series, seasons, albums, artists, playlists, folders), arbitrary source selectors, URLs and extra query parameters. Only movies, episodes and audio tracks are playable. Source IDs come from validated PlaybackInfo responses, never browser input.

Grants are random UUIDs bound to the OpenFlix user, exact login-session digest, catalog item and connector. A UUID alone grants nothing. Every stream, HEAD and report request rechecks login, admin role, source existence and expiry; cross-user or different-login use fails. Mutations retain exact-Origin CSRF enforcement. Cross-site media fetches are denied. Grants expire after four hours absolutely or five minutes without an accepted playback report. A one-second sweep aborts existing transfers after logout, source removal or expiry; already-delivered/buffered bytes cannot be recalled.

State is ephemeral: at most eight grants/pending plans/cleanup operations, two grants per user, two concurrent streams per grant and sixteen streams globally. Planning is also rate-limited to ten requests per minute under the existing HTTP limiter. On restart old grants return 410 and users prepare a new session using the saved encrypted connector credential. No migration, permanent stream URL, playback bearer token or watch-history table is added.

## Supported direct formats

The browser advertises support with native `canPlayType`; the connector additionally validates the upstream source. Only finite local-file sources that Jellyfin marks DirectPlay are eligible. Remote HTTP sources, live streams, discs and sources requiring opening/closing are refused. All embedded audio tracks must be supported, since a native browser may select a different track.

| Container | Video                                                     | Audio                                       | Further bounds                                            |
| --------- | --------------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------- |
| MP4       | H.264 Baseline/Constrained Baseline/Main/High, level ≤4.1 | AAC LC, mono/stereo, or no audio            | ≤1920×1080, 8-bit SDR, progressive, ≤30 fps when provided |
| WebM      | VP8                                                       | Opus mono/stereo, or no audio               | same video bounds                                         |
| MP3       | none                                                      | MP3 mono/stereo                             | finite duration                                           |
| WAV       | none                                                      | PCM signed 16-bit little-endian mono/stereo | finite duration                                           |

The maximum accepted duration is 24 hours; grants still expire after four hours. Missing/invalid source data fails closed. These constraints do not guarantee that every device decodes every conforming file. M4 does not support subtitles, alternate-track selection, HDR, HEVC, MKV, surround audio, adaptive bitrate or universal codec support. Browser decode errors are displayed safely.

**Transcoding/HLS is deferred.** Planning explicitly disables direct-stream conversion, transcoding and automatic live-stream opening. Unsupported media returns 415 rather than an unusable guessed URL. No HLS endpoints, manifests, segment rewriting or hls.js dependency exist. This narrow direct-only path is the M4 scope decision; Jellyfin remains the only possible future transcoding engine.

## Binary transport

Jellyfin DTOs and endpoint construction remain inside `packages/connector-jellyfin`. Metadata/reporting use the pinned official SDK. Binary transport uses Node HTTP(S) streams rather than the JSON client's whole-response timeout/size settings. It constructs only the inspected `/Videos/:id/stream` or `/Audio/:id/stream` static endpoint at the validated configured origin. It never follows a DTO Path, TranscodingUrl, remote source URL or redirect. The permanent token travels only in the server-to-Jellyfin Authorization header, never in URL query parameters.

TLS verification remains enabled and LAN connectivity remains administrator-trusted. This is not an SSRF sandbox against malicious administrators or a compromised configured server. Browser requests cannot select arbitrary origins, schemes or paths. Read [connector security](connector-security.md).

GET/HEAD pass through actual 200/206/416 semantics. Only one bounded byte range is accepted. Content-Type must match the selected supported format; content encoding must be identity. Only checked Content-Length, Content-Range, Accept-Ranges and content type are forwarded. A 200 response to a Range request remains 200; OpenFlix never fabricates seeking support. Upstream error bodies and redirect locations are discarded. Cache policy is private/no-store/no-transform.

Readable streams provide backpressure without accumulating the file. Connections have a five-second header deadline, thirty-second socket idle timeout and bounded response headers. Disconnect, expiry, stop and shutdown cancel upstream requests. The supplied Nginx media location disables buffering, temporary-file spill and gzip and uses a matching longer read timeout. Keep equivalent settings in an outer reverse proxy; public TLS/HSTS remains the operator's responsibility. Ordinary JSON size/time limits are unchanged.

## Lifecycle and watch-state effects

Preparing a grant does not fabricate playback activity. The native player sends start only on actual playing, reports observed position/pause state on pause, seek and every fifteen seconds, and stops on return/navigation/end. Reports are bounded by the source duration and serialized per grant. Cleanup is best effort when upstream is unavailable; local authorization is revoked regardless. Network interruptions display an error and a fresh session may be prepared. Abrupt process/browser death can lose the final position; no durable OpenFlix watch-history claim is made.

Jellyfin's official start/progress/stop operations **may update the connector account's watch progress/history**. Real-server audit requires explicit operator approval and an authorized test identity. Builder tests only use disposable fixtures and synthetic media. They never contact the household server.

## API

All paths are beneath `/api/v1/playback`; all require the original authenticated admin session. POST requires configured Origin. No browser response contains upstream item/source session IDs, credentials, envelopes, upstream URLs or filesystem paths.

| Method/path                     | Request / response                                                                                                                                                                       |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST `/sessions`                | `{itemId, profile:{formats:["mp4-h264-aac","webm-vp8-opus","mp3","wav"]}}`; use only supported formats. 201 `{id,itemId,kind,mode:"direct",contentType,durationMs,expiresAt,streamPath}` |
| GET/HEAD `/sessions/:id/stream` | Same-origin bytes; optional single Range; no query parameters                                                                                                                            |
| POST `/sessions/:id/progress`   | `{event:"start" \| "progress",positionMs,paused}`; 204                                                                                                                                   |
| POST `/sessions/:id/stop`       | `{}`; 204, revokes local grant and aborts transfers                                                                                                                                      |

Safe failures include 400 invalid input, 401 missing login, 403 forbidden role/origin, 404 missing catalog/source, 409 conflicting report, 410 expired/unavailable grant, 413 body too large, 415 unsupported media, 416 invalid/unsatisfied range, 429 capacity/rate limit, 502 sanitized upstream failure, 503 missing credential storage. Post-header transport failure terminates the stream; it cannot replace already-sent headers with JSON. Logs use safe route templates/events and existing error redaction, not media URLs or raw upstream bodies.
