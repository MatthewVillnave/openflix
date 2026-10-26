import { WorkRepository } from './works.js';
export { providerIdentity, workIdentity, versionIdentity } from './works.js';
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
  ownerUserId: string | null;
}
const connectorColumns = `id, type, name, base_url AS baseUrl, server_json AS serverJson,
  libraries_json AS librariesJson, state, last_error AS lastError,
  last_checked_at AS lastCheckedAt, created_at AS createdAt, credential_envelope AS credentialEnvelope, owner_user_id AS ownerUserId`;
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
  readonly works: WorkRepository;
  constructor(
    private readonly db: Database.Database,
    private readonly ownerUserId?: string,
  ) {
    this.catalog = new CatalogRepository(db, ownerUserId);
    this.works = new WorkRepository(db, ownerUserId);
    if (ownerUserId === undefined) this.works.backfill();
  }
  forUser(userId: string): OpenFlixDatabase {
    if (!userId) throw new Error('User scope required');
    return new OpenFlixDatabase(this.db, userId);
  }
  transaction<T>(action: () => T): T {
    return this.db.transaction(action).immediate();
  }
  approvedServers(): Array<{ baseUrl: string; serverId: string; name: string }> {
    return this.db
      .prepare(
        'SELECT base_url AS baseUrl,server_id AS serverId,name FROM approved_media_servers ORDER BY name,base_url',
      )
      .all() as Array<{ baseUrl: string; serverId: string; name: string }>;
  }
  approveServer(baseUrl: string, serverId: string, name: string): void {
    const old = this.approvedServers().find((s) => s.baseUrl === baseUrl);
    if (old && old.serverId !== serverId) throw new Error('Server identity changed');
    this.db
      .prepare(
        'INSERT INTO approved_media_servers VALUES (?,?,?) ON CONFLICT(base_url) DO UPDATE SET name=excluded.name',
      )
      .run(baseUrl, serverId, name);
  }
  forgetApprovedServer(baseUrl: string, serverId: string): 'removed' | 'in_use' | 'not_found' {
    return this.db
      .transaction(() => {
        const approval = this.db
          .prepare('SELECT server_id AS id FROM approved_media_servers WHERE base_url=?')
          .get(baseUrl) as { id: string } | undefined;
        if (!approval || approval.id !== serverId) return 'not_found';
        if (this.db.prepare('SELECT 1 FROM media_connectors WHERE base_url=? LIMIT 1').get(baseUrl))
          return 'in_use';
        this.db
          .prepare('DELETE FROM approved_media_servers WHERE base_url=? AND server_id=?')
          .run(baseUrl, serverId);
        return 'removed';
      })
      .immediate();
  }
  resume(itemId: string): { positionMs: number; durationMs: number } | undefined {
    if (!this.ownerUserId || !this.catalog.item(itemId)) return;
    return this.db
      .prepare(
        'SELECT position_ms AS positionMs,duration_ms AS durationMs FROM personal_resume WHERE user_id=? AND item_id=?',
      )
      .get(this.ownerUserId, itemId) as { positionMs: number; durationMs: number } | undefined;
  }
  saveResume(itemId: string, positionMs: number, durationMs: number): void {
    if (
      !this.ownerUserId ||
      !this.catalog.item(itemId) ||
      !Number.isFinite(positionMs) ||
      !Number.isFinite(durationMs) ||
      positionMs < 0 ||
      durationMs < 1 ||
      positionMs > durationMs
    )
      return;
    this.db
      .prepare(
        'INSERT INTO personal_resume VALUES (?,?,?,?,?) ON CONFLICT(user_id,item_id) DO UPDATE SET position_ms=excluded.position_ms,duration_ms=excluded.duration_ms,updated_at=excluded.updated_at',
      )
      .run(
        this.ownerUserId,
        itemId,
        Math.round(positionMs >= durationMs - 1000 ? 0 : positionMs),
        Math.round(durationMs),
        Date.now(),
      );
  }
  listConnectors(): StoredConnector[] {
    return this.db
      .prepare(
        `SELECT ${connectorColumns} FROM media_connectors WHERE (? IS NULL OR owner_user_id=?) ORDER BY created_at, id`,
      )
      .all(this.ownerUserId ?? null, this.ownerUserId ?? null)
      .map((row) => connectorRow(row)!);
  }
  getConnector(id: string): StoredConnector | undefined {
    return connectorRow(
      this.db
        .prepare(
          `SELECT ${connectorColumns} FROM media_connectors WHERE id = ? AND (? IS NULL OR owner_user_id=?)`,
        )
        .get(id, this.ownerUserId ?? null, this.ownerUserId ?? null),
    );
  }
  insertConnector(
    record: ConnectorSummary,
    envelope: string,
    ownerUserId: string | null = null,
  ): void {
    this.db
      .prepare(
        `INSERT INTO media_connectors (id,type,name,base_url,server_json,libraries_json,state,last_error,last_checked_at,created_at,credential_envelope,owner_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
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
        ownerUserId,
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
    this.db
      .transaction(() => {
        this.db.prepare('DELETE FROM media_connectors WHERE id = ?').run(id);
        this.works.prune();
      })
      .immediate();
  }
  close(): void {
    if (this.db.open) this.db.close();
  }
  healthy(): boolean {
    return (this.db.prepare('SELECT 1 AS ok').get() as { ok: number }).ok === 1;
  }
  hasUsers(): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM users LIMIT 1').get());
  }
  createFirstOwner(user: StoredUser, now: number): boolean {
    return (
      this.db
        .prepare(
          'INSERT INTO users (id, username, display_name, role, password_hash, created_at) SELECT ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM users)',
        )
        .run(user.id, user.username, user.displayName, user.role, user.passwordHash, now)
        .changes === 1
    );
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
