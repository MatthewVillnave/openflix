# Licensed M5 release integration verification

This record covers release integration after Optimus's accepted implementation `e08d799de9accf84b50ab4d9334b5dc4b6d712ce`. It does not extend the independent household verdict. The final release-provenance asset supplies exact final commit, source ZIP checksum, changed-file inventory, extraction results and CI links without embedding a file's own final commit/hash into itself.

## Authorized post-audit delta

- Preserve PR #1 documentation ancestry and reconcile current README/API/architecture/status with [M5 acceptance](milestone-5-audit-acceptance.md). Historical reports, original specification and frozen verification records retain their original verdicts.
- Add unmodified AGPLv3 LICENSE, version-3-only NOTICE, contribution guidance, upstream license texts and an installed-package notice inventory. All eight private first-party package manifests declare `AGPL-3.0-only`; dependency/runtime versions and lockfile are unchanged.
- Add `LegalNotice.tsx` in the existing footer. `scripts/legal-assets.ts` and Vite generate three fixed public legal text assets and validate an explicit public HTTPS source offer. Unknown builds are labeled unconfigured, not silently linked to upstream as exact source. Four focused tests cover this behavior.
- Docker changes only forward the public source build argument and retain legal documents in the server image. No registry images/binaries are published.

Playback, grouping, authentication, connector/network policy, database implementation/migration SQL, existing tests/fixtures, and CI are byte-identical to accepted M5. The sole existing application-file change is the footer import/render in `App.tsx`; the player and source-selection code are unchanged. These legal/interface additions received new verification, not retroactive Optimus acceptance.

## Newly executed local verification

Node 24.19.0, pnpm 11.19.0, private runtime-owned temporary storage beneath trusted `/private/tmp`; heavy commands executed sequentially. No household server was contacted.

| Command                                             | Result                                                                                                                                     |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm install --frozen-lockfile`                    | Passed                                                                                                                                     |
| `pnpm check`                                        | 393/393 tests across 29 files; formatting, builds and strict types passed                                                                  |
| `pnpm exec vitest run tests/legal-notices.test.tsx` | 4/4                                                                                                                                        |
| Focused command below                               | 198/198                                                                                                                                    |
| Prior regression command below                      | 95/95                                                                                                                                      |
| `node scripts/verify-m4-upgrade.mjs`                | Passed; actual accepted-M4 history, original users/sessions/encryption/source IDs/migration ledger retained                                |
| `pnpm audit --prod --audit-level=high`              | No known vulnerabilities                                                                                                                   |
| `pnpm audit --audit-level=high`                     | No known vulnerabilities                                                                                                                   |
| `node scripts/verify-docker.mjs`                    | 25/25 groups; 393/393 Linux tests; 4 GiB stream check reported 0-byte RSS growth                                                           |
| `node scripts/verify-jellyfin-hls.mjs`              | 6/6 real disposable Jellyfin groups                                                                                                        |
| `node scripts/verify-multiple-jellyfin.mjs`         | 6/6 real independent two-Jellyfin groups; actual Chromium decoding/progression/pause/seek/reporting, startup fallback and source isolation |

```sh
pnpm exec vitest run tests/works.test.ts tests/source-selection.test.ts tests/unified-web.test.tsx tests/playback-cancellation.test.ts tests/playback-http.test.ts tests/playback-connector.test.ts tests/playback-hls.test.ts tests/playback-diagnostics.test.ts tests/player-web.test.tsx tests/legal-notices.test.tsx
pnpm exec vitest run tests/database-storage.test.ts tests/database-permissions.test.ts tests/auth.test.ts tests/connector-credentials.test.ts tests/catalog-sync.test.ts tests/catalog-http.test.ts tests/catalog-connector.test.ts
```

All local application verification above passed on the first execution in this integration. The four source-notice tests were first exercised separately before the full suite. No assertions, delays, retry counts or previous tests were changed. The historical independent 193/194 HLS-attach failure remains recorded in acceptance and issue #2; it is not erased by these passing runs.

Single-Jellyfin FFmpeg evidence distinguished video/audio copy, video copy with audio conversion, and video conversion with audio copy. Two-server process memory was approximately 63 MiB during short generated clips, not a sustained hardware benchmark. Existing verifiers checked secret-safe logs, credential isolation, login binding and restart/recreation. No claim is made about household performance or watch-progress persistence.

GNU/SDK/HLS license texts were compared byte-for-byte with original upstream texts. Changed Markdown was rendered using GitHub GFM and relative links/heading anchors checked; future release links are verified at publication. `git diff --check` passed. Source-offer builds and final archive extraction/CI are recorded in the detached provenance once executed. Upgrade checks require a Git checkout with history, not an extracted source ZIP.

## Remaining follow-ups

See [independent acceptance limits and issues](milestone-5-audit-acceptance.md#follow-ups). Source availability is an operator/distributor responsibility for the actual deployment; an upstream URL is not exact source for a fork. The license inventory is not a legal certification. This release starts no federation or next feature milestone.
