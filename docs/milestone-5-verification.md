# M5 reproduction and independent audit

Use Node from .nvmrc, pnpm from package.json, and a safe private TMPDIR whose
ancestors satisfy the audited storage boundary. See the existing verification
documents for macOS/Docker prerequisites.

Run heavy verifiers sequentially:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm exec vitest run tests/works.test.ts tests/source-selection.test.ts tests/unified-web.test.tsx tests/playback-cancellation.test.ts tests/playback-http.test.ts
node scripts/verify-m4-upgrade.mjs
node scripts/verify-docker.mjs
node scripts/verify-jellyfin-hls.mjs
node scripts/verify-multiple-jellyfin.mjs
pnpm audit --prod --audit-level=high
pnpm audit --audit-level=high
```

The upgrade verifier requires Git history containing exact accepted M4 commit
e975e3bd38cb3627b2fa3053bdb3e137c4450764. A source ZIP does not contain .git.
Run that check in an exact-commit Git checkout, not by pretending an extraction
has history. Earlier milestone verifiers and reports remain historical;
the current migration ledger has four entries, with the original three unchanged.

The new two-server verifier creates randomly named disposable Compose projects,
separate Jellyfin databases/cache volumes/identities/ports/passwords, and generated
media. It configures restricted users only in those fresh servers. It accepts no
household URL. All volumes it removes belong to its own project. It needs Docker,
network access to pinned build images/packages, and enough CPU for two Jellyfin
instances plus Chromium. Media generation uses FFmpeg in a disposable build stage;
OpenFlix does not transcode media.

## Optimus checklist

- Verify the ZIP checksum and source inventory, exact commit, clean extraction.
- Reproduce full, focused, historical Docker, real single-Jellyfin and new
  two-Jellyfin verifiers; inspect exact assertion totals rather than HTTP 200 alone.
- Reproduce accepted-M4 migration in an exact-commit checkout; original users,
  sessions, credential envelope, source IDs and old migration checksums survive.
- Confirm repeated sync/restart and opposite scan order preserve group identities.
- Confirm same-title conflicts, partial IDs, namespace/type collisions, ambiguous
  episodes, and unspecified/different editions do not silently substitute sources.
- Confirm generated MP4 on A and equivalent MKV on B both decode, progress, pause,
  seek and report; automatic selection prefers direct, and unavailable A permits
  pre-grant fallback to equivalent B.
- Verify restricted views, duplicate memberships, source counts and safe labels.
- Verify removal/revocation of A cannot delete or use B's credential, media or job;
  grants never switch backend midstream.
- Repeat original-login/ordinary-user/forged member/expiry/logout/cancellation
  checks. Genuine upstream timeouts must still be reported separately.
- Inspect browser/API/log output for credentials, internal paths and raw upstream
  URLs; media bytes remain same-origin and authenticated.
- Verify main/audit tags and the accepted M4 release artifact remain unchanged.
- Household regression, if performed, needs an authorized account/content scope.
  No second household server or hardware purchase is required. Do not modify users,
  files, permissions, plugins or hardware settings to obtain a passing result.
- Keep Safari/iPhone, audible output, sustained household performance and unavailable
  codec examples explicitly untested unless separately exercised. Generated
  two-server success is builder evidence, not independent household acceptance.
