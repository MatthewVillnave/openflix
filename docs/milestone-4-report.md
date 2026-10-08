# OpenFlix Milestone 4 builder report

## Status

**READY FOR INTEGRATION AUDIT** after builder verification. This is not independently audited real-Jellyfin M4 acceptance. Frozen-copy reproduction and exact final-commit GitHub CI results are recorded in the detached verification record beside the review ZIP. No M4 merge, audited tag or Milestone 5 work is included.

## Published audited Milestone 3

Main and annotated tag `openflix-v0.3-m3` point to `411c2527c164115a639b3aebc72de691eec3613e`. The public [Persistent Media Catalog release](https://github.com/MatthewVillnave/openflix/releases/tag/openflix-v0.3-m3) carries the original `openflix-milestone3-review-r1.zip` and detached checksum. Its ZIP digest remains `8bf72b5f7f71d9e036ef7b752ca4fbc4a413a531cd118d77b07479e7f59e4c51`. M1/M2 tags and M3 development history were preserved without rewriting or force-pushing. M4 develops only on `feat/milestone-4-playback` from that audited baseline.

## Implemented

- Native movie/episode video and audio playback through authenticated same-origin OpenFlix media routes, with actual generated-media decoding verified in Chromium.
- Backend-neutral planning, bounded ephemeral grants, direct binary streaming/backpressure, GET/HEAD/single byte range and checked 200/206/416 semantics, cancellation and expiry.
- Admin-only playback independent of shared catalog visibility, original-login/user/item/source binding, per-request authorization, exact-Origin mutation protection, bounded grants/streams and rate limits.
- Jellyfin SDK PlaybackInfo and official start/progress/stop reporting; no fabricated progress, password re-entry or new upstream login per playback operation.
- Safe native controls, loading/error states, pause/resume/seek, return/navigation cleanup and responsive layout. Player sources are exclusively allowlisted OpenFlix routes.
- Explicit unsupported-format behavior; no HLS, transcoding, subtitle/track selection or universal-codec claim.

## API and architecture decisions

Official Jellyfin SDK 1.0.0 remains pinned. Playback operations were compared with official 10.11.11 and current 12.2.0 schemas, exact revisions/hashes recorded in [the API baseline](milestone-4-api-baseline.md). Official 10.11.11 controllers corroborate static range transport and PlaybackInfo request semantics. These are operation-specific inspections, not complete SDK compatibility certification.

The anticipated connector playback contracts were evolved into server-only normalized source plans and Readable binary responses. Jellyfin DTOs, source validation, endpoint construction and upstream authorization remain inside its connector package. Node HTTP(S) supplies binary streaming; SDK JSON limits/timeouts remain intact for metadata/reporting. No database schema change or dependency/lockfile change was required. The entire audited database package is unchanged.

The smallest complete path is conservative direct playback: MP4 H.264/AAC, WebM VP8/Opus, MP3 and WAV PCM, subject to browser and source constraints documented in [playback](playback.md). HLS/transcoding fallback is explicitly deferred. This is the principal narrowed scope decision; incompatible formats return 415 instead of pretending to play. No separate OpenFlix transcoder exists.

## Security

Only OpenFlix admins can play through configured connectors; ordinary users remain denied. There is no automatic promotion of metadata visibility to media access and no per-user Jellyfin mapping. All grants require the original live login, are bounded to one catalog item/source and expire after four hours absolutely or five minutes without accepted reports. Restart loses grants safely; saved credentials remain encrypted and enable a new grant.

Permanent credentials, encrypted envelopes, upstream URLs and filesystem paths never enter playback responses. Static endpoint construction rejects arbitrary origins/paths, redirects and incompatible content types. Known source IDs originate from validated server metadata. Request-body limits and audited storage/authentication/connector restrictions remain unchanged. No whole-file buffering or persistent media caching is introduced. Production Nginx disables buffering and gzip for media only.

Start/progress/stop may affect Jellyfin watch progress/history. Real integration requires explicit operator approval and an authorized identity. Builder verification did not contact or modify the household server.

## Test results

- `pnpm check`: **254/254 tests, 22 suites**, production builds, source/test type checks and formatting passed.
- Targeted playback command in [verification](milestone-4-verification.md): **60/60 tests, 3 suites**.
- Explicit prior-milestone storage, credential, connector and catalog regression command: **64/64 tests, 6 suites**; all remaining M1/M2/M3 tests also pass in the full suite.
- `node scripts/verify-m3-upgrade.mjs`: actual database created with source extracted from audited M3 opens in M4; users, active login, encrypted secret, stable catalog IDs, all three migration records and SQLite integrity preserved. No network server required.
- Production and complete `pnpm audit --json`: **zero known vulnerabilities**, 132 production / 292 total dependency entries, at verification time. No dependency changes.
- JavaScript syntax and Git whitespace checks passed.

New tests exercise playable/non-playable objects, missing source/item, upstream failure, strict codec/source metadata, empty/unsafe sources, normalized projections, login/admin/origin/source binding, arbitrary URL/path/query denial, GET/HEAD/ranges/416, wrong ranges, redirects/content-type confusion, actual lifecycle reports, report failure, expiry/restart, grant/socket/concurrent-planning limits, client cancellation/logout, browser capability/errors and cleanup. M3 Folder-neutral classification, null-CollectionType TV, restricted views, atomic publication, failed-scan preservation, stable IDs and removal/recovery remain covered.

## Docker and real fixture media

`pnpm verify:docker`: **24/24 groups** passed, including full **254-test Linux suite**. Production and development images, empty-volume migrations, storage repair, unrelated-UID access denial, non-root/no-capabilities/read-only deployment, catalog resync/failure preservation, connector removal/revocation and secret-safe logs all passed. Clean stop/start and complete container recreation preserve durable data and invalidate ephemeral playback grants; new playback works without another Jellyfin authentication.

Trusted-HTTPS Chromium **154.0.8037.92** decoded generated MP4 H.264/AAC movie, WebM VP8/Opus episode and WAV PCM audio through OpenFlix. Tests measured advancing playback time, pause stability, seeking to seven seconds, resumed progress and mobile viewport fit. OpenFlix requests remained same-origin; logout denied subsequent access. This is actual fixture-media playback, not just HTTP 200, but is not a real Jellyfin or iPhone claim.

A separate 4 GiB virtual stream delivered at least 16 MiB before cancellation; upstream generation remained below 128 MiB and sampled server RSS growth stayed below the 96 MiB sanity bound (0 bytes above its baseline in the initial completed run). This is a bounded-resource sanity check, not a load benchmark. Generated fixture media stays in disposable images and is absent from source and review ZIPs.

Resolved verification-only issues included an existing `/media` image directory, quoting in the RSS probe, and expected stream-cancellation handling in that probe. A new test-helper typing error was corrected. None required weakening production permissions, authentication, TLS or limits. The complete checks were rerun afterward.

## Files and handoff

Primary additions are `apps/server/src/playback.ts`, `apps/web/src/Player.tsx`, `packages/connector-jellyfin/src/playback.ts`, four playback fixture/test files, `docker/generate-media.sh`, `scripts/verify-m3-upgrade.mjs`, playback/API/security/verification/integration documentation and this report. Existing normalized contracts, catalog UI, Nginx, Docker fixture/browser verifier, CI and full verification script were extended. The review archive includes an exact changed-file inventory and per-source SHA-256 list.

## Known limitations / Optimus audit

HLS/transcoding, subtitles, alternate audio selection, HDR/HEVC/MKV/surround formats, adaptive streaming and full watch-history persistence are absent. Playback is admin-only and single-process; grants do not survive restart. Cleanup/report delivery is best effort during upstream failure; already-buffered bytes cannot be recalled. Native Windows file-backed storage still fails closed; use Linux containers. Outer TLS/proxy and load/abuse protection remain operator responsibilities.

M3 catalog offset pagination is not a transactional snapshot, music containing playlists can legitimately be mixed, and metadata remains shared among authenticated users. M3 restricted library visibility was independently proven; real M4 playback under a restricted identity still needs audit. Safari and real iPhone playback have not been verified by builder Chromium tests.

Optimus must follow [M4 integration instructions](milestone-4-integration.md): approved real Jellyfin 10.11.11 identity/media, actual codec/device results, seeking/ranges, trusted HTTPS, saved-token reconnect, authorization, reporting/watch-state effects, cancellation, revocation, restart and secret-safe logs. Do not alter household configuration/media/account permissions. Do not claim HLS support or independently audited M4 PASS from fixture results.
