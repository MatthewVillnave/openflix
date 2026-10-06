# Milestone 3 Jellyfin catalog API baseline

Inspected 2026-10-06 UTC before implementing catalog calls. No household server was contacted by the builder. The independent M2 auditor reported PASS against Jellyfin 10.11.11 on Linux x86-64, server TheForgeHQ, views Movies, Music, Playlists and Tv shows. That test used an administrator; restricted-user visibility remains unproven. The null CollectionType on Tv shows is an observed integration result, not a fixture-derived claim.

## Official sources and versions

- Exact [10.11.11 OpenAPI](https://repo.jellyfin.org/files/openapi/stable/jellyfin-openapi-10.11.11.json), SHA-256 `e29fc369ecae54676caeb50cbbc006b5c4ee959906c00f1e02f6f83db9c227fb`. Official server tag `v10.11.11` resolves to `1fbd8739292cce610231be93daf43368733edf63`.
- Current [12.1.0 OpenAPI from the official SDK repository](https://media.githubusercontent.com/media/jellyfin/jellyfin-sdk-typescript/1ef06252cef5d1729646331e64059e230f11a08b/openapi.json), SHA-256 `6112f7aabd5960a9bf88382718e3804b09f6c92f39e06a49eea6d7524f7e51e6`. SDK master remained `1ef06252cef5d1729646331e64059e230f11a08b` at inspection.
- Installed official SDK remains **1.0.0**, revision `1fdc2aefcf963fec84e7eafe15743dafe8c1d26a`, generated against API **12.0.0**. See [the M2 baseline](jellyfin-preparation.md) for that schema hash and the original inspection.
- [Official SDK LibraryApi documentation](https://typescript-sdk.jellyfin.org/classes/generated-client.LibraryApi.html) and installed `lib/generated-client/api/library-api.{js,d.ts}` plus `lib/utils/api/library-api.js` were inspected. `getLibraryApi` inherits `LibraryApi` and uses the configured SDK authorization/transport. Its augmentation declaration has extensionless imports that lose inherited methods under NodeNext; a narrowly scoped `Pick<LibraryApi, 'getItems' | 'getItem'>` type assertion restores the inspected declarations. Runtime still calls the official helper unchanged; Zod validates response data.

## Operations and parameters

| SDK operation                      | HTTP                  | Consumed request contract                                                                                                                                                                                           |
| ---------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LibraryApi.getItems` / `GetItems` | `GET /Items`          | Explicit connector `userId`, view `parentId`, `recursive=true`, bounded `startIndex`/`limit`, `sortBy=SortName`, `sortOrder=Ascending`, `enableTotalRecordCount=true`, `enableImages=false`, `enableUserData=false` |
| `LibraryApi.getItem` / `GetItem`   | `GET /Items/{itemId}` | Explicit connector `userId`; item identifier validated before interpolation                                                                                                                                         |
| `GetUserViews`                     | `GET /UserViews`      | Existing M2 user-scoped views, hidden/external content excluded; consumed total, when present, must match the returned list                                                                                         |

The selected fields are `ParentId`, `SortName`, `ProviderIds`, `Etag`, `DateCreated`. Both exact 10.11.11 and current 12.1 schemas define these operations, parameters and fields. Other M2 authentication, identity and revocation operations are preserved. This establishes a contract/fixture baseline, **not** SDK-wide 10.11 compatibility or real M3 acceptance.

## Response fields consumed

Page envelope: `Items`, `TotalRecordCount`, `StartIndex`. Library hints: `Id`, `Name`, `CollectionType` (nullable), optional `TotalRecordCount`.

Items: `Id`, `Name`, `Type`, `SortName`, `ProductionYear`, `PremiereDate`, `RunTimeTicks`, `ParentId`, `SeriesId`, `SeasonId`, `IndexNumber`, `ParentIndexNumber`, `AlbumId`, `Album`, `ArtistItems[].Id`, `AlbumArtists[].Id`, `ProviderIds`, `Etag`, `DateCreated`. Artist pair names are bounded during parsing but are not stored as relationship identities. Unselected/unknown DTO properties are discarded, including filesystem paths, media sources, images and user/playback data. No raw upstream DTO blobs enter the catalog.

`Type` determines each item's semantics. Null/unknown CollectionType never selects a parser or blocks enumeration; library names are never consulted for type inference. Playlist objects receive metadata only when these endpoints return them; playlist-membership endpoints and mutations are not called.

## Pagination boundary

Pages contain at most 100 items and responses at most 1 MiB, with a five-second request/absolute deadline. A scan allows at most 10,000 pages and one million reported items, and the server bounds a job to 30 minutes. Counts must remain stable, offsets must match requests, oversized/empty-before-end pages fail, and duplicate IDs within a library fail rather than permitting a stale-item sweep. Exact page boundaries stop at the advertised count. Database staging detects cross-page duplicates without retaining all IDs in JavaScript memory.

Offset pagination does not provide an upstream snapshot. Concurrent Jellyfin changes with unchanged totals may not all be detectable; operators should scan a quiescent server and resync after changes. Detected inconsistencies fail closed and preserve the last published catalog. Optimus must independently test actual TV/music/playlist and restricted-user behavior; do not upgrade or reconfigure production to fit fixtures.
