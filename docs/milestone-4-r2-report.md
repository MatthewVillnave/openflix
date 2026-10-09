# Milestone 4 R2 builder report

## Status: PARTIAL

The confirmed subtitle-dimension defect is fixed and verified with actual disposable Jellyfin 10.11.11 playback. The separate household movie HLS 502 remains **UNRESOLVED** because no sanitized first-failure resource trace was available. A separately reproduced movie-length limit was fixed; it is not asserted to be the household cause. No M5, M4 acceptance, main merge, audit tag or release is included.

The frozen archive manifest records the exact R2 commit. Adjacent ARCHIVE-VERIFICATION.md records exact-final-commit CI and fresh-extraction checks without changing the frozen archive. See [remediation and focused re-audit checklist](milestone-4-r2-remediation.md) for commands, official contracts, limits and remaining gates.

## Confirmed defect and runtime handling

R1 required positive video dimensions in a schema shared by every stream. The reproduction committed before the fix failed with invalid_response on R1. R2 parses bounded non-video zero/null/missing values, then validates selected AV semantics. Selected video still requires positive bounded dimensions; selected audio retains positive channels and positive bit depth when present. Both reported video frame rates are checked against the policy. Unsupported stream types remain non-playable; no subtitle path/URL is used.

Missing/null/zero runtime is parseable but insufficient for playback planning. It produces a sanitized unsupported response and internal insufficient_runtime classification, with no invented duration or reports. Malformed numeric types, negative/excessive values and unsafe sources still fail. A valid duration is not proof of filesystem access.

## Separate HLS findings

Synthetic 120- and 240-minute media playlists matching the official 10.11.11 generator both reproduced the old 128 KiB limit. Input is now bounded at 4 MiB, rewritten output at 512 KiB and text at 8192 lines; existing resource counts, URL/line size, recursion, source-duration, timeout and concurrency bounds remain. Boundary tests retain oversize, resource-exhaustion and malformed-manifest rejection. No URL/query/directive acceptance policy was broadened.

Internal diagnostics now identify planning/lookup/transport/parser/reference/bound stages, a closed reason code, expected resource kind and safe status/MIME/tag fields. An upstream 500 and an upstream 200 with a rejected directive are distinguished even when both produce OpenFlix 502. Browser errors remain sanitized. Tests prove upstream error bodies, tokens, URL text and arbitrary diagnostic fields do not leak.

## Builder verification

| Check                                             | Result                                                                                           |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Full pnpm check                                   | 355/355 tests, 24 suites; production builds, formatting and types pass                           |
| Targeted playback/HLS/player/diagnostics          | 161/161, five suites                                                                             |
| Prior storage/auth/credential/catalog regressions | 94/94, seven suites                                                                              |
| Full Docker verifier                              | 25/25 groups, Linux full check 355 tests                                                         |
| Real disposable Jellyfin                          | Six verification groups; five generated sources                                                  |
| Production and full dependency audits             | Both report no known vulnerabilities                                                             |
| Audited M3 database upgrade                       | Users/login, encrypted credentials, stable catalog IDs, migration ledger and integrity preserved |

Relative to R1, 53 tests were added; none removed. Two prior zero-video-dimension/frame-rate assertions now expect unsupported planning rather than malformed parsing; negative/type/excessive bounds remain. The old huge-line regression remains, and the new input-cap regression exercises the revised finite cap. No database migration or schema change was introduced.

## Actual disposable playback

Official Jellyfin 10.11.11 returned Type Subtitle, Width 0, Height 0 for the generated SRT-bearing MKV. Chromium 154.0.8037.92 decoded all five generated 18-second 320×180 cases through OpenFlix HTTPS, with advancing time, pause/resume and seeking:

| Fixture          | Actual result                                                                 |
| ---------------- | ----------------------------------------------------------------------------- |
| H264/AAC MP4     | Direct play preserved                                                         |
| H264/AAC MKV     | Video/audio copy                                                              |
| H264/AAC/SRT MKV | Video/audio copy; subtitle metadata does not block playback; subtitles unused |
| H264/AC3 MKV     | Video copy, AAC conversion/downmix                                            |
| HEVC/AAC MKV     | Software H264 conversion, audio copy                                          |

Actual scoped FFmpeg commands established copy/conversion decisions. Ordinary-user denial, logout/new-login grant rejection, scoped cleanup with no remaining FFmpeg worker, encrypted reconnect after restart/recreation, revocation and secret-safe logs passed. No household server was contacted.

The disposable run measured OpenFlix server memory from 59.89 MiB to 83.51 MiB. The separate 4 GiB virtual stream test observed zero RSS growth in this run and upstream cancellation. These are bounded-resource sanity checks, not household transcoding performance measurements; the existing 96 MiB growth assertion was retained.

## Scope and remaining gates

Changes are confined to playback metadata validation, closed diagnostics, bounded HLS manifests, regression/disposable-fixture verification and documentation. Database permissions, encrypted credentials, TLS/redirect and configured-origin/base-path restrictions, item/source/session binding, original-login/admin authorization, CSRF, backpressure and cancellation remain intact. Player architecture and SDK version are unchanged.

Optimus must obtain the first failing household HLS resource's safe diagnostic fields and establish its cause before acceptance. Verify the selected source's readability inside Jellyfin's service/container context before conversion tests; do not modify permissions or configuration. Retest the original subtitle case and movie, actual sustained decode, remux/conversion evidence, pause/seek, reporting and scoped cleanup within previously authorized content/account scope. Measure performance only after playback succeeds. Unavailable browsers or codec cases remain untested.

Safari/iPhone and household compatibility are not claimed from Chromium/disposable results. Missing duration remains unsupported; no fallback proves unreadable media playable. Existing admin-only, bounded local SDR output, no subtitle rendering, no universal codecs/4K/HDR/live/remote/DRM, and no per-user upstream mapping limitations remain. Original M4/R1 source and archive hashes and historical M1–M3 tags were preserved.
