import { CatalogRepository } from './catalog.js';
export { catalogId } from './catalog.js';
import Database from 'better-sqlite3';
import { secureStorage } from './storage.js';
import type { User, ConnectorSummary } from '@openflix/shared';
import { migrate } from './migrations.js';
export { migrate, migrations } from './migrations.js';
export type { Migration } from './migrations.js';
export interface StoredUser extends User {
  passwordHash: string;
}
export interface StoredConnector extends ConnectorSummary {
  credentialEnvelope: string | null;
}
const connectorColumns = `id, type, name, base_url AS baseUrl, server_json AS serverJson,
  libraries_json AS librariesJson, state, last_error AS lastError,
  last_checked_at AS lastCheckedAt, created_at AS createdAt, credential_envelope AS credentialEnvelope`;
function connectorRow(row: unknown): StoredConnector | undefined {
  if (!row) return undefined;
  const { serverJson, librariesJson, ...record } = row as Omit<
    StoredConnector,
    'server' | 'libraries'
  > & { serverJson: string; librariesJson: string };
  return { ...record, server: JSON.parse(serverJson), libraries: JSON.parse(librariesJson) };
}
const userColumns = 'id, username, display_name AS displayName, role';
export function openDatabase(filename: string): OpenFlixDatabase {
  if (filename !== ':memory:') filename = secureStorage(filename);
  const db = new Database(filename);
  try {
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    db.pragma('journal_mode = WAL');
    migrate(db);
    return new OpenFlixDatabase(db);
  } catch (error) {
    db.close();
    throw error;
  }
}
export class OpenFlixDatabase {
  readonly catalog: CatalogRepository;
  constructor(private readonly db: Database.Database) {
    this.catalog = new CatalogRepository(db);
  }
  listConnectors(): StoredConnector[] {
    return this.db
      .prepare(`SELECT ${connectorColumns} FROM media_connectors ORDER BY created_at, id`)
      .all()
      .map((row) => connectorRow(row)!);
  }
  getConnector(id: string): StoredConnector | undefined {
    return connectorRow(
      this.db.prepare(`SELECT ${connectorColumns} FROM media_connectors WHERE id = ?`).get(id),
    );
  }
  insertConnector(record: ConnectorSummary, envelope: string): void {
    this.db
      .prepare(`INSERT INTO media_connectors VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        record.id,
        record.type,
        record.name,
        record.baseUrl,
        JSON.stringify(record.server),
        JSON.stringify(record.libraries),
        record.state,
        record.lastError,
        record.lastCheckedAt,
        record.createdAt,
        envelope,
      );
  }
  setConnectorCredential(id: string, envelope: string | null): void {
    this.db
      .prepare('UPDATE media_connectors SET credential_envelope = ? WHERE id = ?')
      .run(envelope, id);
  }
  updateConnector(record: ConnectorSummary): void {
    this.db
      .prepare(
        'UPDATE media_connectors SET server_json = ?, libraries_json = ?, state = ?, last_error = ?, last_checked_at = ? WHERE id = ?',
      )
      .run(
        JSON.stringify(record.server),
        JSON.stringify(record.libraries),
        record.state,
        record.lastError,
        record.lastCheckedAt,
        record.id,
      );
  }
  resetConnectorStates(): void {
    this.db.prepare("UPDATE media_connectors SET state = 'unverified', last_error = NULL").run();
  }
  removeConnector(id: string): void {
    this.db.prepare('DELETE FROM media_connectors WHERE id = ?').run(id);
  }
  close(): void {
    if (this.db.open) this.db.close();
  }
  healthy(): boolean {
    return (this.db.prepare('SELECT 1 AS ok').get() as { ok: number }).ok === 1;
  }
  createUser(user: StoredUser, now: number): void {
    this.db
      .prepare(
        'INSERT INTO users (id, username, display_name, role, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(user.id, user.username, user.displayName, user.role, user.passwordHash, now);
  }
  findUser(username: string): StoredUser | undefined {
    return this.db
      .prepare(`SELECT ${userColumns}, password_hash AS passwordHash FROM users WHERE username = ?`)
      .get(username) as StoredUser | undefined;
  }
  createSession(
    tokenHash: string,
    userId: string,
    now: number,
    expiresAt: number,
    previousHash?: string,
  ): void {
    this.db
      .transaction(() => {
        this.db.prepare('DELETE FROM user_sessions WHERE expires_at <= ?').run(now);
        if (previousHash) this.revokeSession(previousHash);
        // Bound persistent sessions to ten per user, including the new session.
        this.db
          .prepare(
            'DELETE FROM user_sessions WHERE user_id = ? AND token_hash NOT IN (SELECT token_hash FROM user_sessions WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 9)',
          )
          .run(userId, userId);
        this.db
          .prepare(
            'INSERT INTO user_sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
          )
          .run(tokenHash, userId, now, expiresAt);
      })
      .immediate();
  }
  sessionUser(tokenHash: string, now: number): User | undefined {
    return this.db
      .prepare(
        `SELECT u.id, u.username, u.display_name AS displayName, u.role
      FROM users u JOIN user_sessions s ON s.user_id = u.id WHERE s.token_hash = ? AND s.expires_at > ?`,
      )
      .get(tokenHash, now) as User | undefined;
  }
  revokeSession(tokenHash: string): void {
    this.db.prepare('DELETE FROM user_sessions WHERE token_hash = ?').run(tokenHash);
  }
}
