# Milestone 3 builder verification

Requirements: Node 24.19.0, pnpm 11.19.0, trusted/private TMPDIR (see the [R2 note](verification.md#audited-r2-host-tmpdir-prerequisite)), loopback access, registry access and Docker with Compose. Free loopback ports 8080 and 5173 and permit source mounts. Use no household server or credentials.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm exec vitest run tests/catalog-connector.test.ts tests/catalog-sync.test.ts tests/catalog-http.test.ts tests/catalog-web.test.tsx tests/jellyfin.test.ts tests/connectors-http.test.ts tests/connector-credentials.test.ts tests/database.test.ts tests/database-permissions.test.ts tests/database-storage.test.ts
pnpm audit --prod --json
pnpm audit --json
pnpm verify:docker
node --check scripts/verify-docker.mjs
node --check docker/jellyfin-fixture.mjs
node --check docker/verify-browser.mjs
git diff --check
```

The full check covers formatting, source/test type checks, production builds and all M1/M2/M3 tests. Migration-count assertions now expect three; old migration SQL is unchanged. The former eager scan signature was intentionally replaced with an async page iterator to satisfy bounded-memory M3 requirements. Later search/playback methods still throw without network access.

Targeted tests cover each normalized item type, null/unknown library type independent of name, TV/music relationships, valid/malformed/exact-boundary/empty pagination, unknown fields/types, duplicate IDs, stable IDs, metadata updates, successful stale removal, partial-failure rollback, source/library isolation, overlapping views, cascading cleanup, interrupted-run recovery, cancellation, M2 schema upgrade, authentication/admin/Origin rules, API paging/filtering, safe UI text and credential/log exclusion. The 5,000-item test repeats 50-page scans and rejects a last-page duplicate while preserving published data.

Docker verification retains every M1/M2 group and adds catalog pages, TV null-type hierarchy, real-browser catalog sync/browsing, idempotent resync, controlled metadata change/deletion, partial failure without publication, persistence across restart/stop-start/full recreation and removal cleanup. The verification-only fixture exposes its own control endpoint solely inside the disposable test network; it is absent from ordinary production Compose and is never a real-server claim. All uniquely named containers/networks/volumes are removed; image/build caches may remain.

Final results belong in [the M3 report](milestone-3-report.md). The review ZIP includes a manifest, source hashes and changed-file inventory. Verify the detached ZIP checksum, extract into a fresh directory, run `shasum -a 256 -c SOURCE-FILES.sha256`, then repeat the commands above (the Git-only whitespace check belongs in the source checkout). Use an independent local pnpm store if desired. Post-extraction results are recorded beside the frozen ZIP to avoid changing its already-frozen bytes. Optimus must then follow [real integration checks](milestone-3-integration.md).
