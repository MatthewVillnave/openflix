# OpenFlix Milestone 3 R1 remediation report

## STATUS

**READY FOR RE-AUDIT** after builder host/Docker checks. Final frozen-archive reproduction and final-commit GitHub CI evidence are in the detached verification record. Independent real-Jellyfin acceptance remains Optimus’s responsibility. No M3 merge/tag or Milestone 4 work is included.

## ROOT CAUSE

The reviewed commit `a457a55cc37a94c7185aef91bb5c36945e20170d` normalized Jellyfin Folder records to unknown. Publication counted every unknown as a semantic family, so Movie + Folder and Series/Season/Episode + Folder incorrectly became mixed. Optimus reproduced this with real Jellyfin 10.11.11, including the null-CollectionType TV view.

## REMEDIATION

The Jellyfin parser now marks exact Folder items with optional normalized `structural: true`. The database classifier excludes only explicitly structural records from family inference. Folder records are still persisted as unknown with upstreamType Folder. This is an additive normalized metadata property using the existing representation; no tables, migrations, identity algorithms or API routes changed. Jellyfin-specific matching remains inside the connector package.

Only-structural libraries are unknown even when a CollectionType hint exists. Truly empty libraries retain their existing hint behavior. Unknown semantic types remain conservative, and multiple real families remain mixed. Neither display names nor upstream IsFolder flags determine semantic neutrality. Existing classifications change on the next successful full or targeted resync; startup does not rewrite previously published data.

## TEST RESULTS

- `pnpm check`: **194/194 tests, 19 suites**, formatting, source/test type checks and production builds passed.
- Complete targeted M3/connector/database/security command: **142/142 tests, 11 suites**.
- New targeted classification suite: **9/9**; explicit fresh M2 → M3 migration: **1/1**, preserving users, sessions and connector ciphertext.
- `pnpm verify:docker`: **20/20 groups**, including **194 Linux tests**, movie/TV Folder classification, browser navigation, restart/stop-start/recreation, storage/privilege enforcement, sync failure safety and secret-safe logs.
- Production and complete dependency audits: **zero known vulnerabilities** (132 production / 292 total dependencies). No dependency changes.
- Docker JavaScript syntax and Git whitespace checks passed.

The initial overlapping host/Docker runs hit host hook/CLI/worker startup timeouts. Sequential host reruns passed without changing application behavior, test limits or assertions. The Mac's system Git wrapper also began requiring an Xcode license; verification used the already installed Command Line Tools through per-command PATH/DEVELOPER_DIR, without changing system settings or accepting a license.

Exact commands are in [the verification guide](milestone-3-verification.md). Fresh extraction, artifact identity and final-commit CI results are recorded beside the immutable R1 ZIP in `REVIEW-VERIFICATION.md`.

## FOLDER REGRESSION TESTS

The new wire-connector-to-database suite runs against a disposable fixture identifying as Jellyfin 10.11.11, with arbitrary library name `Arbitrary collection 47`. It checks publication, folder retention, stable identities, repeated synchronization and reopen persistence for eight cases:

| Upstream item types                    | CollectionType hint | Expected family |
| -------------------------------------- | ------------------- | --------------- |
| Movie, Movie, Folder                   | movies              | movie           |
| Series, Season, Episode, Folder        | null                | television      |
| Audio, MusicAlbum, MusicArtist, Folder | music               | music           |
| Folder, Folder                         | null                | unknown         |
| Folder, Folder                         | movies              | unknown         |
| Movie, Audio, Folder                   | null                | mixed           |
| Movie, SyntheticSemanticType, Folder   | movies              | mixed           |
| SyntheticSemanticType, Folder          | null                | unknown         |

A ninth regression verifies semantic containers (Series/Season/MusicAlbum), synthetic unsupported types and lowercase folder are not automatically neutralized by upstream IsFolder. Existing connector normalization tests now include Folder, and TV HTTP and Docker fixtures include real-observed structural folders.

## NULL COLLECTIONTYPE TV RESULT

Series/Season/Episode + Folder yields television with upstreamType null. The arbitrary-name wire test and observed Tv shows HTTP/Docker fixtures prove there is no display-name inference. TV relationship normalization is unchanged.

## TRUE MIXED-LIBRARY RESULT

Movie + Audio + Folder remains mixed. Movie + synthetic unsupported semantics + Folder also remains mixed; the fix does not ignore every unknown record.

## SYNCHRONIZATION REGRESSION CHECK

Staging and the atomic publication transaction are unchanged. Family inference still runs only inside successful publication. Existing regressions cover incomplete page/library scan preservation, successful-only stale pruning, duplicate/malformed pagination, stable IDs, full/targeted/source isolation, restricted-view fixtures, connector cascade cleanup, cancellation, interrupted-run recovery and restart persistence. The synthetic 5,000-item/50-page repeat scan and late-duplicate safety test remain active. Migrations 1/2/3 are unchanged; the explicit M2-schema upgrade test retains users, sessions and encrypted credentials.

## FILES CHANGED

- `packages/shared/src/index.ts`: optional normalized structural flag.
- `packages/connector-jellyfin/src/catalog.ts`: exact Folder normalization rule.
- `packages/database/src/catalog.ts`: neutral-aware family inference and structural-only fallback.
- `tests/catalog-classification.test.ts`: nine new classification regressions.
- `tests/jellyfin-fixture.ts`, `tests/catalog-connector.test.ts`, `tests/catalog-http.test.ts`: observed Folder fixtures and assertions.
- `docker/jellyfin-fixture.mjs`, `scripts/verify-docker.mjs`: structural folders in Movies/TV, classification/retention assertions and adjusted pagination totals.
- `docs/catalog.md`, `docs/milestone-3-verification.md`, `docs/milestone-3-integration.md`, this report: behavior, verification and independent handoff.

## SECURITY / ARCHITECTURE IMPACT

No dependency, migration SQL, credential handling, authentication, session, network, storage-security or synchronization design changes. The additive structural flag contains no sensitive material. Unknown upstream metadata remains data, rendered as React text. Existing M1/M2 protections are exercised by the full suite and Docker checks. No household server was contacted or modified by this builder.

The original M3 artifact is preserved unchanged with SHA-256 `50ca9c06a1067588a0c0032da07d9948108178b9ca1f1d53d8cec3c228a58f10`. Audited history/tags remain intact. Historical M1/M2/M3 reports have not been rewritten.

## KNOWN LIMITATIONS

Optimus must independently re-audit the correction after resync against the actual Jellyfin server; fixture success is not independent acceptance. Only exact Folder is currently a known neutral Jellyfin type; additional structural types require explicit review. Previously published mixed classifications remain until successful resync. Restricted-user visibility remains independently unproven unless tested with a safely available existing account. Existing offset-scan consistency, shared-catalog access, single-process storage and native Windows fail-closed limitations remain documented in [catalog architecture](catalog.md).

## REVIEW ZIP / COMMIT

The separate `openflix-milestone3-review-r1.zip` contains committed source, tests, lockfile, Docker/CI, documentation, manifest, source hashes and changed-file inventory. It excludes credentials, databases, dependencies, builds and machine state. Its exact SHA-256 and commit are recorded in the manifest/detached checksum and verification record. The archive cannot embed its own final digest. No audited M3 tag or merge is created; no Milestone 4 work is included.
