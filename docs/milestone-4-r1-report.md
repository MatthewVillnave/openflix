# Milestone 4 R1 builder report

Status: **READY FOR RE-AUDIT**, conditional on the exact-commit CI and frozen-extraction results recorded in the detached archive verification record. This is not household compatibility acceptance. No M5 work, main merge, audited M4 tag or release was performed.

Original M4 commit: `2d34ac9a4534ccd98fef93a2e8d0d3bcc708e126`. Original archive SHA-256: `6b497ab96d4cc305e850122e691441d92dcee372f5875401d10917275182b232`. Both remain unchanged. R1 source identity is recorded in the review manifest and detached checksum rather than a circular self-referencing source commit.

## Implemented

Preserved direct MP4/WebM/MP3/WAV playback. Added connector-contained Jellyfin playback profiles and normalized direct/remux/transcode plans; authenticated opaque HLS manifest, playlist, initialization and segment mappings; bounded backpressured binary transport; original-login/admin grant checks on every request; actual method-aware reporting and scoped encoding cleanup. Native Apple HLS and pinned HLS.js 1.7.3 share the existing React player. No database migration or OpenFlix transcoder was added.

The official Jellyfin 10.11.11 implementation/OpenAPI and unchanged TypeScript SDK 1.0.0 were inspected. Exact revisions, consumed endpoints and the newer API differences are in `milestone-4-r1-api-baseline.md`. Security limits and unsupported cases are in `milestone-4-r1-playback.md`.

## Verification

Commands and prerequisites are in `milestone-4-r1-verification.md`.

| Check                                                | Result                                                                                    |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Full `pnpm check`                                    | 302/302 tests, 23 suites; formatting, production builds and type checks pass              |
| Targeted HLS/playback/player                         | 108/108 tests, four suites                                                                |
| Explicit storage/auth/credential/catalog regressions | 94/94 tests, seven suites                                                                 |
| Historical Docker verifier                           | 24/24 groups, including Linux full check with 302 tests                                   |
| Real disposable Jellyfin verifier                    | 5/5 groups                                                                                |
| Production and complete dependency audits            | Both report no known vulnerabilities                                                      |
| Actual audited M3 → current startup                  | Users, login, encrypted credential, catalog IDs, migration ledger and integrity preserved |

Generated fixtures are 18-second 320×180 synthetic sources. Chromium 154.0.8037.92 decoded all four through OpenFlix over trusted disposable HTTPS; playback time advanced, pause/resume and seeking succeeded. Actual Jellyfin FFmpeg commands established:

| Generated source         | Actual output evidence                     |
| ------------------------ | ------------------------------------------ |
| H264/AAC MP4             | Existing direct playback retained          |
| H264/AAC MKV             | Video copy and audio copy (remux)          |
| H264/six-channel AC3 MKV | Video copy, stereo AAC conversion/downmix  |
| HEVC/AAC MKV             | Software H264 video conversion, audio copy |

Real-server startup, authentication, catalog discovery/sync, ordinary-user denial, logout and subsequent-login rejection, scoped cleanup with no remaining FFmpeg worker, restart/recreation, encrypted saved-token reconnect and connector revocation passed. Browser requests remained on OpenFlix with opaque resources and no credential queries. OpenFlix logs passed secret/error checks. All media and upstream reporting used a newly created disposable Jellyfin 10.11.11 server; no household server was contacted.

The virtual 4 GiB streaming regression received at least 16 MiB, observed zero RSS growth in this run, and cancelled upstream; its threshold remains 96 MiB. OpenFlix server memory in the real HLS run changed from 60.62 MiB to 75.71 MiB. This is a sanity check, not a production benchmark or a measurement of OptiPlex transcoding capacity.

An earlier Docker run failed strict parsing of a non-JSON log line. A private mode-0600 diagnostic capture was added without weakening assertions; the final complete run passed. The transient cause remains undetermined. Intermediate encoding-contract differences (GUID representation, AAC Level zero, input-codec parameters and libfdk_aac encoder naming) were resolved against official implementation and real fixture evidence, with regressions retained.

## Security and architecture

Jellyfin-specific URLs/DTOs remain inside the connector package. Credentials remain encrypted at rest and never returned to the browser. Runtime-owned private directory/database protections are unchanged. HLS references are parsed and validated against the configured connector/item/source/session before mapping; redirects, foreign origins, traversal, keys/DRM, unsupported tags/queries, oversized/recursive resources and unexpected content fail closed. Grants remain bounded, expiring, administrator-only and bound to the original OpenFlix login. Cleanup identifies both device and playback session, never global encoders. JSON limits, TLS verification, CSRF/Origin protection and production container isolation remain intact.

Changes are confined to playback contracts/transport/broker/player, HLS security tests, generated disposable Docker fixtures, verification/CI and documentation. The source archive's changed-file inventory is relative to original M4.

## Limitations and independent audit

Optimus must verify household MKV metadata and codec variants, actual remux/transcode decisions, CPU throughput, trusted HTTPS, seeking, Safari/iPhone, authorization boundaries, cancellation and upstream reporting with explicit operator approval. Fixture success does not certify household compatibility.

The initial HLS output is bounded H264/AAC MPEG-TS, progressive local SDR video, at most 1080p/30 fps. No universal 4K/HDR, live/disc/remote/DRM/subtitle/audio-track support is claimed. Audio HLS fallback is deferred; supported audio still plays directly. Encoding cleanup/reporting is best-effort on upstream/network failure and may change Jellyfin watch state. Admin-only playback, shared authenticated catalog metadata and no per-user upstream account mapping remain deliberate limitations. Native Windows file-backed storage fails closed; Linux containers remain the supported route. M5 is not included.
