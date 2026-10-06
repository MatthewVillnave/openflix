import Database from 'better-sqlite3';
import {
  chmodSync,
  existsSync,
  fchmodSync,
  fstatSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../packages/database/dist/index.js';
import { temporaryConfig } from './helpers.js';

// Keep real files/SQLite; inject only permission-system-call failures so results
// do not depend on whether the test runner is root or on a particular mount.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, fchmodSync: vi.fn(actual.fchmodSync) };
});
const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs');

beforeEach(() => {
  vi.mocked(fchmodSync).mockReset().mockImplementation(actualFs.fchmodSync);
});
afterEach(() => vi.unstubAllGlobals());

function insecureEmptyFile(filename: string) {
  writeFileSync(filename, '');
  chmodSync(filename, 0o644); // Independent of the test process's umask.
  expect(statSync(filename).mode & 0o777).toBe(0o644);
}
function expectUnopened(filename: string) {
  expect(statSync(filename).size).toBe(0); // SQLite has not initialized or migrated it.
  expect(statSync(filename).mode & 0o777).toBe(0o644);
  expect(existsSync(`${filename}-wal`)).toBe(false);
  expect(existsSync(`${filename}-shm`)).toBe(false);
  for (const [fd] of vi.mocked(fchmodSync).mock.calls) {
    expect(() => fstatSync(fd)).toThrow(expect.objectContaining({ code: 'EBADF' }));
  }
}

describe('database file permission boundary', () => {
  it('creates a new database with owner-only permissions', () => {
    const fixture = temporaryConfig();
    try {
      const db = openDatabase(fixture.config.databasePath);
      try {
        expect(db.healthy()).toBe(true);
        expect(statSync(fixture.config.databasePath).mode & 0o7777).toBe(0o600);
      } finally {
        db.close();
      }
    } finally {
      fixture.cleanup();
    }
  });

  it('corrects an existing 0644 database without losing data in a traversable directory', () => {
    const fixture = temporaryConfig();
    try {
      chmodSync(fixture.directory, 0o755);
      const raw = new Database(fixture.config.databasePath);
      raw.exec(
        "CREATE TABLE preservation_probe(value TEXT); INSERT INTO preservation_probe VALUES ('kept')",
      );
      raw.close();
      chmodSync(fixture.config.databasePath, 0o644);
      const db = openDatabase(fixture.config.databasePath);
      try {
        expect(db.healthy()).toBe(true);
        expect(statSync(fixture.config.databasePath).mode & 0o7777).toBe(0o600);
        expect(statSync(fixture.directory).mode & 0o777).toBe(0o700);
      } finally {
        db.close();
      }
      const reopened = new Database(fixture.config.databasePath);
      try {
        expect(reopened.prepare('SELECT value FROM preservation_probe').get()).toEqual({
          value: 'kept',
        });
        expect(reopened.prepare('SELECT count(*) AS n FROM schema_migrations').get()).toEqual({
          n: 3,
        });
      } finally {
        reopened.close();
      }
    } finally {
      fixture.cleanup();
    }
  });

  it('reopens an existing 0600 database without unnecessary permission changes', () => {
    const fixture = temporaryConfig();
    try {
      openDatabase(fixture.config.databasePath).close();
      vi.mocked(fchmodSync).mockClear();
      const db = openDatabase(fixture.config.databasePath);
      try {
        expect(db.healthy()).toBe(true);
        expect(statSync(fixture.config.databasePath).mode & 0o7777).toBe(0o600);
        expect(fchmodSync).not.toHaveBeenCalled();
      } finally {
        db.close();
      }
    } finally {
      fixture.cleanup();
    }
  });

  it('fails closed and closes the descriptor when correction is denied, on every attempt', () => {
    const fixture = temporaryConfig();
    try {
      insecureEmptyFile(fixture.config.databasePath);
      vi.mocked(fchmodSync).mockImplementation(() => {
        throw Object.assign(new Error('Permission correction denied'), { code: 'EPERM' });
      });
      for (let attempt = 0; attempt < 2; attempt++) {
        expect(() => openDatabase(fixture.config.databasePath)).toThrow(
          expect.objectContaining({ code: 'EPERM' }),
        );
        expectUnopened(fixture.config.databasePath);
      }
      expect(fchmodSync).toHaveBeenCalledTimes(2);
    } finally {
      fixture.cleanup();
    }
  });

  it('fails closed when chmod reports success but does not establish 0600', () => {
    const fixture = temporaryConfig();
    try {
      insecureEmptyFile(fixture.config.databasePath);
      vi.mocked(fchmodSync).mockImplementation(() => {});
      for (let attempt = 0; attempt < 2; attempt++) {
        expect(() => openDatabase(fixture.config.databasePath)).toThrow('0600');
        expectUnopened(fixture.config.databasePath);
      }
      expect(fchmodSync).toHaveBeenCalledTimes(2);
    } finally {
      fixture.cleanup();
    }
  });

  it('rejects a symlink without changing the target permissions or contents', () => {
    const fixture = temporaryConfig();
    try {
      const target = join(fixture.directory, 'target.sqlite');
      insecureEmptyFile(target);
      symlinkSync(target, fixture.config.databasePath);
      expect(() => openDatabase(fixture.config.databasePath)).toThrow();
      expect(fchmodSync).not.toHaveBeenCalled();
      expectUnopened(target);
    } finally {
      fixture.cleanup();
    }
  });

  it('rejects a directory without changing its permissions', () => {
    const fixture = temporaryConfig();
    try {
      const mode = statSync(fixture.directory).mode;
      expect(() => openDatabase(fixture.directory)).toThrow();
      expect(statSync(fixture.directory).mode).toBe(mode);
      expect(fchmodSync).not.toHaveBeenCalled();
    } finally {
      fixture.cleanup();
    }
  });

  it('fails explicitly on native Windows disk storage while allowing in-memory storage', () => {
    const fixture = temporaryConfig();
    try {
      vi.stubGlobal('process', { ...process, platform: 'win32' });
      expect(() => openDatabase(fixture.config.databasePath)).toThrow('POSIX');
      expect(existsSync(fixture.config.databasePath)).toBe(false);
      const db = openDatabase(':memory:');
      try {
        expect(db.healthy()).toBe(true);
      } finally {
        db.close();
      }
    } finally {
      vi.unstubAllGlobals();
      fixture.cleanup();
    }
  });
});
