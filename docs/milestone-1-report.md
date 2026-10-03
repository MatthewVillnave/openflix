# OpenFlix v0.1 Milestone 1 completion report

## STATUS

**PASS — Milestone 1 implementation and Docker deployment verified on 2026-10-03.** The production and development Compose stacks were executed on this MacBook using Docker Desktop, including real Linux native dependencies and trusted HTTPS browser authentication. Milestone 2 has not begun; the live Jellyfin installation was not accessed or modified.

## IMPLEMENTED

TypeScript/pnpm monorepo; Fastify HTTP server; responsive React/Vite client; SQLite repositories and transactional, checksummed migrations; validated configuration; Argon2id passwords; operator account provisioning; persisted, hashed, revocable cookie sessions; login/logout/current-user API; readiness; structured secret-safe logs; strict request validation, CSRF/origin checks, request/time/rate limits; bounded password work; graceful lifecycle; normalized media/connector interfaces; explicit unavailable Jellyfin factory; verified Docker development/production deployments, a reproducible container/browser verification script and CI; configuration, architecture, security and continuation documentation.

## TEST RESULTS

- `pnpm install --frozen-lockfile --store-dir .pnpm-store`: passed with the committed lockfile.
- `pnpm verify:docker`: **PASS, 13 check groups**, exit 0. Server, web, browser-test and development images built; clean-volume migrations and repeated migration CLI passed; SQLite integrity/private permissions passed; health, frontend/assets, API proxy, CSP, auth failures and CSRF checks passed.
- Container persistence: account, session, migration ledger and `/config` marker survived container restart, clean stop/start, and Compose down/up with replacement containers. Clean shutdown exit codes were 0; no OOM kills. Session revocation passed.
- Real Chromium **154.0.8037.92** over trusted fixture HTTPS: sign-in, reload persistence, sign-out, Secure/HttpOnly/SameSite cookies, no credential localStorage and no JavaScript errors passed.
- Runtime inspection: production and development containers ran non-root with zero effective capabilities and no-new-privileges; no privileged mode, host namespaces or Docker socket. Production root filesystems rejected writes; only the frontend was published, on loopback. Collected production logs were structured and free of application errors and tested secret canaries.
- Development Compose: Vite frontend and proxied health passed. `docker compose ... run --rm --no-deps -T server pnpm check` passed **52 tests across 8 suites**, production builds, strict source/test types and formatting inside Linux/ARM64.
- Final host `pnpm check`: passed formatting, strict source/test types, production builds and **52 tests across 8 suites** after Docker verification.
- `pnpm audit --prod --json` and `pnpm audit --json`: **zero known vulnerabilities** at verification time (104 production / 266 total dependencies reported).
- `node --check scripts/verify-docker.mjs`, `node --check docker/verify-browser.mjs` and `git diff --check`: passed. No runtime databases, dependencies, secrets or build output committed.
- Disposable verification containers, networks and volumes were removed; unrelated Docker resources were preserved. CI uses the same Docker verifier, but a remote CI run was not dispatched.

See [verification details](verification.md) for commands, test groups and resolved issues.

## FILES / STRUCTURE

The requested `apps/server`, `apps/web`, `packages/{connector-core,connector-jellyfin,protocol,shared,database}`, `docs`, `docker`, `docker-compose.yml`, and `README.md` exist. Important entrypoints are `apps/server/src/{main,app,auth,config,cli}.ts`; schema/migrations are in `packages/database/src`; browser UI is in `apps/web/src/App.tsx`. Tests live in `tests/`; container orchestration checks are in `scripts/verify-docker.mjs`; trusted HTTPS/browser checks are in `docker/verify-browser.mjs` with `docker/compose.verify.yml`; CI lives in `.github/workflows/ci.yml`. The original specification is preserved in `docs/technical-specification-v0.1.txt`.

## ARCHITECTURE DECISIONS

Node 24 LTS; pnpm workspaces with ESM builds; prepared SQL repositories rather than an ORM; incremental tables only as needed; local CLI account provisioning; opaque server-side sessions; same-origin Vite/Nginx proxy topology; separate non-root web and server containers. Workspace dependencies are injected and synchronized after builds so the production deployment is self-contained. A separate, disposable HTTPS/browser image verifies production cookie behavior without adding a browser or CA to production images. No central services or live media backend are required.

## SECURITY NOTES

Argon2id with unique salts and 64 MiB/3 iterations; 256-bit session entropy with only digests in SQLite; Secure/HttpOnly/SameSite=Strict production cookies; HTTPS-only production origins; CSRF checks; no default account, public signup or authentication bypass; no secret-bearing request/error logging. Connector credentials cannot be saved in M1; M2 must implement authenticated encryption first. Production uses read-only root filesystems, non-root users, dropped capabilities and loopback-only publishing; these were inspected at runtime. Test CA trust is confined to the disposable browser container. Chromium's OS sandbox is disabled only inside that constrained test fixture. Threat assumptions and remaining identity/abuse protections are explicit in [security](security.md).

## DEVIATIONS FROM SPEC

- Used the specification's equivalent-database-layer allowance for prepared SQLite repositories instead of Drizzle.
- Deferred later tables, node keys and federation behavior according to the explicit milestone sequence and user's scope restriction.
- Health omits connector/peer counters because neither subsystem is implemented.
- Connector-secret persistence/encryption is an interface only, since actual connection storage belongs to M2.
- Installable/offline PWA behavior is not part of the foundation web client; it remains deferred.

Docker testing exposed a deployment packaging defect: legacy pnpm deployment linked internal packages outside the final image. Switching to injected dependencies and isolated deployment was the smallest correction; a source-removal import check guards against recurrence. The local pnpm cache is now excluded from the Docker build context. Development containers now explicitly drop capabilities and enable no-new-privileges. These findings and the existing scope decisions are recorded in [architecture notes](architecture-notes.md). There is no architectural redesign.

## KNOWN LIMITATIONS

Docker was verified on Linux/ARM64 through this MacBook; other architectures and remote CI are not claimed as tested. The HTTPS fixture does not validate an operator's public DNS/certificate/proxy configuration. No Jellyfin integration, media administration, catalog, search, playback, profiles, event stream or federation is implemented. Password recovery/change, MFA, account-management UI and distributed/forwarded-client rate limiting are deferred. Public deployments require operator-managed TLS and security maintenance. Proxy clients currently share a rate-limit bucket. Image release tags are pinned, not immutable image digests.

## NEXT MILESTONE

Milestone 2 should re-inspect the current official Jellyfin SDK and the actual server's matching OpenAPI; implement add/test/authenticate/library enumeration, encrypted credential save, disconnect/reconnect, and controlled integration tests. Keep Jellyfin DTOs inside its connector. Do not modify the live Jellyfin installation. Do not start catalog, playback or federation work during Milestone 2.
