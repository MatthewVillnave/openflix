# Milestone 4 builder verification

Use Node 24.19.0, pnpm 11.19.0, Docker Compose and trusted/private TMPDIR with safe ancestors ([R2 prerequisite](verification.md#audited-r2-host-tmpdir-prerequisite)). Permit loopback sockets and Docker source mounts. Keep ports 8080/5173 free. No household Jellyfin access or credentials are needed.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm exec vitest run tests/playback-connector.test.ts tests/playback-http.test.ts tests/player-web.test.tsx
pnpm exec vitest run tests/database-permissions.test.ts tests/database-storage.test.ts tests/catalog-classification.test.ts tests/catalog-sync.test.ts tests/connectors-http.test.ts tests/connector-credentials.test.ts
pnpm audit --prod --json
pnpm audit --json
pnpm verify:docker
node scripts/verify-m3-upgrade.mjs  # source checkout with audited M3 Git object
git diff --check
```

Full check builds every package/application, checks strict source/test types, formatting and all M1–M4 tests. Docker verification retains all prior groups, storage/privilege checks, migration ledger, catalog failure preservation, stable identity and restart/recreation tests. It adds generated MP4/H.264/AAC, WebM/VP8/Opus and WAV/PCM files built by `docker/generate-media.sh` using FFmpeg test patterns and tones. Generated media exists only in the disposable fixture image, not source or review archives. No household or downloaded media is used.

Trusted-HTTPS Chromium checks perform login, connector setup, catalog sync and native movie/episode/audio decoding. They assert decoded dimensions/duration, advancing currentTime, actual pause, seek to seven seconds and resumed progress. They inspect safe plans and same-origin requests, exercise a mobile viewport and logout denial. Desktop Chromium is not Safari or real iPhone certification.

A separate virtual 4 GiB fixture verifies production transport without allocating a 4 GiB buffer: consume at least 16 MiB, sample server RSS, require growth below 96 MiB, abort and assert upstream generation stopped below 128 MiB. This is a resource sanity check, not a production load benchmark. Byte-range checks assert GET/HEAD/206/416 and exact lengths. Restart/recreation must invalidate old grants while preserving catalog, accounts, login sessions, encrypted credentials and successful new playback planning without reauthentication.

M3 → M4 requires no schema migration: migration SQL and the entire database package remain unchanged from the audited M3 tag. Existing-file startup/restart tests retain data and the three-entry migration ledger; release verification additionally opens an actual database created using the audited M3 package before starting M4. Preserve a stopped private backup for operational upgrades. Old ephemeral playback sessions do not exist at M3 and are never persisted by M4.

For the frozen review archive, validate its detached SHA-256, extract to a new private directory with trusted ancestors, run `shasum -a 256 -c SOURCE-FILES.sha256`, install with `--frozen-lockfile` and repeat check, targeted tests, both audits and Docker verification. The archive has no Git directory; omit Git-only commands there. `CHANGED-FILES.txt` compares committed source with audited M3. Post-extraction evidence is stored beside the frozen ZIP rather than changing its contents. Then follow [Optimus integration](milestone-4-integration.md).
