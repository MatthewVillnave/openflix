# Milestone 4 R2 remediation and re-audit

Status: **PARTIAL**. The household movie HLS 502 remains **UNRESOLVED** pending a sanitized first-failure trace. Disposable success does not establish household acceptance. No M5, accepted M4 tag, release or main merge is included.

## Preserved identity and separate findings

R1 is `f5ac1dfc95f3e64c517e68ff1c58baf637d5860c`; its ZIP SHA-256 is `1937c7b3974f8481353f6e2af564236e2a247422d056e990cb60e831ba7d1e71`. Original M4 and all audited tags/artifacts remain unchanged. R2 develops on `fix/milestone-4-compat-r2`.

1. Confirmed R1 defect: positive dimensions were required on every parsed stream, including subtitles. The committed reproduction failed on unchanged R1 with `invalid_response`.
2. Household HLS failure: entry succeeded, later resource failed with 502. No sanitized trace is available to identify the first failing resource or upstream response. This is not diagnosed by finding 1.
3. Conversion candidates: missing runtime and independently reported unreadability under Jellyfin's service account. Neither finding proves a conversion defect. OpenFlix cannot establish filesystem readability from metadata alone.

## Exact contract and parser policy

Consulted official [10.11.11 OpenAPI](https://api.jellyfin.org/openapi/jellyfin-openapi-10.11.11.json), [MediaStream.cs](https://github.com/jellyfin/jellyfin/blob/v10.11.11/MediaBrowser.Model/Entities/MediaStream.cs), [MediaSourceInfo.cs](https://github.com/jellyfin/jellyfin/blob/v10.11.11/MediaBrowser.Model/Dto/MediaSourceInfo.cs), [DynamicHlsController.cs](https://github.com/jellyfin/jellyfin/blob/v10.11.11/Jellyfin.Api/Controllers/DynamicHlsController.cs), and [DynamicHlsPlaylistGenerator.cs](https://github.com/jellyfin/jellyfin/blob/v10.11.11/src/Jellyfin.MediaEncoding.Hls/Playlist/DynamicHlsPlaylistGenerator.cs). OpenAPI SHA-256: `e29fc369ecae54676caeb50cbbc006b5c4ee959906c00f1e02f6f83db9c227fb`. SDK remains 1.0.0; the exact SDK/newer API revisions remain recorded in the R1 API baseline. No SDK/server upgrade or new endpoint is needed.

The upstream Width/Height/Channels/BitDepth/BitRate/SampleRate fields are nullable integers; frame rates are nullable numbers. They are not universally positive and the schema has no required array for MediaStream. RunTimeTicks is nullable int64, not a guaranteed field. OpenFlix still imposes bounded counts, strings and numbers, required source/stream identity, and no numeric-string coercion.

Common stream parsing now accepts bounded nonnegative optional/null dimensions, channels and frame rates. Selected video still needs positive width/height within the existing resolution policy; present frame rates must be positive and within the chosen policy. Both average and real frame rates are checked. Selected embedded audio retains codec/channel checks. Subtitle/data/unknown streams are never selected for playback; their paths and URLs are discarded, never fetched. No subtitle support was added.

Zero selected dimensions or frame rate now produce `unsupported` rather than malformed-response errors. Two existing assertions were updated for that classification; negative and excessive values still fail parsing. All existing test cases remain. Unknown/unused metadata cannot substitute for valid selected audio/video.

Null, missing or zero runtime is structurally parseable but not sufficient for planning. No catalog fallback, invented duration, infinity or playback report is emitted. The sanitized failure is `unsupported`, with internal reason `insufficient_runtime` when all returned sources lack valid runtime. A bounded positive duration is necessary, not proof that Jellyfin can read/serve the source. Runtime values with wrong types, fractions, negatives or excessive magnitudes remain invalid responses.

## Separate movie-length limit reproduction

10.11.11 repeats the playback query in every media-segment reference, followed by runtimeTicks and actualSegmentLengthTicks. Sanitized 120- and 240-minute, six-second-segment fixtures both failed R1's 128 KiB input cap before the adjustment. The four-hour fixture also requires more than 4096 text lines and 128 KiB of rewritten opaque paths.

R2 uses independently bounded 4 MiB input, 512 KiB rewritten output and 8192 lines. Existing 8 KiB URL/line, 4096 resource, 16 playlist, depth-two, four-hour source and concurrency/deadline bounds remain. Oversized input still fails closed; the old huge-line rejection remains as a separate case. No query/tag/origin policy was relaxed. These bounds accommodate the measured movie fixtures, not arbitrary source sizes. Extremely verbose upstream queries or excessive segment counts remain unsupported.

This confirmed synthetic limit issue is **not claimed as the household HLS root cause**. The household first-failure trace must establish whether it encountered this limit or a different condition.

## Safe internal diagnostics

The server records a closed-vocabulary `diagnostic` on playback failures: stage, reason, resourceKind, optional numeric upstreamStatus, allowlisted upstreamContentType, and allowlisted manifestTag. MIME parameters and unknown MIME/tag strings are not retained. Errors are reconstructed from the allowlist, including errors crossing package instances. Browser errors remain fixed messages/codes, without diagnostic payloads.

Stages distinguish planning, grant/resource lookup, upstream headers/body, manifest parsing, reference validation and resource bounds. Examples: upstream status 500 is logged as 500 even if OpenFlix returns 502; a rejected key directive in an upstream 200 playlist is manifest_parse/unsupported_directive with EXT-X-KEY. Stream errors after headers are logged with bounded codes; no raw Error object/body is logged.

Do not enable raw request/response dumps. Never publish raw URLs, query strings, headers, credentials, paths, private manifests or household inventories. Diagnostics identify a class of failure, not source readability or successful decoding. Resource kind describes the expected endpoint (master entry, media playlist, segment/init), not proof of the received document's contents.

## Focused Optimus handoff

- Verify frozen R2 source/checksum and preserve R1 separately.
- Stay within the previously authorized account/content/reporting scope. Ask the operator if that scope must expand; Jellyfin reports may alter watch history.
- Before choosing conversion candidates, establish readability of the **selected source** in Jellyfin's actual service/container context. An Optimus shell read is insufficient. Use existing readable alternatives; do not change permissions, accounts, media, configuration or acceleration settings.
- Retest the original subtitle-dimension case. Confirm valid AV planning, then actual decode/time advancement. Subtitles remain intentionally unused.
- Diagnose the original movie's first failing HLS request: browser response status, expected resource kind, OpenFlix processing stage/reason, upstream status/MIME when present, and relevant allowlisted manifest tag/structural condition. Share only these safe fields. If no upstream status exists, report that rather than guessing. Distinguish body-size/line/output/resource limits from encoding/file-access failures.
- If the safe diagnostic cannot explain the failure, produce a minimal synthetic/redacted contract fixture privately reviewed for secrets; never publish a raw household response. Do not assume the new movie-length limit proves causation.
- With readable candidates, verify actual remux/video-copy, audio conversion and video conversion using scoped upstream evidence. Do not claim a path merely because a plan or manifest succeeded.
- Verify sustained decoding, pause/resume, seek, actual reporting positions/methods, original-login/admin isolation, logout/expiry, connector removal, scoped cleanup and restart.
- Measure household performance only after sustained playback succeeds. Do not change hardware acceleration. Unavailable Safari/iPhone or codec cases remain explicitly untested.

## Reproduction

Use prerequisites/private temporary storage in the R1 verification guide. Run heavy suites sequentially. Add the diagnostic suite to the playback command:

```sh
pnpm install --frozen-lockfile
verification_tmp=$(mktemp -d /private/tmp/openflix-r2.XXXXXX)
TMPDIR="$verification_tmp" pnpm check
TMPDIR="$verification_tmp" pnpm exec vitest run tests/playback-connector.test.ts tests/playback-hls.test.ts tests/playback-http.test.ts tests/playback-diagnostics.test.ts tests/player-web.test.tsx
TMPDIR="$verification_tmp" pnpm exec vitest run tests/database-storage.test.ts tests/database-permissions.test.ts tests/auth.test.ts tests/connector-credentials.test.ts tests/catalog-sync.test.ts tests/catalog-http.test.ts tests/catalog-connector.test.ts
pnpm audit --prod --audit-level=high
pnpm audit --audit-level=high
TMPDIR="$verification_tmp" node scripts/verify-m3-upgrade.mjs
node scripts/verify-docker.mjs
node scripts/verify-jellyfin-hls.mjs
```

Use a trusted runtime-owned temp ancestor on Linux. The upgrade script requires Git history and must run in a checkout of the exact reviewed commit; source archives intentionally omit .git. All other checks reproduce from extraction.

The real disposable verifier retains four generated sources and adds an H264/AAC/SRT MKV. It checks actual nullable/zero subtitle metadata (exact zero is separately covered by the contract fixture), browser decode/time progression, pause/seek, copy/conversion evidence and auth/cleanup/restart. All five sources are generated inside disposable images, not archived media. No household server URL is accepted.

No database migration, player redesign, authorization change, new transcoder, subtitle fetching, or household action is included. Historical M1–M4 reports describe their original states and are not rewritten.
