# Milestone 3 normalized catalog

OpenFlix owns a persistent metadata catalog. Only the connector package understands Jellyfin DTOs. The browser reads OpenFlix's catalog and never requests Jellyfin directly. Playback, artwork downloading/caching, full-text search, scraping, cross-source deduplication and federation remain absent.

## Access and operator workflow

Sign in, connect a server in Settings → Media Servers, then use Catalog → Sync [server]. This explicitly imports all views accessible to that connector identity. After the first import an administrator can synchronize a single library. Synchronization mutations require an OpenFlix administrator, a valid session and the existing Origin protection. Ordinary authenticated OpenFlix users can browse the published catalog. Nothing is publicly accessible.

**All signed-in OpenFlix users can see synchronized metadata.** There is no per-user mapping to Jellyfin accounts or per-library OpenFlix permission policy yet. Choose the connector account deliberately. Restricted-user Jellyfin visibility has not yet been independently exercised; the M2 real test used an administrator. Fixtures exercise hidden/unavailable views, but Optimus must test a safely available existing restricted account. Losing upstream access does not automatically revoke access to previously published local metadata; remove the connector or perform a successful full reconciliation as appropriate.

Sync runs in the existing server process after HTTP 202. The UI polls that operation, presents sanitized status, offers manual refresh, type filtering, page navigation, item details and parent/child browsing. Only one connector mutation/sync may run at once. Existing connector test/remove operations return busy while a sync is active. Shutdown cancels a scan and awaits its cleanup before closing SQLite. Startup marks interrupted runs failed and clears staging without deleting the published catalog. Deployment supports one OpenFlix server process per database.

## Normalization and source identity

Item types come from item-level `Type`: Movie → movie, Series → series, Season → season, Episode → episode, Audio → audio, MusicAlbum → album, MusicArtist → artist, Playlist → playlist. Other or missing types become explicit `unknown` records; the bounded upstream type string is retained diagnostically. The old `music` domain value remains available for M2 library hints but is not produced as an M3 item type.

Library CollectionType is a hint only. The connector records the original nullable value. On successful publication, observed item families determine the normalized library type: TV items form television, audio/album/artist form music, distinct families form mixed, unsupported-only content is unknown. An empty library retains a recognized hint or unknown. No display name is inspected to determine type. Therefore the actual **Tv shows / CollectionType=null** case imports Series, Season and Episode normally; renaming the view has no effect on its semantics.

Normalized items contain title, optional sort title/year/release date/runtime seconds, season/episode numbers, source-local parent/series/season/album/artist references, provider IDs, revision and creation date when available. Raw filesystem paths, media-source/stream information, image data and arbitrary upstream DTO fields are discarded. Runtime ticks are converted to seconds. Null provider values are omitted. Provider IDs are metadata only, never a deduplication key.

IDs are stable source-scoped SHA-256 identifiers derived from a JSON tuple of connector ID and upstream ID, prefixed `lib_` or `item_`. Uniqueness is `(connector_id, upstream_id)`. An item can belong to several views through memberships without creating duplicates. Relationship IDs use the same source-specific mapping. They can remain unresolved when a referenced parent/artist is not enumerated by the accessible views; fetching all missing parents would expand scope and request count. No foreign-source relationship is inferred.

Playlist objects are metadata only when returned by the standard item enumeration endpoint. Playlist membership, editing, ordering and playback endpoints are not used. Music relationships are preserved where supplied; M3 is not a complete music UI.

## Migration 3 and indexes

Old migration SQL and audited storage enforcement remain unchanged. Migration 3 adds:

- `catalog_libraries`: OpenFlix/source/upstream IDs, name, normalized and upstream type, last successful publication time.
- `catalog_items`: OpenFlix/source/upstream IDs, indexed type/sort title/relationship IDs, normalized ancillary metadata JSON and publication time. This JSON is an OpenFlix model, not a raw Jellyfin blob.
- `catalog_memberships`: unique library/item pairs with composite source foreign keys. One source item can appear in multiple views safely.
- `catalog_sync`: current/latest operation state, scope, timestamps, generation and fixed error code per connector.
- `catalog_stage_libraries`, `catalog_stage_items`, `catalog_stage_memberships`: private, disposable disk staging for the current generation.

Source/upstream uniqueness, library membership and reverse-item indexes support source and library lookup. Item type/sort and parent/series/season/album indexes support filtering and hierarchy traversal. Source foreign keys cascade on connector removal; memberships cannot cross source boundaries. Relationship targets may be absent and are deliberately not hard foreign keys. All values use prepared SQL parameters; any query structure is application-owned.

## Synchronization and deletion guarantee

1. Authenticate the saved encrypted credential and retrieve current user-scoped views. A full scan covers every returned view; a targeted scan covers exactly the selected still-accessible view.
2. Mark the operation syncing with a new generation. Page through each view, normalizing at the connector boundary and writing batches of at most 100 items to staging. Readers continue seeing the last complete published catalog.
3. Reject malformed pagination, changing totals, missing progress, duplicate IDs within a view and conflicting metadata for an item appearing in multiple views. Duplicate membership detection lives in SQLite, avoiding an unbounded in-memory ID set.
4. Only after every applicable page and library succeeds, publish in one SQLite transaction: upsert normalized records with stable IDs, replace scanned memberships, remove missing libraries for a full scan, delete source items with no remaining memberships, update success timestamps and clear staging.
5. On network, parsing, cancellation or database publication failure, leave the previous published state intact. Discard staging and record a fixed sanitized error where storage remains writable. Never treat an incomplete scan as proof of deletion.

Targeted library scans cannot prune other libraries. A selected library missing from the current view list fails; a successful full connector scan reconciles missing libraries. An empty successful full view list removes that source's catalog. Metadata shared across views must agree during a run, otherwise the scan fails conservatively.

SQLite publication reads staging in bounded 100-row keyset batches, since the binding forbids writes while a read cursor is active. Network I/O never runs inside a SQLite transaction. Publication itself is synchronous and atomic; very large catalogs can temporarily delay other requests. There is no distributed worker/indexing infrastructure. No automatic scheduled scan is enabled: operators explicitly request a full or library resync. Published metadata survives restart without rescanning.

## Limits and consistency assumptions

See [the exact API baseline](milestone-3-api-baseline.md): 100 items/page, 1 MiB/response, five-second request deadlines, 10,000 pages/view, one million reported items/view, at most 1,000 views per connector and a 30-minute operation deadline. Catalog browse pages are at most 100 items with offset bounded to one million. The synthetic test exercises 5,000 items, repeat synchronization and a duplicate on the last page.

Jellyfin's offset API is not a snapshot. Detected concurrent changes abort, but same-count mutations may escape detection. Scan a quiescent server and repeat reconciliation after changes; no transactional upstream snapshot is claimed. Stable unchanged inputs produce stable IDs and membership without duplicates. Last successful timestamps indicate publication time, not proof of current upstream reachability or access.

Secrets remain encrypted under the M2 external-key model and excluded from catalog records, responses and logs. Staging contains metadata and therefore remains inside audited owner-only SQLite storage. Titles are rendered as React text; no HTML injection, raw upstream error display or external resource loading is introduced. URL, redirect, proxy, TLS, timeout, authentication and session protections remain in force.
