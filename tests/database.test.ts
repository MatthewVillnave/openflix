import Database from 'better-sqlite3';
import { statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { openDatabase, migrate, migrations } from '../packages/database/dist/index.js';
import { temporaryConfig } from './helpers.js';
describe('database migrations and storage', () => {
  it('initializes, reopens, preserves data and creates private files', () => {
    const fixture = temporaryConfig();
    try {
      let db = openDatabase(fixture.config.databasePath);
      expect(db.healthy()).toBe(true);
      db.createUser(
        {
          id: 'one',
          username: 'alice',
          displayName: 'Alice',
          role: 'user',
          passwordHash: 'test-hash',
        },
        1,
      );
      db.close();
      db = openDatabase(fixture.config.databasePath);
      expect(db.findUser('ALICE')?.id).toBe('one');
      expect(statSync(fixture.config.databasePath).mode & 0o777).toBe(0o600);
      db.close();
      const raw = new Database(fixture.config.databasePath);
      expect(raw.prepare('SELECT count(*) AS n FROM schema_migrations').get()).toEqual({ n: 4 });
      raw.close();
    } finally {
      fixture.cleanup();
    }
  });
  it('rejects edited and unknown applied migrations', () => {
    const db = new Database(':memory:');
    try {
      migrate(db);
      expect(() =>
        migrate(db, [
          { ...migrations[0]!, sql: migrations[0]!.sql + '-- changed' },
          migrations[1]!,
          migrations[2]!,
          migrations[3]!,
        ]),
      ).toThrow('differs');
      expect(() => migrate(db, [])).toThrow('downgrade');
      expect(() =>
        migrate(db, [
          { ...migrations[0]!, version: 2 },
          migrations[1]!,
          migrations[2]!,
          migrations[3]!,
        ]),
      ).toThrow('ordered');
    } finally {
      db.close();
    }
  });
  it('rolls back a failed multi-statement migration without advancing metadata', () => {
    const db = new Database(':memory:');
    try {
      migrate(db);
      expect(() =>
        migrate(db, [
          ...migrations,
          { version: 5, name: 'broken', sql: 'CREATE TABLE rollback_probe(id TEXT); INVALID SQL;' },
        ]),
      ).toThrow();
      expect(
        db.prepare("SELECT name FROM sqlite_master WHERE name = 'rollback_probe'").get(),
      ).toBeUndefined();
      expect(db.prepare('SELECT count(*) AS n FROM schema_migrations').get()).toEqual({ n: 4 });
    } finally {
      db.close();
    }
  });
  it('enforces foreign keys, uniqueness, and treats SQL-looking input as data', () => {
    const db = openDatabase(':memory:');
    try {
      db.createUser(
        {
          id: 'one',
          username: 'alice',
          displayName: "'; DROP TABLE users; --",
          role: 'user',
          passwordHash: 'hash',
        },
        1,
      );
      expect(() => db.createSession('hash', 'missing', 1, 2)).toThrow();
      expect(() =>
        db.createUser(
          {
            id: 'two',
            username: 'ALICE',
            displayName: 'Alice',
            role: 'user',
            passwordHash: 'hash',
          },
          1,
        ),
      ).toThrow();
      expect(db.findUser("alice' OR 1=1 --")).toBeUndefined();
      expect(db.findUser('alice')?.displayName).toContain('DROP TABLE');
    } finally {
      db.close();
    }
  });
});
