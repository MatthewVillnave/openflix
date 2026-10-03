# Architecture notes and future decisions

1. The spec's early federation descriptions mention v0.1, while sections 57–64 defer federation until v0.2. The explicit user scope and milestone sequence take precedence: no federation code, keys, discovery, peers, or federation tables are implemented.
2. The example database lists all future tables. Milestone 1 creates only users, user_sessions, and migration metadata. Catalog, connectors and playback will add migrations when their actual requirements are known.
3. Plain prepared SQLite repositories are the specification's "Drizzle ORM or equivalent" option. Database access stays behind a package so PostgreSQL can be assessed later, without pretending SQL dialects are interchangeable.
4. Health reports only database readiness. Connector/peer counts are omitted because those systems do not exist yet, rather than reporting simulated zero/healthy values.
5. Connector credentials have an opaque reference/storage interface only. No credentials can be persisted in M1. M2 must implement authenticated encryption, key validation, rotation/version metadata and fail-closed behavior before saving secrets.
6. M2 must re-inspect the current official SDK and version-matched OpenAPI before implementation. Do not assume the installed OptiPlex server version or copy SDK example logging of authentication responses.
7. Scan pagination/cancellation, normalized identity matching, streaming transport and source selection need decisions in their respective milestones. The initial MediaConnector preserves the supplied method signatures without implementing those features.
