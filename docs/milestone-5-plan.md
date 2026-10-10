# Milestone 5 design and acceptance plan

M4 publication is complete. M5 adds a local aggregation layer above existing connector-scoped catalog items and playback grants. No federation, external lookup, file modification, license change or household access.

## Identity and persistence

Add migration 4 with works and source-item memberships. Existing IDs, libraries, metadata and relationships remain authoritative. Work identity is a versioned hash of entity type and the complete canonical provider-ID set, with at least one supported provider. IMDb title IDs retain their tt prefix/digits; TMDB/TVDB IDs are positive canonical decimal IDs scoped by media type. Invalid, case-conflicting or incomplete evidence remains separate. Exact evidence equality deliberately misses partial-ID duplicates rather than building transitive bridges through contradictory records. Unknown provider evidence is retained in the fingerprint, never silently discarded.

Movies and series qualify. Episodes additionally require their own reliable IDs, a confidently identified source series and positive season/episode numbers; ambiguous orders, specials and missing IDs remain source-specific. No numbering-only inference. Music, seasons and playlists remain source-specific but browsable. Grouped-series navigation queries member series' episodes, retaining source navigation for seasons/music.

Compute memberships from committed catalog only, in bounded 100-row batches inside the successful publication transaction. Indexed equality replaces all-pairs matching. No network I/O occurs in transactions. Exact evidence hashes are scan-order independent, persistent, and unchanged when an equal source is added. Metadata corrections can move a source to a new/existing work; empty works are removed. Active grants remain pinned and are revoked on group/version-membership changes, never retargeted.

## Concrete edition contract constraint

Jellyfin 10.11.11 BaseItemDto has no EditionName property. Official contracts expose Tags, MediaSourceCount and MediaSources.Name; version labels are arbitrary user labels, not canonical edition identifiers. Do not invent an upstream field or infer equivalent timelines from titles, resolution labels or duration.

Preserve safe normalized version labels/counts. Automatic cross-source comparison/fallback requires explicit operator-provided edition-equivalence metadata: one upstream tag `OpenFlixEdition:<label>`, plus matching rounded-second indexed duration and fresh planned duration validation. Different/missing/conflicting labels stay distinct; multiple unresolved editions require explicit source choice. This opt-in convention does not modify Jellyfin from OpenFlix and is optional: source-specific playback remains available without it. Multi-version upstream items require explicit upstream organization/source selection; unified automatic planning fails closed if fresh PlaybackInfo has multiple sources rather than silently picking a different cut.

## Selection and access

Unified endpoints offer paginated works, source memberships and grouped TV navigation; source/library links remain. Counts deduplicate view memberships and flag connections with the same backend identity. Counts mean indexed sources, not physical copies or currently playable sources.

Admin-only planning validates membership before and after awaits. At most four deterministic candidates in an equivalent version set are freshly planned, sequentially; direct outranks remux then transcode. PlaybackInfo does not start encoders; abandoned plans are cleaned up. An explicit source never substitutes another. Unavailable candidates can be skipped before any grant is issued. The selected grant is permanently bound to its connector/source/login/group/version; stream failure requires explicit retry, never automatic midstream switching.

## Acceptance

Focused tests first: canonical identities/collisions/contradictions, stable grouping and membership cleanup, publication failure safety, scoped selection/auth/credentials, cancellation controls, upgrade and multi-thousand-item scans. Then run full checks, prior regressions, historical Docker and disposable Jellyfin suites sequentially.

Add two independent disposable official Jellyfin 10.11.11 servers, separate volumes/credentials/identities, generated direct/HLS media and controlled metadata. Prove unique/grouped titles, both-source browser decoding/time/pause/seek/reporting, direct preference, unavailable-A startup using equivalent B, removal survival and token/cleanup isolation. Include conflicts, alternate editions, missing IDs, TV ambiguity, restricted users and duplicate views.

Finally verify accepted-M4 upgrade in an exact Git checkout, fresh archive extraction, exact-final CI and immutable historical artifacts. Freeze a review ZIP with source hashes/inventory and an independent audit checklist; do not merge/tag M5. Builder success is READY FOR INTEGRATION AUDIT only after every required check passes.

Official references: [10.11.11 BaseItemDto](https://github.com/jellyfin/jellyfin/blob/v10.11.11/MediaBrowser.Model/Dto/BaseItemDto.cs), [MediaSourceInfo](https://github.com/jellyfin/jellyfin/blob/v10.11.11/MediaBrowser.Model/Dto/MediaSourceInfo.cs), [Jellyfin version naming](https://jellyfin.org/docs/general/server/media/movies/#multiple-versions), [IMDb datasets](https://developer.imdb.com/non-commercial-datasets/), [TMDB movie identity](https://developer.themoviedb.org/reference/movie-details). SDK remains 1.0.0; relevant 10.11.11 schema SHA-256 remains recorded in the M4 R2 API notes. No provider network lookups are used.
