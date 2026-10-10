import Database from 'better-sqlite3';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  fchmodSync,
  fstatSync,
  mkdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../packages/database/dist/index.js';
import { temporaryConfig } from './helpers.js';

vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>();
  return { ...fs, fchmodSync: vi.fn(fs.fchmodSync), fstatSync: vi.fn(fs.fstatSync) };
});
const real = await vi.importActual<typeof import('node:fs')>('node:fs');
let fixture: ReturnType<typeof temporaryConfig>;
beforeEach(() => {
  fixture = temporaryConfig();
  vi.mocked(fchmodSync).mockReset().mockImplementation(real.fchmodSync);
  vi.mocked(fstatSync).mockReset().mockImplementation(real.fstatSync);
});
afterEach(() => fixture.cleanup());
const mode = (path: string) => statSync(path).mode & 0o7777;

describe('private SQLite storage boundary', () => {
  it('creates nested private directories and migrates normally', () => {
    const directory = join(fixture.directory, 'new', 'data');
    openDatabase(join(directory, 'db.sqlite')).close();
    expect(mode(directory)).toBe(0o700);
    expect(mode(join(fixture.directory, 'new'))).toBe(0o700);
    expect(statSync(directory).uid).toBe(process.geteuid!());
  });

  it.each([0o700, 0o755, 0o777])(
    'accepts/repairs directory mode %i and removes unrelated-user access',
    (permissions) => {
      chmodSync(fixture.directory, permissions);
      openDatabase(fixture.config.databasePath).close();
      expect(mode(fixture.directory)).toBe(0o700);
      expect(mode(fixture.directory) & 0o077).toBe(0); // no read, traversal or replacement access
    },
  );

  it.each(['denied', 'ineffective'])(
    'fails closed deterministically for %s directory correction',
    (failure) => {
      chmodSync(fixture.directory, 0o755);
      vi.mocked(fchmodSync).mockImplementation(() => {
        if (failure === 'denied') throw Object.assign(new Error('denied'), { code: 'EPERM' });
      });
      for (let i = 0; i < 2; i++) {
        expect(() => openDatabase(fixture.config.databasePath)).toThrow('0700');
        expect(existsSync(fixture.config.databasePath)).toBe(false);
      }
      for (const [fd] of vi.mocked(fchmodSync).mock.calls) {
        expect(() => real.fstatSync(fd)).toThrow(expect.objectContaining({ code: 'EBADF' }));
      }
    },
  );

  it('rejects a directory owned by a different UID before creating a database or chmodding', () => {
    vi.mocked(fstatSync).mockImplementation((fd) => {
      const info = real.fstatSync(fd);
      if (info.isDirectory()) info.uid = process.geteuid!() + 1;
      return info;
    });
    expect(() => openDatabase(fixture.config.databasePath)).toThrow('runtime UID');
    expect(fchmodSync).not.toHaveBeenCalled();
    expect(existsSync(fixture.config.databasePath)).toBe(false);
  });

  it('rejects a data-directory symlink without changing its target', () => {
    const target = join(fixture.directory, 'target');
    mkdirSync(target, { mode: 0o755 });
    chmodSync(target, 0o755);
    const link = join(fixture.directory, 'link');
    symlinkSync(target, link);
    expect(() => openDatabase(join(link, 'db.sqlite'))).toThrow();
    expect(mode(target)).toBe(0o755);
    expect(existsSync(join(target, 'db.sqlite'))).toBe(false);
  });

  it('rejects a writable non-sticky ancestor that would allow replacement of the private directory', () => {
    chmodSync(fixture.directory, 0o777);
    const directory = join(fixture.directory, 'data');
    mkdirSync(directory, { mode: 0o700 });
    expect(() => openDatabase(join(directory, 'db.sqlite'))).toThrow('ancestors');
    expect(existsSync(join(directory, 'db.sqlite'))).toBe(false);
    expect(mode(fixture.directory)).toBe(0o777); // never chmod unrelated ancestors
  });

  it('restores 0644 DB/WAL/SHM safely and preserves committed WAL data', () => {
    const source = join(fixture.directory, 'source.sqlite');
    const raw = new Database(source);
    try {
      raw.pragma('journal_mode = WAL');
      raw.pragma('wal_autocheckpoint = 0');
      raw.exec(
        "CREATE TABLE restored(value TEXT); INSERT INTO restored VALUES ('wal-sensitive-probe')",
      );
      expect(readFileSync(`${source}-wal`).includes(Buffer.from('wal-sensitive-probe'))).toBe(true);
      const restored = join(fixture.directory, 'restored');
      mkdirSync(restored);
      chmodSync(restored, 0o777);
      const destination = join(restored, 'openflix.sqlite');
      for (const suffix of ['', '-wal', '-shm']) {
        copyFileSync(`${source}${suffix}`, `${destination}${suffix}`);
        chmodSync(`${destination}${suffix}`, 0o644);
      }
      const db = openDatabase(destination);
      try {
        expect(mode(restored)).toBe(0o700);
        for (const suffix of ['', '-wal', '-shm'])
          expect(mode(`${destination}${suffix}`)).toBe(0o600);
        const reader = new Database(destination);
        try {
          expect(reader.prepare('SELECT value FROM restored').get()).toEqual({
            value: 'wal-sensitive-probe',
          });
          expect(reader.prepare('SELECT count(*) AS n FROM schema_migrations').get()).toEqual({
            n: 4,
          });
        } finally {
          reader.close();
        }
      } finally {
        db.close();
      }
    } finally {
      raw.close();
    }
  });

  it.each(['-wal', '-shm', '-journal'])(
    'rejects a %s symlink without touching its target',
    (suffix) => {
      const target = join(fixture.directory, 'outside');
      writeFileSync(target, 'unchanged');
      chmodSync(target, 0o644);
      symlinkSync(target, `${fixture.config.databasePath}${suffix}`);
      expect(() => openDatabase(fixture.config.databasePath)).toThrow();
      expect(mode(target)).toBe(0o644);
      expect(readFileSync(target, 'utf8')).toBe('unchanged');
      expect(statSync(fixture.config.databasePath).size).toBe(0);
    },
  );

  it.each(['denied', 'ineffective'])('fails closed for %s sidecar correction', (failure) => {
    writeFileSync(fixture.config.databasePath, '', { mode: 0o600 });
    const sidecar = `${fixture.config.databasePath}-wal`;
    writeFileSync(sidecar, 'preserved');
    chmodSync(sidecar, 0o644);
    vi.mocked(fchmodSync).mockImplementation(() => {
      if (failure === 'denied') throw new Error('denied');
    });
    expect(() => openDatabase(fixture.config.databasePath)).toThrow();
    expect(readFileSync(sidecar, 'utf8')).toBe('preserved');
    expect(statSync(fixture.config.databasePath).size).toBe(0);
    for (const [fd] of vi.mocked(fchmodSync).mock.calls) expect(() => real.fstatSync(fd)).toThrow();
  });
});
