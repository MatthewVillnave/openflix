import Database from 'better-sqlite3';
import { mkdirSync, openSync, closeSync, fstatSync, fchmodSync, constants } from 'node:fs';
import { dirname } from 'node:path';
import type { User } from '@openflix/shared';
import { migrate } from './migrations.js';
export { migrate, migrations } from './migrations.js';
export type { Migration } from './migrations.js';
export interface StoredUser extends User {
  passwordHash: string;
}
const userColumns = 'id, username, display_name AS displayName, role';
export function openDatabase(filename: string): OpenFlixDatabase {
  if (filename !== ':memory:') {
    // Node's Windows mode bits cannot establish owner-only ACL access.
    if (process.platform === 'win32') {
      throw new Error('File-backed databases require POSIX permissions; use a Linux container.');
    }
    mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
    const fd = openSync(
      filename,
      constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      0o600,
    );
    try {
      const info = fstatSync(fd);
      if (!info.isFile()) throw new Error('Database must be a regular file.');
      // Work on the inspected inode, never chmod a path that could be a symlink.
      if ((info.mode & 0o7777) !== 0o600) fchmodSync(fd, 0o600);
      if ((fstatSync(fd).mode & 0o7777) !== 0o600) {
        throw new Error('Cannot establish database permissions 0600.');
      }
    } finally {
      closeSync(fd);
    }
  }
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
  constructor(private readonly db: Database.Database) {}
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
