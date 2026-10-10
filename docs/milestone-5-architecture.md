# Milestone 5: multiple sources inside one OpenFlix server

M5 builds on the independently accepted M4 commit recorded in
[milestone-4-audit-acceptance.md](milestone-4-audit-acceptance.md).
It adds no federation and changes no upstream files. Historical builder reports
remain historical; their original status has not been rewritten.

## Identity and publication

Existing connector-scoped catalog IDs and library memberships remain authoritative.
Migration 4 adds `catalog_works` and `catalog_work_members`. One source item has
one membership regardless of how many library views expose it. Foreign keys
cascade source removal; empty works are pruned.

Movies and series group only when their **complete canonical provider evidence**
agrees. Namespaces and entity types are part of the identity. IMDb identifiers
must be `tt` followed by 7–10 digits; TMDB/TVDB identifiers must be positive decimal
strings of at most 15 digits (leading zeros canonicalize). Unknown namespace
evidence is retained in the fingerprint, not discarded. Empty, invalid, or
contradictory namespace aliases produce source-specific groups. Partial overlap
does not merge records. This intentionally misses some duplicates instead of
allowing transitive contradictions.

Episodes additionally require their own provider evidence, an identified parent
series, and positive matching season/episode numbers. Specials, missing numbering,
multi-episode ranges, missing parent evidence, and numbering-only matches stay
separate. This does not prove alternate episode orders equivalent: provider
evidence and numbering must both agree. Seasons remain source-specific. Grouped
series navigation queries those source relationships; music, artists, albums,
playlists and unsupported objects remain source-specific and retain old links.

Work IDs hash versioned canonical identity, with original source ID as the fallback.
Equal evidence is independent of connector scan order. Adding an equal source
preserves the work ID. Metadata corrections can split or merge groups: affected
sources move to the deterministic corrected identity, empty groups disappear.
There is no redirect from an obsolete group ID to a different work.

Publication refreshes the affected connector's groups **inside the catalog publish
transaction**, after complete staging, using keyset batches of 100 source records
and indexed parent/membership lookups. No network request occurs in this transaction.
Failed scans never publish new grouping; targeted scans retain other libraries.
Startup backfills existing accepted-M4 catalogs transactionally. Removing one
connector preserves other members. Source counts use backend server identity plus
upstream item identity; duplicate connections are shown separately as connections.
This cannot establish that distinct backends store different physical copies.

Display metadata comes from the lexically smallest source-item ID, without changing
any source's metadata. All availability wording is **last-indexed**. No online or
playable state is inferred from persistence.

## Editions and playback selection

Jellyfin 10.11.11 has no canonical `EditionName` DTO field. The adapter preserves
bounded `MediaSources.Name` labels and `MediaSourceCount`, and recognizes the explicit
optional local metadata tag `OpenFlixEdition:<label>` (case-sensitive, trimmed,
maximum 128 characters). It never guesses editions from filenames, titles or years.
Conflicting/empty assertions are not equivalent. This convention is read-only:
OpenFlix never edits tags or asks the household operator to change metadata.

Automatic substitution requires the same asserted edition and indexed runtime
rounded to seconds. These are additional version constraints, never work identity.
Fresh planning must confirm the runtime when comparing candidates. They do not
establish seamless timeline/resume equivalence. Without an explicit assertion,
versions remain distinct choices; users can select a source directly. A single
source does not need an edition assertion.

Group planning considers at most four candidates in stable source-ID order,
sequentially, using existing five-second connector request deadlines. It prefers
direct over remux over transcode among equivalent versions and stops at a direct
candidate. PlaybackInfo does not auto-open live streams or start encoders for
ranking. Unavailable/incompatible candidates may be skipped before grant creation;
unused successful plans receive exact-session cleanup. All-unavailable results
explain the four-candidate bound and allow an explicit choice. An explicit source
failure never silently substitutes another source or edition.

Unified planning requires exactly one upstream MediaSource and verifies that the
fallback response identifies the same source. Multiple versions inside one Jellyfin
item remain an explicit limitation of unified playback. Existing source-item
playback remains available with its accepted behavior.

Every grant pins one item, connector, and (for unified playback) work/version binding.
Authorization and binding are checked after awaits and on every stream/resource
request; periodic revocation cancels active streams. Regrouping or removal revokes,
never retargets, a grant. Midstream switching is not implemented. Reporting and
cleanup always use the selected connector/device/session. Connector removal blocks new grants, revokes active grants and awaits their scoped cleanup before revoking/deleting the saved connector credential; failures are sanitized and best-effort, never redirected to another backend. No new persistent watch
history or playback-token storage is introduced.

## API and UI

Authenticated browse routes:

- `GET /api/v1/catalog/works?offset=0&limit=50&type=movie&connectorId=...`
- Optional `seriesWorkId` and `seasonNumber` preserve episode navigation.
- `GET /api/v1/catalog/works/:id?offset=0&limit=50` returns safe member source labels.

Pagination is limited to 100 records and offset 1,000,000. Source/library APIs
remain unchanged. The unified view is an additional, simple interface with
type/server filters, source counts, explicit version choice, and the existing
native/HLS player. React renders metadata as text.

Administrator-only `POST /api/v1/playback/sessions` accepts either the legacy
`itemId`, or `groupId` with optional `sourceItemId`, plus the existing bounded
browser profile. Mixing selectors is rejected. Nonmembers return 404; ambiguous
versions or changed bindings return 409; no compatible bounded candidate returns 503. Client input cannot select upstream URLs or MediaSource IDs.

## Security and compatibility boundary

A group grants no authority. Ordinary OpenFlix users remain browse-only.
Administrators use configured connector identities, which retain their Jellyfin
library restrictions. Credentials remain encrypted, separately resolved per
connector, and absent from browse/playback responses and logs. Existing origin,
TLS, redirect, private-storage, HLS parsing, grant/login binding, streaming and
container protections remain in effect.

The separate cancellation commit is documented in
[playback-cancellation.md](playback-cancellation.md); it is new M5 verification,
not retroactive M4 acceptance.

Official Jellyfin 10.11.11 BaseItemDto/MediaSourceInfo fields used additionally:
`Tags`, `MediaSourceCount`, `MediaSources.Name`, and `IndexNumberEnd`.
SDK 1.0.0 remains pinned. See [the plan](milestone-5-plan.md) for primary references.
Disposable restricted-user setup uses the 10.11.11 OpenAPI operations
`CreateUserByName` and `UpdateUserPolicy`; these operations are verifier-only.
The accepted implementation includes no provider lookup, scraper or household modification. The later release integration adopts [AGPL-3.0-only and source notices](licensing.md) separately from the audited implementation.
