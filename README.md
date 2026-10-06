# OpenFlix

Milestones 1 and 2 are independently audited. [Milestone 2's published release](https://github.com/MatthewVillnave/openflix/releases/tag/openflix-v0.2-m2) freezes the real Jellyfin 10.11.11 integration. This development branch implements **Milestone 3: normalized catalog**, awaiting its own Optimus integration audit. Playback and federation are not implemented.

Provide a private operator-generated `OPENFLIX_MASTER_KEY` (base64 of 32 random bytes), provision an OpenFlix admin with `pnpm user:create <username> --admin`, and add Jellyfin in Settings → Media Servers. Use Catalog → Sync [server] to publish accessible library metadata. All signed-in OpenFlix users can browse it; choose the connector identity accordingly. Catalog persistence survives restart without an automatic rescan.

Read [catalog model and sync safety](docs/catalog.md), [catalog API baseline](docs/milestone-3-api-baseline.md), [M3 verification](docs/milestone-3-verification.md), [M3 report](docs/milestone-3-report.md), and [Optimus integration checks](docs/milestone-3-integration.md). [M2 acceptance](docs/milestone-2-audit-acceptance.md) carries forward the restricted-user and null-CollectionType notes.

A standalone, self-hosted media application. Jellyfin is a media backend behind `MediaConnector`; OpenFlix owns identity, sessions, its API, and its database.

The audited foundation provides authentication, SQLite persistence, web/API, migrations, tests and Docker. M2 adds administrator-managed Jellyfin connections; M3 adds item normalization, atomic synchronization and authenticated catalog browsing. No real media server is required for builder verification.

## Local setup

File-backed storage requires a filesystem that enforces POSIX permissions (macOS/Linux); use the Linux Docker deployment on Windows. The runtime-owned database directory is secured to mode 0700 and primary/known sidecar files to 0600 before use, or startup fails. Unsafe ancestors and wrong ownership are rejected. See [database operations](docs/configuration.md#database-lifecycle).

Requirements: Node **24.19.0** (`.nvmrc`), pnpm **11.19.0**, and Git. Native dependencies ship prebuilt binaries for supported platforms; building from source may require Python 3 and a C++ toolchain (Xcode command-line tools on macOS).

```sh
npm install --global pnpm@11.19.0
pnpm install --frozen-lockfile
cp .env.example .env
pnpm build
pnpm user:create alice --admin
pnpm dev
```

The account command prompts for a password and confirmation without echoing either. Use a unique password of at least 12 characters. Omit `--admin` for an ordinary account. There are no built-in credentials and no public registration. Run all commands from the repository root.

Open [http://localhost:5173](http://localhost:5173). Vite proxies the same-origin API to port 8787. Use `localhost`, not `127.0.0.1`, in the browser unless you also change `OPENFLIX_BASE_URL`. Shut down with Ctrl+C. Server/web source edits reload automatically; after changing a shared package, restart `pnpm dev` to rebuild packages. If you change the backend port, set `OPENFLIX_DEV_API_TARGET` for the Vite process too.

```sh
pnpm check          # production build, strict type checks (including tests), all tests
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
docker compose up --build -d --wait
docker compose exec server node dist/cli.js user:create alice --admin
```

Route your host reverse proxy to `127.0.0.1:8080`. The web container proxies API traffic to the internal server; port 8787 is not published. Configure TLS, HTTP-to-HTTPS redirection and HSTS on your outer proxy. `.env.example` is for local development: production deliberately rejects its HTTP origin. Shell environment overrides `.env` in Compose. Do not expose the development configuration to the internet.

```sh
curl --fail http://127.0.0.1:8080/health
docker compose logs server
docker compose down              # preserves the named data volume
```

Production images run as non-root with read-only root filesystems; only `/config` and temporary directories are writable. Normalized source/contracts are independent of the deployment. Run `pnpm verify:docker` for disposable production/development deployment checks, trusted HTTPS browser authentication, persistence/restarts, runtime privilege checks, and the full Linux test suite. See [M3 verification](docs/milestone-3-verification.md) and [the M3 report](docs/milestone-3-report.md). The [M1 report](docs/milestone-1-report.md) remains historical. On macOS, approve Docker access to the project folder when prompted for development source mounts.

## Repository

```text
apps/server/                  Fastify API, authentication, configuration, CLI
apps/web/                     React/Vite authentication, media-server administration and catalog
packages/connector-core/      Backend-neutral media and secret-store contracts
packages/connector-jellyfin/  Official SDK connector; normalized connection, library and paginated item operations
packages/protocol/            OpenFlix HTTP response/request contracts
packages/shared/              Normalized domain types
packages/database/            SQLite, migrations and repositories
tests/                        Unit, HTTP, persistence, process and UI tests
docker/                       Images, Nginx, development Compose and browser fixture
scripts/                      Reproducible Docker verification
.github/workflows/ci.yml       Build/test and Docker verification jobs
docs/                         Architecture, security, configuration and handoff
```

Read [architecture](docs/architecture.md), [configuration](docs/configuration.md), [security assumptions](docs/security.md), [API](docs/api.md), [architecture notes](docs/architecture-notes.md), and [the original specification](docs/technical-specification-v0.1.txt) before continuing. [Catalog baseline](docs/milestone-3-api-baseline.md) records the exact official API/SDK contracts. Historical M1/M2 reports remain unchanged; M3 has not been merged or tagged as audited.
