# OpenFlix Milestone 2 builder report

## GITHUB PUBLICATION

Milestone 1 was published before M2 development at https://github.com/MatthewVillnave/openflix, public, primary branch `main` at audited commit `87009bbb43aea3d6476c266fc4a9a0442f4c31fd`. Tags `openflix-v0.1-m1`, `openflix-v0.1-m1-r1` and `openflix-v0.1-m1-r2` were pushed with their original targets/history. No rewrite, force-push, amend or retag occurred.

Release: [OpenFlix Milestone 1 — Audited Foundation](https://github.com/MatthewVillnave/openflix/releases/tag/openflix-v0.1-m1-r2), public, not draft/prerelease. GitHub's ZIP asset digest matches `ef170f9f3b67af34c732d3c20a262c4ee6fdf9bb4f8ce5fef523567ad83f616f`. The real frozen R2 ZIP and detached checksum are release assets, not repository files.

M2 branch: `feat/milestone-2-jellyfin`, created from audited R2. First commit `4aad372` documents the safe host TMPDIR prerequisite without changing the audited tag. M2 is not merged into main or tagged as an audited release.

## STATUS

**READY FOR INTEGRATION AUDIT.** The complete builder host and Docker checks passed on 2026-10-05. No real Jellyfin integration acceptance is claimed. The detached review verification record records fresh-extraction results against the final frozen archive.

## MILESTONE 2 IMPLEMENTED

Official-SDK Jellyfin authentication, bounded reachability/server identity, user-scoped library enumeration, reusable encrypted connector credential, admin-only add/list/reconnect/test/disconnect/remove API and functional Settings → Media Servers UI. Normalized errors and DTOs; all Jellyfin-specific structures remain inside the connector package. Saved connections become unverified at restart and can reconnect without a password. Removal reports confirmed/unconfirmed upstream revocation honestly.

Catalog, playback, search, artwork, profiles, watch history, federation and discovery remain unimplemented. Later interface methods explicitly fail without network activity.

## JELLYFIN API/SDK BASELINE

Installed `@jellyfin/sdk` **1.0.0**, revision `1fdc2aefcf963fec84e7eafe15743dafe8c1d26a`, matching API **12.0.0**. Current inspected upstream revision `1ef06252cef5d1729646331e64059e230f11a08b` has API **12.1.0** (OpenAPI 3.0.4). Also compared SDK **0.13.0**, revision `94695753de92d3777f8b7f07960d0b7b145fa67e`, API **10.11.1**. Schema hashes, official sources and exact operations are in [the baseline](jellyfin-preparation.md). Axios **1.20.0** provides the isolated bounded transport.

SDK 1.0.0 officially targets 12.x. The inspected subset is also fixture-tested for 10.11.1; this provisional wire compatibility does not certify SDK-wide or real-server 10.11 behavior. Optimus must compare the actual server API/version.

## CREDENTIAL SECURITY

Node AES-256-GCM, external 32-byte random base64 master key, random 12-byte nonce, 16-byte tag, version/key ID and authenticated context binding to connector ID/type/base URL. No passwords persisted; ciphertext never returned to browsers. Wrong/missing keys for saved credentials and tampering fail startup before networking. No defaults or bypass. Key-loss, backup and future rotation behavior are documented in [connector security](connector-security.md).

## DATABASE / MIGRATIONS

Migration 2 adds only `media_connectors`: identity/type/display name/base URL, normalized server/library metadata, status/check timestamp and encrypted envelope. Original migration 1 and R2 storage implementation remain unchanged. Migration tests preserve existing accounts and sessions. No catalog/item/playback tables are added.

## TEST RESULTS

- `pnpm check`: **130/130 tests across 14 suites**, production builds, strict source/test types and formatting passed on macOS; rerun after the final verifier correction also passed.
- Targeted command in [verification instructions](milestone-2-verification.md): **82/82 tests across seven suites** passed, covering connector, encryption, admin UI/API, migrations and the R2 storage boundary.
- `pnpm audit --prod --json` and `pnpm audit --json`: **zero known vulnerabilities**, 132 production / 292 total dependencies reported.
- `node --check` for all three Docker/verification scripts and `git diff --check`: passed.
- Original R2 `packages/database/src/storage.ts` and migration 1 SQL were compared byte-for-byte with the audited tag and remain unchanged.

The exact frozen commit, source inventory, ZIP checksum and fresh-extraction checks are recorded in the review manifest and detached `REVIEW-VERIFICATION.md`. Tests use disposable credentials and contract fixtures; no real server was contacted.

## DOCKER RESULTS

`pnpm verify:docker`: **17/17 verification groups passed**, including the complete **130-test Linux suite**, production/development image builds, fresh migrations, health/frontend, real trusted-HTTPS Chromium administration, encrypted credentials, unchanged R2 private-directory/sidecar and unrelated-UID checks, restart/clean shutdown/full stack recreation, saved-token reconnect without reauthentication, removal/revocation, safe logs and non-root/capability/read-only isolation. Disposable test projects and volumes were removed by the verifier.

A preliminary run found that terminal color codes prevented the verifier from parsing Vitest's passing Linux summary. The verifier now strips terminal control codes and requires at least 130 passing tests; the complete rerun passed. An earlier formatting snapshot failure was resolved before the stable-source run. Neither issue required weakening application or container security. The verification-only Jellyfin fixture is absent from ordinary production Compose.

## FILES CHANGED

Connector-core/shared/protocol contracts; real `packages/connector-jellyfin/src/index.ts`; database migration/repository; server credential store/config/admin routes; web API/MediaServers component; deterministic connector/crypto/API/UI tests; Docker fixture/verification; lockfile and connector/server dependencies; configuration/security/baseline/integration documentation. Full final changed-file inventory accompanies the frozen review package.

## ARCHITECTURE DECISIONS

Preserve the independent OpenFlix model and existing prepared-SQL/monorepo structure. Use current SDK helpers with a scoped Axios instance rather than discovery or raw legacy endpoint assumptions. Add a managed extension to MediaConnector for server info/disconnect. Explicit reconnect refreshes startup's unverified state. A single in-flight mutation and ten-record cap bound operator work. Library metadata is private to admins; no source aggregation or sharing policy exists.

## SECURITY NOTES

Admin-trusted HTTP(S)/LAN destinations, strict URL parsing, no embedded credentials/query/fragment, no redirects or ambient proxy forwarding, normal TLS validation, bounded body/time limits, fixed error vocabulary and secret-safe logging. Existing authentication/session/Origin/request limits remain intact. All R2 storage checks remain active. JavaScript string copies cannot be reliably zeroized; mutable buffers are cleared and secrets are not persisted/logged except as authenticated ciphertext.

## DEVIATIONS FROM SPEC

No architectural redesign. Matching API/schema artifacts were read from the official SDK repository because the API explorer returned 403. Explicit `.js` SDK entrypoints handle NodeNext declarations. `GetUserViews` is used instead of administrative media-folder enumeration. Missing master key permits foundations only when there are no saved connectors; saved credentials fail closed. Automatic background reconnect and automated rotation remain deferred; manual saved-token reconnect is implemented.

## KNOWN LIMITATIONS

No real server was contacted. Provisional 10.11 subset compatibility needs independent verification. Native Windows disk storage remains unsupported/fail-closed; use Linux containers. POSIX/ACL and same-UID/root threat assumptions from R2 remain. HTTP LAN connections expose credentials to network observers; prefer HTTPS. Operators trust configured origin/DNS and must provision/retain the master key separately. A remote token may require manual revocation after offline removal or abrupt setup interruption. Last-known server metadata is not a live status claim. Public TLS/DNS/proxy deployment and other architectures are not certified by local fixtures.

## INTEGRATION TESTS OPTIMUS MUST PERFORM

Follow [the independent integration checklist](milestone-2-integration.md): actual version/schema, restricted-user library visibility, trusted HTTPS/base path, real SDK authentication and saved-token reconnect, session-scoped revocation, restart/container recreation, secret/log/storage inspection, and tamper/wrong-key checks on isolated copies. Do not change production libraries/configuration/plugins/media. Do not begin Milestone 3.

## REVIEW IDENTITY

The final frozen review ZIP manifest and detached checksum/extraction record identify the exact M2 commit and archive SHA-256 without a self-referential hash in this source report. No M2 audited tag or release is created.
