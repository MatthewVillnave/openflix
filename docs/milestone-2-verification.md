# Milestone 2 builder verification

Run from the repository root with Node 24.19.0, pnpm 11.19.0, a trusted/private TMPDIR, loopback socket permission, registry access and Docker Compose. See the [host TMPDIR note](verification.md#audited-r2-host-tmpdir-prerequisite). No real Jellyfin credentials or server are needed. Keep loopback ports 8080 and 5173 free and allow Docker to read source mounts.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm exec vitest run tests/jellyfin.test.ts tests/connector-credentials.test.ts tests/connectors-http.test.ts tests/media-servers-web.test.tsx tests/database-permissions.test.ts tests/database-storage.test.ts tests/database.test.ts
pnpm verify:docker
pnpm audit --prod --json
pnpm audit --json
node --check scripts/verify-docker.mjs
node --check docker/verify-browser.mjs
node --check docker/jellyfin-fixture.mjs
git diff --check
```

`pnpm check` runs formatting, all production builds, strict source/test types and the complete unit/integration suite. M1 tests remain active; migration-count expectations now include migration 2, and the M1 unavailable-connector test now checks that later catalog/playback operations still fail without network work. The audited R2 `storage.ts` is unchanged.

New coverage includes validated URLs (LAN/IPv6/base paths and rejected schemes/credentials/query/fragment/ambiguous paths), real SDK HTTP requests, normalized auth/network/redirect/timeout/response errors, identity checks before credential forwarding, user-scoped libraries, authenticated encryption/nonce uniqueness/tampering/wrong-key/context binding, admin/CSRF enforcement, absence of secrets in DB/WAL/SHM/responses/logs, saved-token reconnect after restart, revocation/removal/offline reporting, R2-to-M2 migration preservation and the admin UI. All fixtures are disposable and contract-based, not real Jellyfin integration.

## Docker verification assertions

The same script retains M1's clean migration, health, frontend/assets, authentication/session, trusted HTTPS browser, private-directory/file/sidecar, unrelated-UID, restart/shutdown/recreation, logging and privilege checks. Migration ledger now has versions 1 and 2.

A separate verification-only Node fixture implements the inspected Jellyfin endpoints. It runs non-root with a read-only root filesystem, no capabilities, no-new-privileges and no host port. Its private disposable state volume retains only token digests/counters across test stack recreation. It is absent from ordinary production Compose. Fixture passwords/token seeds and the OpenFlix master key are generated randomly in memory by the verifier; they are not build arguments or source files.

The trusted HTTPS browser signs in as a disposable OpenFlix admin, adds the fixture from Settings → Media Servers, checks the cleared password/normalized libraries, reloads, reconnects using the saved credential and removes that connection. A separate persistent fixture connection is created through the production HTTP API. Its record contains an authenticated-encryption envelope and no credential/key/password plaintext.

Container restart, clean stop/start and full Compose down/up must preserve OpenFlix accounts/sessions/migrations/config and allow reconnect with the same encrypted connector credential. The fixture authentication counter must not increase on reconnect. Removal must invalidate only that session and delete the local record. Collected logs are checked against generated passwords, session tokens, master key and Jellyfin token seed. The full suite runs again inside the Linux development image. All uniquely named test containers, networks and volumes are removed on completion; only build/image caches may remain.

## Results and handoff

Final command results belong in [the Milestone 2 report](milestone-2-report.md) and the frozen review package's detached extraction record. M1 historical verification remains in [verification.md](verification.md). Do not interpret fixture success as household server acceptance. Optimus must complete [the integration checklist](milestone-2-integration.md) before independently approving M2; no M2 audited tag or release is created by this builder.
