# Configuration and operations

The server loads `.env` from the repository root via Node's `--env-file-if-exists` flag in the pnpm scripts. Environment variables take precedence. The compiled Docker entrypoint reads its container environment directly. Unknown environment keys are ignored (normal operating-system variables remain usable); the values below are strictly validated. Values are never included in configuration errors.

| Variable                       | Default                 | Validation / purpose                                                                                                                                         |
| ------------------------------ | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `NODE_ENV`                     | `development`           | `development`, `test`, `production`                                                                                                                          |
| `OPENFLIX_BASE_URL`            | `http://localhost:5173` | Browser origin only; no userinfo, path, query or fragment. Explicit HTTPS required in production. HTTP allowed only for loopback origins outside production. |
| `OPENFLIX_HOST`                | `127.0.0.1`             | IPv4 or IPv6 bind address. Images use `0.0.0.0` inside the container network.                                                                                |
| `OPENFLIX_PORT`                | `8787`                  | Integer 1–65535                                                                                                                                              |
| `OPENFLIX_DATA_DIR`            | `.data`                 | Nonempty directory; relative paths resolve from the working directory. Database is `openflix.sqlite`.                                                        |
| `OPENFLIX_LOG_LEVEL`           | `info`                  | `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent`                                                                                                 |
| `OPENFLIX_SESSION_TTL_SECONDS` | `86400`                 | Absolute session lifetime, 300–604800 seconds                                                                                                                |
| `OPENFLIX_DEV_API_TARGET`      | `http://127.0.0.1:8787` | Vite process environment only; developer-controlled proxy destination, never a browser variable or production server setting.                                |

`OPENFLIX_MASTER_KEY` is intentionally not consumed in Milestone 1 because no connector secret storage exists. Do not provide connector credentials yet. Milestone 2 must define and validate encryption-key configuration. No session signing secret is needed: opaque random tokens are verified against their hashes in the database. Never put secrets into `VITE_*` variables; Vite can embed those in browser bundles.

## Database lifecycle

Startup creates the data directory, opens SQLite, enables foreign keys, WAL and a 5-second busy timeout, and applies migrations before listening. Migrations live in `packages/database/src/migrations.ts`, so SQL travels with the compiled package. Add a sequential migration; never edit one already applied. The ledger stores name, version and SHA-256 checksum. Every migration run is an immediate transaction. Drift or a database from a newer application version fails startup rather than silently rewriting state.

The database package creates private directories and verifies effective-runtime-UID ownership plus mode 0700 on every disk-backed open. Owned permissive directories are repaired; unsafe ownership, ineffective/denied correction, symlink data directories and unsafe ancestors fail closed. Use a dedicated directory, not `/tmp` itself or a filesystem root. Ancestors must be root/runtime-owned and not group/world writable, except sticky shared directories. Existing ancestor aliases are resolved to a validated canonical path. The package never recursively chmods unrelated directories or automatically changes ownership.

The primary database and existing `-wal`, `-shm` and `-journal` sidecars are inspected through non-symlink descriptors, required to be regular runtime-owned files without extra hard links, corrected to 0600 if necessary and verified before SQLite opens. Failures stop startup before migrations. Missing sidecars are not created. The private directory protects other SQLite auxiliary files as well. The server/CLI's existing umask 0077 is unchanged; package security does not depend on changing a caller's umask.

Use a local filesystem enforcing POSIX permissions, without extended ACL grants to unrelated users. Native Windows file-backed storage fails explicitly; use Linux containers there. In-memory databases remain available. Extended ACL management and filesystem permission emulation are not supported. See [security assumptions](security.md#database-storage-security-boundary).

Stop the server before copying the complete data directory/volume for backups (including WAL/SHM files if present). Restore with the service stopped and preserve ownership for the container's `node` user (UID 1000). Test a restore before relying on a backup. There is no live backup/export command yet. Never delete a Docker volume as part of a normal upgrade or restart.

## Sessions and shutdown

Successful login creates a new session and revokes the presented prior session. Ten simultaneous sessions per account are retained. Expired records are deleted on subsequent successful logins; expiry is enforced on every lookup regardless of cleanup. Logout immediately deletes the record. Restarting the server preserves unexpired sessions.

SIGINT/SIGTERM stop accepting work, close Fastify and SQLite, and have a 10-second hard deadline. Binding failure closes the database. No external services are contacted during startup.

Production rates are conservative: 120 requests/minute per observed IP, 10 login attempts/minute per observed IP, and at most four concurrent Argon2 verifications. Proxy forwarding headers are not trusted; through the supplied proxy all clients share its rate bucket. This prevents IP-spoofing bypasses but may throttle a household under heavy use. Trusted proxy configuration and distributed limits are deliberate future decisions.
