# OpenFlix v0.1 Milestone 1 completion report

## STATUS

**PARTIAL — implementation complete and local checks pass; Docker execution is unverified because this MacBook has no Docker CLI/daemon.** Milestone 2 has not begun. The repository includes Docker verification instructions and a CI job to close this specific gap.

## IMPLEMENTED

TypeScript/pnpm monorepo; Fastify HTTP server; responsive React/Vite client; SQLite repositories and transactional, checksummed migrations; validated configuration; Argon2id passwords; operator account provisioning; persisted, hashed, revocable cookie sessions; login/logout/current-user API; readiness; structured secret-safe logs; strict request validation, CSRF/origin checks, request/time/rate limits; bounded password work; graceful lifecycle; normalized media/connector interfaces; explicit unavailable Jellyfin factory; Docker development/production definitions and CI; configuration, architecture, security and continuation documentation.

## TEST RESULTS

- `pnpm install --frozen-lockfile`: passed.
- `pnpm check`: passed formatting, strict source/test type checks, production builds, **52 tests across 8 suites**.
- `pnpm audit --prod --json` and `pnpm audit --json`: **zero known vulnerabilities** at verification time.
- Standalone `pnpm deploy` production package: migration CLI succeeded and injected health returned HTTP 200.
- Real development browser smoke: provisioning, sign-in, persistence across reload and logout passed.
- `git diff --check`: passed; no runtime databases, dependencies, secrets or build output committed.
- Docker execution: **not run**. CI is supplied but has not been dispatched.

See [verification details](verification.md) for commands, test groups and resolved issues.

## FILES / STRUCTURE

The requested `apps/server`, `apps/web`, `packages/{connector-core,connector-jellyfin,protocol,shared,database}`, `docs`, `docker`, `docker-compose.yml`, and `README.md` exist. Important entrypoints are `apps/server/src/{main,app,auth,config,cli}.ts`; schema/migrations are in `packages/database/src`; browser UI is in `apps/web/src/App.tsx`. Tests live in `tests/`; CI lives in `.github/workflows/ci.yml`. The original specification is preserved in `docs/technical-specification-v0.1.txt`.

## ARCHITECTURE DECISIONS

Node 24 LTS; pnpm workspaces with ESM builds; prepared SQL repositories rather than an ORM; incremental tables only as needed; local CLI account provisioning; opaque server-side sessions; same-origin Vite/Nginx proxy topology; separate non-root web and server containers. No central services or live media backend are required.

## SECURITY NOTES

Argon2id with unique salts and 64 MiB/3 iterations; 256-bit session entropy with only digests in SQLite; Secure/HttpOnly/SameSite=Strict production cookies; HTTPS-only production origins; CSRF checks; no default account, public signup or authentication bypass; no secret-bearing request/error logging. Connector credentials cannot be saved in M1; M2 must implement authenticated encryption first. Threat assumptions and remaining identity/abuse protections are explicit in [security](security.md).

## DEVIATIONS FROM SPEC

- Used the specification's equivalent-database-layer allowance for prepared SQLite repositories instead of Drizzle.
- Deferred later tables, node keys and federation behavior according to the explicit milestone sequence and user's scope restriction.
- Health omits connector/peer counters because neither subsystem is implemented.
- Connector-secret persistence/encryption is an interface only, since actual connection storage belongs to M2.
- Installable/offline PWA behavior is not part of the foundation web client; it remains deferred.

These are recorded in [architecture notes](architecture-notes.md). There is no architectural redesign.

## KNOWN LIMITATIONS

Docker execution must be verified on a Docker-capable host. No Jellyfin integration, media administration, catalog, search, playback, profiles, event stream or federation is implemented. Password recovery/change, MFA, account-management UI and distributed/forwarded-client rate limiting are deferred. Public deployments require operator-managed TLS and security maintenance. Proxy clients currently share a rate-limit bucket. Image release tags are pinned, not immutable image digests.

## NEXT MILESTONE

First close the Docker verification gap. Then Milestone 2 should re-inspect the current official Jellyfin SDK and the actual server's matching OpenAPI; implement add/test/authenticate/library enumeration, encrypted credential save, disconnect/reconnect, and controlled integration tests. Keep Jellyfin DTOs inside its connector. Do not modify the live Jellyfin installation. Do not start catalog, playback or federation work during Milestone 2.
