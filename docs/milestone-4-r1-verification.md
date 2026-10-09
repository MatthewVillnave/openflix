# Milestone 4 R1 reproduction

Use Node 24.19.x and pinned pnpm 11.19.0. Docker Desktop/Linux Docker Compose is required for actual Jellyfin integration. Native Windows file-backed storage remains unsupported; use Linux containers. Host temporary directories must satisfy the audited private-storage ancestor policy.

```sh
pnpm install --frozen-lockfile
verification_tmp=$(mktemp -d /private/tmp/openflix-r1.XXXXXX)
chmod 0700 "$verification_tmp"
TMPDIR="$verification_tmp" pnpm check
TMPDIR="$verification_tmp" pnpm exec vitest run tests/playback-hls.test.ts tests/playback-connector.test.ts tests/playback-http.test.ts tests/player-web.test.tsx
TMPDIR="$verification_tmp" pnpm exec vitest run tests/database-storage.test.ts tests/database-permissions.test.ts tests/auth.test.ts tests/connector-credentials.test.ts tests/catalog-sync.test.ts tests/catalog-http.test.ts tests/catalog-connector.test.ts
pnpm audit --prod --audit-level=high
pnpm audit --audit-level=high
node scripts/verify-m3-upgrade.mjs
node scripts/verify-docker.mjs
node scripts/verify-jellyfin-hls.mjs
```

On Linux use a runtime-owned private temporary directory beneath a trusted ancestor, normally the system temporary directory. The historical Docker verifier retains all 24 M1–M4 groups, including real generated direct media decoding and a 4 GiB virtual streaming resource/cancellation check. The new real-Jellyfin verifier builds a separate, uniquely named production/test stack and performs five additional verification groups. CI runs both scripts.

The actual Jellyfin suite uses pinned official 10.11.11, generated 18-second H264/AAC MP4, H264/AAC MKV, H264/six-channel AC3 MKV and HEVC/AAC MKV. The verifier initializes only its own disposable server, disables remote metadata fetchers, authenticates, discovers and synchronizes generated movies, and runs Chromium over trusted test HTTPS. It checks decode/currentTime progression, pause/resume and seeking through OpenFlix, expected playback modes, original-login/logout rejection, ordinary-user denial, scoped cleanup and actual Jellyfin FFmpeg copy/re-encode command evidence. No household URL is accepted by the script.

Images need Debian FFmpeg encoders libx264/libx265/AAC/AC3; generation runs at build time. The official Jellyfin image supplies its own jellyfin-ffmpeg. Software encoding uses a small 320×180 fixture; this does not benchmark OptiPlex throughput. Browser verification uses isolated non-root containers and an ephemeral local CA trusted only by that test browser. Production protections are not relaxed. The generated sources, Jellyfin databases, logs, keys and passwords are confined to disposable volumes/process state and removed by the verifier's finally block.

A Git checkout with audited M3 history is required for `verify-m3-upgrade.mjs`: it tests upgrade using the actual M3 source, not a recreated approximation. Source ZIPs exclude `.git`; run that one check in a checkout of the exact review commit. Other non-Docker checks and both Docker scripts must reproduce from a fresh extraction.

## Optimus checklist

- Verify original M4 and R1 archive/commit hashes separately; never replace the original artifact.
- Use an explicitly authorized test identity for reports that may alter Jellyfin watch history.
- Test real 10.11.11 household MKV stream metadata, H264/AAC remux, H264 plus AC3/EAC3/DTS conversion and HEVC video conversion where supported.
- Confirm actual Jellyfin copy/conversion choice and measure CPU/memory throughput without changing hardware acceleration/configuration.
- Verify direct media regression, trusted HTTPS, Chromium and real Safari/iPhone decode, pause/resume, seeking and buffering.
- Test admin-only/original-login binding for manifests and later segments, logout, expired grants, cross-user access, connector removal/revocation, restart and interrupted network cleanup.
- Confirm tokens/paths/credential envelopes do not reach browser responses, manifests or logs.
- Confirm only the intended playSessionId/deviceId is cleaned up, and unrelated Jellyfin sessions remain unaffected.
- Exercise restricted connector library visibility with an existing account if safely available. Do not modify real users or permissions for the audit.
- No M5 work, M4 main merge or audited M4 release is authorized until independent acceptance.
