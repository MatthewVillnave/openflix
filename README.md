# OpenFlix

OpenFlix is a standalone, self-hosted media application. Jellyfin is a backend behind `MediaConnector`; OpenFlix owns its API, authentication, sessions and normalized SQLite catalog. The browser talks only to OpenFlix.

## Release and development status

**Milestones 1–5 are independently accepted within documented limits.** The licensed release is [OpenFlix Milestone 5 — Multi-Server Streaming](https://github.com/MatthewVillnave/openflix/releases/tag/openflix-v0.5-m5), under AGPL-3.0-only. The accepted implementation snapshot and the licensed release have distinct identities; see [M5 acceptance](docs/milestone-5-audit-acceptance.md). This is early-development software, not universal production compatibility or a professional security certification.

OpenFlix coordinates multiple Jellyfin servers in one installation. Open **Unified catalog** to browse grouped movies, series and episodes and select a source/version. Existing source/library browsing and audio playback remain available. Music, albums, artists, seasons and playlists retain [source-specific limits](docs/milestone-5-architecture.md). **Federation is not implemented.**

Grouping uses conservative provider evidence; missing or conflicting identifiers may leave duplicates separate. Automatic substitution requires matching explicit edition assertions and bounded duration evidence; these assertions do not prove identical timelines. Untagged/ambiguous versions require explicit source selection. Fallback occurs before playback, never seamlessly midstream. There is no persistent cross-server resume or full OpenFlix watch history.

Supported movies, episodes and audio use authenticated direct streaming or Jellyfin-managed HLS remux/transcoding. Optimus independently accepted controlled two-server tests and a separate household-plus-disposable installation. Household observations were short decoding/control tests, not sustained capacity measurements. See [the exact evidence and limitations](docs/milestone-5-audit-acceptance.md).

## Important limitations

- Playback is administrator-only; all authenticated users share imported catalog metadata. There is no per-user OpenFlix-to-Jellyfin identity mapping.
- Codec, source, resolution and HLS support are bounded. See [current playback scope](docs/status.md#playback-scope) before choosing media or hardware.
- Neither M4 nor M5 acceptance established Safari, actual iPhone behavior, audible-output confirmation or sustained household performance.
- Playback reporting can affect the connector account's Jellyfin watch state. Use an appropriately authorized account/content scope.
- Native Windows file-backed storage fails closed; use the documented Linux-container alternative.
- M5 distinguishes intentional cancellation from real timeout and cleans up grants before connector-token revocation. These are [M5 improvements](docs/playback-cancellation.md), not retroactive changes to the M4 tag. Household persistent watch-progress storage remains unverified.

The earlier R1 movie failed; the same movie played on R2. The exact historical cause remains unconfirmed, but that uncertainty was **not a remaining M4 acceptance blocker**. See [acceptance evidence and historical records](docs/status.md).

## Connect and use

Supply a private operator-generated `OPENFLIX_MASTER_KEY` (canonical base64 of 32 random bytes; no default). Keep it outside source control and separate from database backups. See [configuration and key requirements](docs/configuration.md#milestone-2-connector-key).

Provision an OpenFlix administrator, add Jellyfin through Settings → Media Servers, then use Catalog → Sync [server]. Catalog data survives restart without an automatic rescan. Administrators can prepare playback for supported movies, episodes and audio tracks; other users remain browse-only.

## Local setup

Before serving a deployment, configure the public build-time corresponding-source offer using [these version-specific instructions](docs/licensing.md#shipped-interface). Unknown/local builds do not automatically claim the upstream release as their source.

File-backed storage requires a filesystem that enforces POSIX permissions (macOS/Linux); use the Linux Docker deployment on Windows. The runtime-owned database directory is secured to mode 0700 and primary/known sidecar files to 0600 before use, or startup fails. Unsafe ancestors and wrong ownership are rejected. See [database operations](docs/configuration.md#database-lifecycle).

Requirements: Node **24.19.0** (`.nvmrc`), pnpm **11.19.0**, and Git. Native dependencies ship prebuilt binaries for supported platforms; building from source may require Python 3 and a C++ toolchain (Xcode command-line tools on macOS).

```sh
npm install --global pnpm@11.19.0
pnpm install --frozen-lockfile
cp .env.example .env
# Set OPENFLIX_MASTER_KEY in .env before adding a connector (see configuration guide).
pnpm build
pnpm user:create alice --admin
pnpm dev
```

The account command prompts for a password and confirmation without echoing either. Use a unique password of at least 12 characters. Omit `--admin` for an ordinary account. There are no built-in credentials and no public registration. Run all commands from the repository root.

Open [http://localhost:5173](http://localhost:5173). Vite proxies the same-origin API to port 8787. Use `localhost`, not `127.0.0.1`, in the browser unless you also change `OPENFLIX_BASE_URL`. Shut down with Ctrl+C. Server/web source edits reload automatically; after changing a shared package, restart `pnpm dev` to rebuild packages. If you change the backend port, set `OPENFLIX_DEV_API_TARGET` for the Vite process too.

```sh
pnpm test           # builds packages/server, runs all tests
pnpm db:migrate     # explicitly apply pending migrations; startup also applies them
pnpm build
pnpm start          # compiled server; web assets require a web server/proxy
```

Tests use disposable SQLite databases and local Jellyfin protocol fixtures; they do not contact a household server. Lifecycle tests need permission to bind loopback sockets and signal their own child processes.

## Docker

Requires Docker Engine/Desktop and Docker Compose v2. Docker is not bundled or installed by this project.

For local development:

```sh
docker compose -f docker/compose.dev.yml up --build -d
docker compose -f docker/compose.dev.yml exec server pnpm --filter @openflix/server user:create alice --admin
# Open http://localhost:5173
docker compose -f docker/compose.dev.yml down
```

This is a standalone Compose file with a separate development data volume. Server/web source directories are mounted for reloads; rebuild containers after shared package or dependency changes.

For production behind an HTTPS reverse proxy:

```sh
# Set this to your actual public HTTPS origin (no path).
export OPENFLIX_BASE_URL=https://openflix.example.com
# Supply OPENFLIX_MASTER_KEY securely through the environment or private .env.
docker compose up --build -d --wait
docker compose exec server node dist/cli.js user:create alice --admin
```

Route your host reverse proxy to `127.0.0.1:8080`. The web container proxies API traffic to the internal server; port 8787 is not published. Configure TLS, HTTP-to-HTTPS redirection and HSTS on your outer proxy. `.env.example` is for local development: production deliberately rejects its HTTP origin. Shell environment overrides `.env` in Compose. Do not expose the development configuration to the internet.

```sh
curl --fail http://127.0.0.1:8080/health
docker compose logs server
docker compose down              # preserves the named data volume
```

Production images run as non-root with read-only root filesystems; only `/config` and temporary directories are writable. Normalized source/contracts are independent of the deployment. Run `pnpm verify:docker` for disposable production/development deployment checks, trusted HTTPS browser authentication, persistence/restarts, runtime privilege checks, and the full Linux test suite. See [current verification instructions](docs/status.md#verification). The [M1 report](docs/milestone-1-report.md) remains historical. On macOS, approve Docker access to the project folder when prompted for development source mounts.

## Verification

Use Node 24.19.0 and pnpm 11.19.0. Host tests require a private runtime-owned temporary directory beneath trusted ancestors; a system `TMPDIR` under an unsafe ancestor can correctly fail storage checks. For macOS, or Linux with a trusted `/tmp`:

```sh
verification_tmp=$(mktemp -d /tmp/openflix-verification.XXXXXX)
chmod 700 "$verification_tmp"
TMPDIR="$verification_tmp" pnpm check
rmdir "$verification_tmp"
```

`pnpm check` checks formatting, production builds, strict types and all tests. If interrupted tests leave files, inspect that specific temporary directory before removing it. Do not change shared-directory permissions or weaken storage checks. See [verification commands and prerequisites](docs/status.md#verification) for Docker, disposable Jellyfin, dependency audits and the Git-history-dependent upgrade check. Builder fixtures do not contact household Jellyfin.

## Documentation and structure

Read [license and source-availability guidance](docs/licensing.md) before distributing or serving a build. First-party material is licensed under GNU AGPL version 3 only; third-party licenses remain intact.

Start with the [current status/documentation index](docs/status.md), [architecture](docs/architecture.md), [configuration](docs/configuration.md), [security](docs/security.md), [connector security](docs/connector-security.md), [catalog](docs/catalog.md) and [API](docs/api.md). Historical reports retain their original verdicts; later acceptance is recorded separately.

- `apps/server`, `apps/web`: Fastify API and React/Vite UI.
- `packages/connector-core`, `packages/connector-jellyfin`: normalized contracts and isolated Jellyfin adapter.
- `packages/shared`, `packages/protocol`, `packages/database`: domain/API types, SQLite and migrations.
- `tests`, `scripts`, `docker`, `.github/workflows`: reproducible verification and deployment.
- `docs`: guides, [architecture decisions](docs/architecture-notes.md) and [original specification](docs/technical-specification-v0.1.txt).
