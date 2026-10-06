import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
export interface Migration {
  version: number;
  name: string;
  sql: string;
}
export const migrations: readonly Migration[] = [
  {
    version: 1,
    name: 'identity',
    sql: `
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin', 'user')),
  created_at INTEGER NOT NULL
) STRICT;
CREATE TABLE user_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK(expires_at > created_at)
) STRICT;
CREATE INDEX user_sessions_user ON user_sessions(user_id);
CREATE INDEX user_sessions_expiry ON user_sessions(expires_at);
`,
  },
  {
    version: 2,
    name: 'media_connectors',
    sql: `
CREATE TABLE media_connectors (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type = 'jellyfin'),
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  server_json TEXT NOT NULL,
  libraries_json TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('unverified', 'connected', 'error')),
  last_error TEXT,
  last_checked_at INTEGER,
  created_at INTEGER NOT NULL,
  credential_envelope TEXT
) STRICT;
`,
  },
  {
    version: 3,
    name: 'normalized_catalog',
    sql: `
CREATE TABLE catalog_libraries (
  id TEXT PRIMARY KEY,
  connector_id TEXT NOT NULL REFERENCES media_connectors(id) ON DELETE CASCADE,
  upstream_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  upstream_type TEXT,
  last_synced_at INTEGER NOT NULL,
  UNIQUE(connector_id, upstream_id),
  UNIQUE(id, connector_id)
) STRICT;
CREATE TABLE catalog_items (
  id TEXT PRIMARY KEY,
  connector_id TEXT NOT NULL REFERENCES media_connectors(id) ON DELETE CASCADE,
  upstream_id TEXT NOT NULL,
  type TEXT NOT NULL,
  sort_title TEXT NOT NULL,
  parent_id TEXT,
  series_id TEXT,
  season_id TEXT,
  album_id TEXT,
  metadata_json TEXT NOT NULL,
  synced_at INTEGER NOT NULL,
  UNIQUE(connector_id, upstream_id),
  UNIQUE(id, connector_id)
) STRICT;
CREATE INDEX catalog_items_type ON catalog_items(connector_id, type, sort_title, id);
CREATE INDEX catalog_items_parent ON catalog_items(parent_id);
CREATE INDEX catalog_items_series ON catalog_items(series_id);
CREATE INDEX catalog_items_season ON catalog_items(season_id);
CREATE INDEX catalog_items_album ON catalog_items(album_id);
CREATE TABLE catalog_memberships (
  library_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  connector_id TEXT NOT NULL,
  PRIMARY KEY(library_id, item_id),
  FOREIGN KEY(library_id, connector_id) REFERENCES catalog_libraries(id, connector_id) ON DELETE CASCADE,
  FOREIGN KEY(item_id, connector_id) REFERENCES catalog_items(id, connector_id) ON DELETE CASCADE
) STRICT;
CREATE INDEX catalog_memberships_item ON catalog_memberships(item_id);
CREATE TABLE catalog_sync (
  connector_id TEXT PRIMARY KEY REFERENCES media_connectors(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK(state IN ('syncing', 'successful', 'failed')),
  library_id TEXT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  last_successful_at INTEGER,
  error TEXT
) STRICT;
CREATE TABLE catalog_stage_libraries (
  run_id TEXT NOT NULL REFERENCES catalog_sync(run_id) ON DELETE CASCADE,
  upstream_id TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  PRIMARY KEY(run_id, upstream_id)
) STRICT;
CREATE TABLE catalog_stage_items (
  run_id TEXT NOT NULL REFERENCES catalog_sync(run_id) ON DELETE CASCADE,
  upstream_id TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  PRIMARY KEY(run_id, upstream_id)
) STRICT;
CREATE TABLE catalog_stage_memberships (
  run_id TEXT NOT NULL,
  library_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  PRIMARY KEY(run_id, library_id, item_id),
  FOREIGN KEY(run_id, library_id) REFERENCES catalog_stage_libraries(run_id, upstream_id) ON DELETE CASCADE,
  FOREIGN KEY(run_id, item_id) REFERENCES catalog_stage_items(run_id, upstream_id) ON DELETE CASCADE
) STRICT;
`,
  },
];
export function migrate(
  db: Database.Database,
  definitions: readonly Migration[] = migrations,
): void {
  db.transaction(() => {
    db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at INTEGER NOT NULL
    ) STRICT`);
    const applied = db
      .prepare('SELECT version, name, checksum FROM schema_migrations ORDER BY version')
      .all() as { version: number; name: string; checksum: string }[];
    if (applied.length > definitions.length)
      throw new Error('Unknown database migration; refusing downgrade');
    for (const [index, migration] of definitions.entries()) {
      if (migration.version !== index + 1)
        throw new Error('Migrations must be contiguous and ordered');
      const checksum = createHash('sha256').update(migration.sql).digest('hex');
      const existing = applied[index];
      if (existing) {
        if (
          existing.version !== migration.version ||
          existing.name !== migration.name ||
          existing.checksum !== checksum
        ) {
          throw new Error('Applied migration differs from source');
        }
      } else {
        db.exec(migration.sql);
        db.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?, ?)').run(
          migration.version,
          migration.name,
          checksum,
          Date.now(),
        );
      }
    }
  }).immediate();
}
