# Architecture notes and future decisions

1. The spec's early federation descriptions mention v0.1, while sections 57–64 defer federation until v0.2. The explicit user scope and milestone sequence take precedence: no federation code, keys, discovery, peers, or federation tables are implemented.
2. The example database lists all future tables. Milestone 1 creates only users, user_sessions, and migration metadata. Catalog, connectors and playback will add migrations when their actual requirements are known.
3. Plain prepared SQLite repositories are the specification's "Drizzle ORM or equivalent" option. Database access stays behind a package so PostgreSQL can be assessed later, without pretending SQL dialects are interchangeable.
4. Health reports only database readiness. Connector/peer counts are omitted because those systems do not exist yet, rather than reporting simulated zero/healthy values.
5. Connector credentials have an opaque reference/storage interface only. No credentials can be persisted in M1. M2 must implement authenticated encryption, key validation, rotation/version metadata and fail-closed behavior before saving secrets.
6. M2 must re-inspect the current official SDK and version-matched OpenAPI before implementation. Do not assume the installed OptiPlex server version or copy SDK example logging of authentication responses.
7. Scan pagination/cancellation, normalized identity matching, streaming transport and source selection need decisions in their respective milestones. The initial MediaConnector preserves the supplied method signatures without implementing those features.

## Docker verification follow-up

The first real container start exposed a packaging error: `pnpm deploy --legacy` left the internal workspace packages linked to `/app/packages/*`, which is absent from the final production image. The local packaging smoke check had incorrectly passed because it could still reach the original checkout. Workspace dependencies now use pnpm injection with synchronization after builds, and deployment uses the isolated deploy implementation. The Docker build temporarily moves the source workspace aside and imports the deployed application as a regression check. This changes packaging only, not the application architecture. See [pnpm deployment documentation](https://pnpm.io/cli/deploy).

The local pnpm cache was also missing from `.dockerignore`, producing an unnecessary 159 MB build context. It is now excluded. Development containers explicitly drop Linux capabilities and set `no-new-privileges`, matching production's relevant restrictions while retaining the writable filesystem needed by development tools.

`scripts/verify-docker.mjs` owns only freshly named test projects and volumes. Its browser runs in a separate disposable image with a temporary CA trusted solely in that container; it never changes host certificate trust or disables HTTPS certificate verification. Chromium's OS sandbox is disabled only in this constrained, non-root test container, which visits the local fixture. The production images contain neither Chromium nor test CA material.

## Independent audit: existing database permissions

The audit reproduced an existing 0644 database remaining permissive because `openDatabase()` ignored EEXIST after exclusive creation. The narrow correction is to inspect, chmod when needed and recheck the actual file descriptor before SQLite opens it. Symlink/non-regular targets are rejected; failure closes the descriptor and prevents SQLite initialization. No table, repository, API or authentication contract changes.

macOS and Linux retain their supported behavior. Native Windows file-backed storage is explicitly refused because Node mode bits cannot prove owner-only ACL access; Linux containers are the supported Windows-host deployment path. R2 below supersedes the R1 directory/sidecar limitation. Explicit ACL grants and previously exposed copies remain outside POSIX mode enforcement. Supporting native Windows ACL management would require a separate, reviewed change, not a silent permission bypass.

## R2 re-audit: private storage boundary

The R1 primary descriptor check alone did not protect SQLite's later pathname open, and restored WAL/SHM could remain readable. R2 establishes a runtime-owned 0700 directory before file inspection and preserves R1's primary 0600 enforcement. Trusted ancestors prevent directory replacement; canonical paths permit normal macOS `/tmp` aliases, while final data-directory symlinks and unsafe ancestors fail closed. Sticky shared parents are supported because unrelated UIDs cannot replace an owned child there. No SQLite native-code or descriptor-passing redesign is needed under this boundary.

Known sidecars are normalized through non-following descriptors as defense in depth. Extra hard links and wrong file ownership are rejected to avoid changing an aliased/unowned target. The directory protects unknown auxiliary filenames. No new process-wide umask change, elevated runtime identity, new capability, schema change or later-milestone feature was introduced. Docker's owned `/config` is private from image creation, and existing owned volumes are normalized on startup. ACL management/native Windows security would require separate reviewed platform support.

## Milestone 2 decisions

M1 was published unchanged at `openflix-v0.1-m1-r2` before this development branch. Its first commit documents safe host TMPDIR ancestry. The connector uses the current official SDK's inspected authentication/system/user-view/session operations, with an isolated bounded Axios transport and response validation. A declaration-resolution issue requires explicit `.js` SDK module paths under NodeNext; no SDK fork or copied legacy endpoint implementation was introduced.

`ManagedMediaConnector` extends the existing normalized interface with server information and disconnect; later catalog/playback methods still fail explicitly without network work. A single migration adds connector configuration, encrypted credential envelope, normalized server/library metadata and state. No media catalog or library selection/sharing policy is introduced. Library metadata is visible only to OpenFlix admins.

Node AES-256-GCM uses an operator-supplied random key and context-bound versioned envelopes. No password is persisted. Startup authenticates local ciphertext and marks connections unverified; explicit reconnect avoids blocking startup on every LAN host or claiming cached state is live. Remote revocation is best effort and its result is reported honestly. Automated key rotation and background reconnect are deferred, with an envelope format supporting future reviewed migration.

Multiple injected workspace copies can have distinct Error constructors; normalized connector errors are recognized only by the closed code vocabulary and exact fixed message, preserving useful errors without serializing arbitrary SDK exceptions. R2 storage implementation is unchanged. See [connector security](connector-security.md) and [official baseline](jellyfin-preparation.md) for limits, including provisional 10.11 wire compatibility and required independent real-server audit.
