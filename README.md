# OpenFlix

A standalone, self-hosted media application. Jellyfin will be a media backend behind `MediaConnector`; OpenFlix owns identity, sessions, its API, and its database.

**Milestone 1 only:** working authentication, SQLite persistence, web client, HTTP server, configuration, migrations, tests and Docker definitions. **No Jellyfin connection, catalog, playback, or federation exists yet.** No access to a real media server is required.

## Local setup

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

Tests use disposable temporary SQLite databases and do not contact Jellyfin. Lifecycle tests need permission to bind loopback sockets and signal their own child processes.

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

Production images run as non-root with read-only root filesystems; only `/config` and temporary directories are writable. Normalized source/contracts are independent of the deployment. Docker configuration is supplied with CI smoke checks, but was **not executed on the initial MacBook build because Docker was unavailable**. See [verification](docs/verification.md).

## Repository

```text
apps/server/                  Fastify API, authentication, configuration, CLI
apps/web/                     React/Vite sign-in and account view
packages/connector-core/      Backend-neutral media and secret-store contracts
packages/connector-jellyfin/  Explicitly unimplemented factory
packages/protocol/            OpenFlix HTTP response/request contracts
packages/shared/              Normalized domain types
packages/database/            SQLite, migrations and repositories
tests/                        Unit, HTTP, persistence, process and UI tests
docker/                       Dockerfile, Nginx, development Compose
.github/workflows/ci.yml       Build/test and Docker verification jobs
docs/                         Architecture, security, configuration and handoff
```

Read [architecture](docs/architecture.md), [configuration](docs/configuration.md), [security assumptions](docs/security.md), [API](docs/api.md), [architecture notes](docs/architecture-notes.md), and [the original specification](docs/technical-specification-v0.1.txt) before continuing. [Milestone 2 preparation](docs/jellyfin-preparation.md) describes what to inspect next. The [completion report](docs/milestone-1-report.md) records exactly what was verified.
