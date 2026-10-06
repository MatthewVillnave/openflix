# OpenFlix Milestone 3 builder report

## GITHUB / M2 RELEASE

Public repository: https://github.com/MatthewVillnave/openflix. Main was fast-forwarded without rewriting history to audited M2 commit `82046d6165d269b1499b1a04937abd851fecb03f`. Annotated `openflix-v0.2-m2` points exactly there. [OpenFlix Milestone 2 — Jellyfin Integration](https://github.com/MatthewVillnave/openflix/releases/tag/openflix-v0.2-m2) is public, not a draft/prerelease, and contains the unchanged original M2 ZIP/checksum. Its ZIP asset digest is `29867a8799847a140b55afd1284a7e5f0ac14ebf7dceac583a1ecb8999348bfd`.

Original M1 tags retain their exact targets: M1 `1fa622a0ca19701354d957eb13bfc87e16e04b06`, R1 `2597207b71acdb4b96b506c975836fb5621f92a2`, R2 `87009bbb43aea3d6476c266fc4a9a0442f4c31fd`. The M2 development branch remains preserved. M3 branch `feat/milestone-3-catalog` was created from the audited M2 commit only after tag/main/release verification. No M3 merge or audited tag is created.

## STATUS

**READY FOR INTEGRATION AUDIT** — builder host and Docker verification passed. Final frozen source/ZIP identity, fresh-extraction results and final-commit GitHub CI are recorded in the detached review verification record. No real Jellyfin M3 acceptance is claimed. No household server was contacted or modified.

## MILESTONE 3 IMPLEMENTED

Normalized item/library catalog, source-specific identities, paginated SDK enumeration, individual normalized upstream item fetch, disk staging and atomic full/library synchronization, persistent sync state, safe stale-item removal, connector cascade cleanup, authenticated browse/filter/page/item API, administrator-triggered asynchronous sync and functional textual catalog UI with TV parent/child navigation. Existing M1/M2 security remains active.

## JELLYFIN CATALOG API BASELINE

Official exact Jellyfin **10.11.11** schema (server revision `1fbd8739292cce610231be93daf43368733edf63`), installed official TypeScript SDK **1.0.0** (`1fdc2aefcf963fec84e7eafe15743dafe8c1d26a`, matched API 12.0.0), current **12.1.0** schema/SDK revision `1ef06252cef5d1729646331e64059e230f11a08b`. `LibraryApi.getItems` (`GET /Items`) and `getItem` (`GET /Items/{itemId}`) use explicit connector user IDs. Exact response fields, request parameters, schema hashes and official links are in [the API baseline](milestone-3-api-baseline.md). M2's independently proven operations remain unchanged; this is not SDK-wide 10.11 compatibility.

## NORMALIZATION MODEL

Item-level types map to movie/series/season/episode/audio/album/artist/playlist, otherwise explicit unknown. Source-scoped stable IDs, memberships across views, provider metadata, runtime/date/year/revision and TV/music relationship IDs are retained. Raw DTOs, paths, images and playback/media-source details are discarded. No cross-source deduplication exists.

## NULL COLLECTION-TYPE HANDLING

The real `Tv shows` view with null CollectionType remains valid. Item Type independently normalizes Series, Season and Episode; their observed family yields a television catalog library after publication. Null upstream metadata is preserved. The same test passes with an unrelated view name; no name-based inference exists. Empty/unsupported libraries can remain unknown; multiple item families produce mixed.

## DATABASE / MIGRATION

Migration 3 adds catalog libraries/items/memberships, sync status and disk staging tables, with source uniqueness, lookup/hierarchy indexes and composite source foreign keys. Connector removal cascades all its catalog/staging state. Original migrations 1/2, audited storage implementation, credential encryption and authentication remain unchanged. The M2 schema upgrade regression preserves users, sessions and ciphertext.

## SYNCHRONIZATION ALGORITHM

Read and validate bounded pages into a new disk generation; readers retain the previous complete catalog. Only after every applicable library/page succeeds does one transaction upsert metadata, replace scanned memberships, prune absent full-scan libraries/orphan items and record success. Failure, cancellation, malformed pagination, inconsistent totals or duplicate IDs discards staging and preserves previously published records. Startup recovers interrupted staging. Targeted sync does not prune other libraries.

Publication reads staging in 100-row keyset batches before writing because the SQLite binding forbids mutation while an iterator is active. No entire catalog array or unbounded in-memory ID set is created. Offset enumeration is not an upstream snapshot; same-count concurrent mutations may escape detection and are documented.

## CATALOG API / UI

