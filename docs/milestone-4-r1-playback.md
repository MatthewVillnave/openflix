# Milestone 4 R1 playback security and scope

R1 extends the preserved M4 direct path with Jellyfin-managed HLS. No database migration or OpenFlix transcoding engine is introduced. Historical M1–M4 reports and audit artifacts remain historical evidence.

## Planning and output

Direct playback remains preferred for validated MP4/H264/AAC, WebM/VP8/Opus, MP3 and PCM WAV sources. HLS is offered only when the browser supports native HLS or HLS.js. The connector requests Jellyfin playback information, validates finite local file sources and item-level stream metadata, and selects a default embedded audio track. A file extension alone never establishes codec support.

The initial fallback supports local progressive SDR video up to 1920×1080, source frame rate up to 60 fps and duration up to four hours. Output is H264/AAC MPEG-TS HLS, at most 1080p/30 fps, 6 Mbps video, 192 kbps stereo audio, six-second segments and two software encoding threads. Compatible H264 video/AAC audio are copied only with known bounded bitrates/sample rates and safe stream metadata (`remux`); incompatible audio or video produces `transcode`. Jellyfin reporting distinguishes video copy (DirectStream) from video conversion (Transcode). Video and default audio stream indices are bound privately to their inspected sources. Selected input-codec profile options emitted by Jellyfin are recognized and discarded when they do not describe the H264/AAC output; arbitrary query keys remain rejected. The mode is a requested policy; real FFmpeg evidence is required to claim an actual copy/conversion occurred.

No universal codec, 4K, HDR, live TV, disc, remote source, subtitle, DRM, track-selection or native iPhone compatibility claim is made. Unsupported source metadata or missing safe transcoding options fail closed. Hardware acceleration is neither configured nor required by this code; actual hardware throughput needs independent measurement.

## Authenticated HLS boundary

Administrators alone may initiate and retrieve playback. Catalog visibility is not playback permission. Every manifest, initialization and segment request checks login, role, original login digest, grant expiry, catalog/source association and connector existence. Knowledge of a grant/resource ID cannot bypass authentication. Grant state is bounded, ephemeral and lost after restart; users can create a fresh session afterward.

Jellyfin's generated URL is validated against the configured origin/base path, catalog item, media source, device and playback session. A matching upstream token query is removed; authentication is sent by header only. The browser sees only same-origin OpenFlix grant paths and random 128-bit resource identifiers. It cannot select upstream paths, sources, codecs, jobs or credentials.

Manifests are parsed as a supported HLS subset rather than rewritten with substring replacement. URI attributes (including initialization MAP references) and ordinary playlist/segment references are mapped separately. External/absolute manifest references, protocol-relative references, changed origins, unsafe schemes, percent-encoded paths, dot traversal, fragments, unsupported queries and mismatched identities fail closed. Keys/DRM, alternate subtitle/audio rendition references, low-latency and unknown directives are rejected. Recursive references are limited by ancestor detection and maximum playlist depth. Unsupported responses return sanitized connector errors.

Limits: 128 KiB/4,096 lines per manifest; 8 KiB per URL/line; 4,096 mapped resources and 16 playlists per grant; playlist nesting depth two; 64 MiB maximum segment bytes; 16 KiB upstream headers; 12-second HLS header and 30-second idle/manifest deadlines. Media segments use the existing backpressured 64 KiB transport; collections/full movies are never buffered. Redirects, compressed upstream responses and unexpected MIME/status codes are rejected. Manifests return complete bounded HTTP 200 responses even when a native player sends a Range hint; segment byte ranges retain verified upstream semantics. Responses are private/no-store/no-transform and Nginx buffering/compression is disabled on playback resources.

The broker retains eight global/two-per-user grant limits. Direct sessions retain two concurrent streams; HLS permits six; global streams are bounded at 32. Playback retrieval has a 240/minute route/IP limit plus a 120/minute grant limit. JSON body limits and other API protection remain unchanged. A slow or overloaded encoder fails clearly; R1 does not promise unlimited concurrent transcoding.

## Lifecycle and browser

Native HLS is preferred on Apple browsers or when MSE is unavailable; pinned HLS.js 1.7.3 handles MSE browsers. Worker execution is disabled, buffer budgets are bounded, instances are destroyed on leaving playback. CSP adds only same-origin/blob media sources required by MSE. It does not permit external playback or scripts.

Actual media-element positions and pause/seek state drive start/progress/stop reporting. Reports may update the connector identity's Jellyfin watch history. On stop, expiry, logout, source removal or shutdown, OpenFlix revokes the grant and cancels transport. It attempts both the session stop report (if started) and DELETE ActiveEncodings with **both** deviceId and PlaySessionId. Cleanup is best-effort during network failure; it never stops unrelated/global encoders. No login is created per segment. Encrypted saved connector credentials and audited private SQLite storage remain unchanged.

## Reproduction and independent audit

Run the commands in `docs/milestone-4-r1-verification.md`. Generated fixtures and encoding workers exist only inside disposable verification images/volumes. No fixture media files are committed or included in the source review ZIP.

Optimus must independently test household MKV metadata, actual direct/remux/audio/video conversion decisions, CPU throughput, seeking, trusted HTTPS and browsers including Safari/iPhone if available. Household playback reporting requires explicit operator consent and an authorized test identity; do not modify libraries/media/users/configuration to make a test pass. Restricted library visibility remains user-scoped, but per-user OpenFlix→Jellyfin mapping is still deferred. OpenFlix catalog metadata is shared among authenticated users; playback remains admin-only.

## Container backend discovery

The production Nginx 1.30.5 proxy uses a shared upstream with runtime `resolve` and Docker's embedded resolver at 127.0.0.11 (two-second validity, three-second resolution deadline). This avoids fatal config-load DNS resolution during backend recreation and permits safe recovery when the service address changes. Only the fixed Compose `server` service is resolved; browser input cannot select the upstream. TLS, credentials, request limits, buffering and container privileges are unchanged. See the official [Nginx upstream documentation](https://nginx.org/en/docs/http/ngx_http_upstream_module.html). The Docker regression explicitly tests startup without the backend DNS name and recovery after recreating it.
