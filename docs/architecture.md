# OpenFlix foundation architecture

Current Milestone 3 extends this foundation with [normalized catalog and synchronization](catalog.md); [M2 independent acceptance](milestone-2-audit-acceptance.md) and historical milestone reports retain their original scope.

The foundation below is the audited M1 design. M2 adds administrator-only connector routes, the real Jellyfin SDK connector, a versioned encrypted credential store and one connector migration. See [M2 security](connector-security.md) and [architecture decisions](architecture-notes.md#milestone-2-decisions).

The supplied [technical specification](technical-specification-v0.1.txt) is the architectural source of truth. Only section 57 is implemented. OpenFlix is a standalone application; it does not fork or modify Jellyfin.

- `apps/server`: Fastify HTTP API, validated configuration, Argon2id authentication, cookie sessions, operator CLI, process lifecycle.
- `apps/web`: React/Vite client; same-origin OpenFlix API only.
- `packages/database`: SQLite connection, versioned transactional migrations, typed repositories and parameterized statements.
- `packages/shared`: normalized domain types, independent of HTTP and upstream media servers.
- `packages/protocol`: local HTTP contracts; reserved location for later federation contracts.
- `packages/connector-core`: MediaConnector and opaque credential-storage interfaces.
- `packages/connector-jellyfin`: explicit unavailable factory, no SDK dependency or network calls.

Dependency direction: web → protocol → shared; server → database/protocol → shared; Jellyfin connector → connector-core → shared. The web must never import connector or database code. Upstream Jellyfin DTOs will stay inside connector-jellyfin.

Node 24 LTS and pnpm workspaces provide a small reproducible monorepo. Packages compile to ESM before their consumers. SQLite uses better-sqlite3 behind typed repositories, rather than adding an ORM for two tables. Versioned SQL migrations have checksums and an immediate transaction; edited, reordered, or unknown applied migrations fail startup. New schema is introduced only as a milestone requires it.

User provisioning is an explicit local operator command with a hidden password prompt. There is no signup or bootstrap HTTP endpoint, built-in account, or default password. Admin/user roles are stored, but no privileged HTTP operations exist yet. Authentication uses opaque random sessions, hashes their tokens in SQLite, and allows immediate revocation.

The production deployment uses a web container serving static assets and proxying `/api/` and `/health` to an internal server container. Both browser and API have the same public origin. Development uses Vite's equivalent proxy. TLS termination is the operator's responsibility.
