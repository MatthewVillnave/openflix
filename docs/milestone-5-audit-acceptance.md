# Milestone 5 independent acceptance

The owner supplied Optimus's final verdict: **PASS WITH EXPLICIT LIMITATIONS — ACCEPT WITH EXPLICIT NON-BLOCKING LIMITATIONS**. These are attributed independent results, not household tests performed during release integration.

Accepted implementation: `e08d799de9accf84b50ab4d9334b5dc4b6d712ce`, preserved on `feat/milestone-5-multiple-servers` and by audit-reference tag `openflix-v0.5-m5-audited`. Original `openflix-milestone5-review.zip` SHA-256: `13a4b107450c60120a43267f1607d0e63deb7574d441b6e1b93305d4ad95c666`.

The licensed `openflix-v0.5-m5` release is a different integrated commit, preserving the documentation cleanup from PR #1 and adding separately verified licensing/source notices. Its detached release-provenance record identifies the final commit, source archive checksum and post-audit file inventory. The original ZIP is historical evidence, not the licensed release's source download. Earlier reports retain their original verdicts.

## Controlled independent acceptance

Optimus reproduced 389/389 full checks; 194/194 focused playback/grouping/security on rerun; 95/95 prior storage/auth/catalog regressions; 25/25 historical Docker groups; 6/6 single-Jellyfin HLS groups; 6/6 independent two-Jellyfin groups; exact-history M4 upgrade; dependency audits with no known vulnerabilities; and exact-commit CI. Chromium decoded from both backends. Controlled duplicates, startup fallback, source pinning, credential isolation, cancellation and cleanup were exercised.

The first focused run was **193/194** because an HLS-attach assertion timed out. Isolated, full-suite and complete focused reruns passed. This intermittent result is retained as a test-stability follow-up; no assertion was weakened for release integration.

## Household plus disposable acceptance

An isolated M5 OpenFlix installation held household and disposable connectors concurrently; both independently identified Jellyfin servers reported 10.11.11. Both catalogs synchronized. Final item-ID comparisons matched all four libraries on each server: **743 household and 24 disposable library-membership rows**, not necessarily distinct media files. A household movie appeared upstream after the first snapshot; targeted resynchronization resolved the difference.

The authorized household episode used HLS remux with video/audio copy. The authorized household movie used HLS conversion with video/audio encoding. Both decoded, paused, sought forward/backward, resumed and stopped. B-only generated media played in the same installation. Stopping/removing B did not interrupt observed A playback. Restart preserved both connectors/catalogs; old grants failed safely. Token separation, ordinary-user denial and original-login binding were checked. Audit-created credentials/resources were removed afterward.

## Explicit limits

Principal advancing household intervals were approximately **4.5 seconds each**, plus a **7.9-second** A observation during B's outage. These prove short decoding/control behavior, not full-title playback or sustained transcoding capacity.

No genuine household/disposable duplicate existed. Household duplicate equivalence and automatic fallback remain untested; only the separate generated two-server scope establishes controlled grouping/fallback. Safari, real iPhone and audible-output confirmation remain unverified.

Browser reporting requests succeeded, but later household UserData showed zero position ticks. Persistent household watch progress and exact household upstream report payloads were not established. This is an evidence gap, not a diagnosed defect. No universal device, codec, edition or race-condition coverage is claimed.

Playback remains administrator-only; authenticated users share imported catalog metadata; there is no per-user upstream identity mapping. Edition/duration assertions are not proof of identical timelines, and active streams never switch backends seamlessly. No federation or next milestone is included.

## Follow-ups

- [Intermittent HLS-attach assertion](https://github.com/MatthewVillnave/openflix/issues/2).
- [Household watch-progress persistence evidence](https://github.com/MatthewVillnave/openflix/issues/3).
- [Safari/iPhone, audible output and sustained playback](https://github.com/MatthewVillnave/openflix/issues/4).

These are separate follow-ups, not changes included in the licensed release or authorization for new household tests.
