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