Authenticated `/api/v1/catalog/libraries`, `/libraries/:id/items`, `/items/:id`, `/sync/:connectorId`; the sync POST is administrator/Origin protected and returns 202. Browse pagination is bounded, type and parent filtering use normalized values, status is sanitized. UI supports explicit source/library sync, polling/status, library selection, type filtering, pages, details and children/parent navigation. Browser requests go only to OpenFlix. All signed-in OpenFlix users share the imported catalog, explicitly documented and shown to administrators.

## SECURITY

M1 authentication/session/CSRF/logging/owner-only storage and M2 AES-GCM/external-key/network restrictions remain enforced. Fixed bounded pages, response sizes/timeouts, total/page/job limits, parameterized SQL, scoped foreign keys, secret-echo rejection and React text rendering apply to catalog data. There is no dangerous HTML rendering, public catalog, raw upstream error output or browser credential exposure. Same-UID/root/ACL assumptions remain those of the audited foundation.

## TEST RESULTS

- `pnpm check`: **184/184 tests across 18 suites**, plus production builds, strict source/test types and formatting passed on macOS.
- Documented targeted command: **132/132 tests across 10 suites**, covering catalog/connector/database/security/UI behavior.
- Synthetic resource test: 5,000 items in 50 bounded pages, repeat stable-ID synchronization and last-page duplicate failure preserving all published records.
- `pnpm audit --prod --json` and `pnpm audit --json`: **zero known vulnerabilities**, 132 production / 292 total dependencies reported. No external dependency versions changed.
- Existing 130 M1/M2 tests remain active, with migration counts/additive library projections and formerly unimplemented scan-contract expectations updated for M3.
- Fresh extraction and final CI evidence are detached beside the frozen ZIP so final artifact verification does not mutate the source/archive.

## DOCKER RESULTS

`pnpm verify:docker`: **20/20 groups passed**, including **184 Linux tests**, production/development builds, real trusted-HTTPS Chromium catalog synchronization/TV navigation/paging, fresh migrations, catalog resync/partial-failure preservation, restart/stop-start/full recreation, persistence without reauthentication, connector cleanup, log-secret checks and every retained M1/M2 storage/privilege check. The fixture is disposable and absent from ordinary production Compose. Test containers/networks/volumes are removed; image/build caches may remain.

## FILES CHANGED

Connector/shared/protocol contracts, Jellyfin catalog parser/pagination, database migration/repository, server sync/API, web catalog, four new catalog test suites, existing fixture/assertion updates, Docker fixture/verifier/browser coverage, web shared-workspace dependency/lockfile, catalog/API/security/verification/integration documentation. The frozen artifact includes the exact changed-file inventory.

## ARCHITECTURE DECISIONS / DEVIATIONS FROM SPEC

No broad redesign. The draft eager scan return type is replaced by an async page iterator to satisfy bounded-memory requirements. Disk staging avoids exposing incomplete updates and enables atomic stale deletion. Relationships may remain source-scoped unresolved IDs when parents/artists are not enumerated. SDK augmentation types need a narrow generated-method assertion for NodeNext extension omissions; runtime remains official SDK behavior. Under the latest narrower M3 request, poster loading, full-text search, automatic scheduled polling and playback from the broad draft are deferred. Manual sync runs asynchronously in the existing process, with one shared connector mutation lock.

## KNOWN LIMITATIONS

No real M3 server integration is claimed. Restricted-user visibility remains independently unproven; M2 used an administrator. Jellyfin offset scans are not snapshots; avoid concurrent source changes and reconcile afterward. One OpenFlix process per database; publication can temporarily block requests for very large catalogs. All OpenFlix users share the imported catalog; no per-user upstream identity mapping. No automatic scheduled resync, missing-parent fetch, playlist membership/mutation, artwork, search, playback, cross-source deduplication or federation. Native Windows file-backed storage remains unsupported/fail-closed; use Linux containers. Retain the separate master key and trust configured LAN/origin/DNS under M2 assumptions.

## INTEGRATION TESTS OPTIMUS MUST PERFORM

Follow [the independent checklist](milestone-3-integration.md): actual 10.11.11 item enumeration, null-type TV hierarchy, movie/music/playlist metadata, real counts/pagination/resync, restart/recreation, controlled partial failures on isolated fixtures, ordinary-user/admin separation, storage/log/browser secret inspection and an existing restricted account if safely available. Do not modify household users/permissions, libraries, media, metadata, playlists, configuration or plugins. Do not begin Milestone 4.

## REVIEW IDENTITY

Exact final commit and ZIP SHA-256 are in the review manifest and detached checksum/verification record. The archive contains unchanged committed sources plus manifest, source hashes and changed-file inventory. No M3 audit tag or release is created before independent acceptance.
