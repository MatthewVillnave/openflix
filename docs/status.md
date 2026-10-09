# Current status and documentation index

This index describes the accepted M4 release, not unreleased M5 functionality. Historical reports record what was known at their original freeze; later acceptance does not replace their original verdicts.

## Accepted M4 evidence

The owner reports Optimus's independent verdict: **PASS — approve Milestone 5 with non-blocking notes**. The [published M4 release](https://github.com/MatthewVillnave/openflix/releases/tag/openflix-v0.4-m4) freezes commit `e975e3bd38cb3627b2fa3053bdb3e137c4450764`. [Source tag](https://github.com/MatthewVillnave/openflix/tree/openflix-v0.4-m4), [unchanged R2 review ZIP](https://github.com/MatthewVillnave/openflix/releases/download/openflix-v0.4-m4/openflix-milestone4-review-r2.zip) and [detached checksum](https://github.com/MatthewVillnave/openflix/releases/download/openflix-v0.4-m4/openflix-milestone4-review-r2.sha256) are published. ZIP SHA-256: `2bfb0d6992f1af650b8310bb3c1d3e28888721ea8f1571522c70208ef41e0105`.

- Household Chromium: an episode decoded, advanced, paused, resumed and sought with Jellyfin copying video/audio. Zero-dimension subtitle metadata no longer blocked playback. The previously failing movie decoded and sought on R2 with video/audio encoding.
- Independently reproduced disposable Jellyfin tests established distinct direct, remux, audio-conversion and video-conversion paths, including reporting payloads.
- Automated acceptance evidence: 355 full tests, 161 focused playback tests, 94 security/catalog regressions, 25 Docker groups and 6 disposable Jellyfin groups; audited-M3 upgrade, dependency audits without reported vulnerabilities and exact-commit CI succeeded. These are recorded acceptance results, not checks rerun for this documentation change.

The movie failed on R1 and played on R2. Its exact historical R1 failure cause remains unconfirmed; this was not a remaining M4 acceptance blocker. The original R2 builder report's PARTIAL verdict remains historical and unchanged.

Acceptance is bounded to the exercised operations against Jellyfin 10.11.11, not the entire SDK or universal production/device compatibility. Safari, real iPhone behavior, audible-output confirmation, sustained household performance and specific unreadable household conversion episodes remain unverified. Playback is administrator-only; authenticated users share imported metadata, with no per-user upstream identity mapping. Reporting may affect the connector account's watch state. Intentional cancellation can be mislabeled timeout/502 in M4; the audit established prompt revocation and scoped cleanup without an established leak. The follow-up status fix belongs only to M5 development.

## Playback scope

Use the [direct-play foundation](playback.md) for direct formats and [HLS security/limits](milestone-4-r1-playback.md) for the fallback. Accepted R2 includes both, with [R2 parser and movie-length bounds](milestone-4-r2-remediation.md#exact-contract-and-parser-policy). The remediation document's opening status and handoff are historical, superseded by the acceptance above.

The browser receives authenticated OpenFlix routes, never permanent Jellyfin credentials or upstream media paths. Direct MP4/H264/AAC, WebM/VP8/Opus, MP3 and PCM WAV remain bounded by inspected metadata and browser capability. Jellyfin-managed HLS supports eligible finite local SDR video, including compatible MKV sources, with bounded H264/AAC output; OpenFlix is not a transcoder. HLS fallback is limited to four-hour sources, at most 1080p output and the codec/rate/resource policies in the HLS guide. No universal 4K/HDR, remote/live source, subtitle rendering, DRM, alternate-track or hardware-throughput support is claimed.

R2 accepts bounded non-video zero/null metadata without relaxing selected-video/audio validation. Insufficient runtime fails safely without invented duration. HLS manifests are bounded to 4 MiB input, 512 KiB rewritten output and 8,192 lines; resource, recursion, origin, query and authentication restrictions remain enforced.

## Verification

Install Node 24.19.0 and pnpm 11.19.0, then `pnpm install --frozen-lockfile`. Use a runtime-owned 0700 `TMPDIR` with trusted ancestors as shown in the [README](../README.md#verification). Do not weaken private-storage checks for an unsafe host temporary path.

With that `verification_tmp` directory still present, run checks sequentially:

```sh
TMPDIR="$verification_tmp" pnpm check
pnpm audit --prod --audit-level=high
pnpm audit --audit-level=high
TMPDIR="$verification_tmp" node scripts/verify-m3-upgrade.mjs
node scripts/verify-docker.mjs
node scripts/verify-jellyfin-hls.mjs
```

The upgrade verifier requires Git history including audited M3; run it in a checkout, not a source ZIP lacking `.git`. Docker checks need Docker Engine/Desktop, Compose, Node, network access for pinned images/packages and free test ports. On macOS approve Docker's source-folder access if prompted. Follow [disposable HLS prerequisites and commands](milestone-4-r1-verification.md) and [R2 focused reproduction](milestone-4-r2-remediation.md#reproduction). The disposable Jellyfin 10.11.11 verifier generates its own media; it does not use household files or contact household Jellyfin. Heavy checks are unnecessary solely for prose changes, although configured GitHub CI still runs on pushes/PRs.

## Guides and historical records

Current entry points: [configuration](configuration.md), [foundation architecture](architecture.md), [storage security baseline](security.md), [connector security](connector-security.md), [catalog](catalog.md), [API](api.md), and [architecture decisions](architecture-notes.md). The [original technical specification](technical-specification-v0.1.txt) is preserved; later documented milestone decisions describe the implementation.

Historical records, preserved with original scope and verdicts:

- M1: [report](milestone-1-report.md), [verification](verification.md).
- M2: [acceptance](milestone-2-audit-acceptance.md), [verification](milestone-2-verification.md).
- M3: [acceptance](milestone-3-audit-acceptance.md), [builder report](milestone-3-report.md), [verification](milestone-3-verification.md).
- M4: [initial verification](milestone-4-verification.md), [R1 verification](milestone-4-r1-verification.md), [R2 builder report](milestone-4-r2-report.md), [R2 remediation/handoff](milestone-4-r2-remediation.md). Consult acceptance above for the later outcome.
- Jellyfin contracts: [initial playback API baseline](milestone-4-api-baseline.md), [HLS API baseline](milestone-4-r1-api-baseline.md), [R2 contract findings](milestone-4-r2-remediation.md#exact-contract-and-parser-policy).

## M5 under independent review

The [M5 development branch](https://github.com/MatthewVillnave/openflix/tree/feat/milestone-5-multiple-servers) is frozen for review at `e08d799de9accf84b50ab4d9334b5dc4b6d712ce`; it is not part of accepted M4. Its [commit-pinned design and limitations](https://github.com/MatthewVillnave/openflix/blob/e08d799de9accf84b50ab4d9334b5dc4b6d712ce/docs/milestone-5-architecture.md) describe multiple Jellyfin backends, conservative provider-based grouping and source selection. Missing/conflicting identity evidence may leave duplicates separate. Automatic substitution requires explicit equivalent-edition evidence; ambiguous/untagged versions require explicit selection. Switching is before playback, never seamless midstream. This is aggregation, not federation.

After independent acceptance, reconcile the M5 README/status links and published release/verification instructions during its own integration. Do not reinterpret its builder readiness as independent acceptance or apply its cancellation behavior to the M4 tag. This documentation cleanup does not change the frozen M5 branch or artifact.
