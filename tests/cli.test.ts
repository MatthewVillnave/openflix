import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { temporaryConfig } from './helpers.js';

it('runs the source CLI from repository root and applies migrations idempotently', () => {
  const fixture = temporaryConfig();
  try {
    for (let i = 0; i < 2; i++) {
      const child = spawnSync(
        process.execPath,
        ['--import', 'tsx', 'apps/server/src/cli.ts', 'db:migrate'],
        {
          env: { ...process.env, NODE_ENV: 'test', OPENFLIX_DATA_DIR: fixture.directory },
          encoding: 'utf8',
          timeout: 10000,
        },
      );
      expect(child.status, child.stderr).toBe(0);
      expect(child.stdout).toContain('Database migrations applied');
    }
    const db = new Database(fixture.config.databasePath);
    expect(db.prepare('SELECT count(*) AS n FROM schema_migrations').get()).toEqual({ n: 2 });
    expect(db.prepare('SELECT count(*) AS n FROM users').get()).toEqual({ n: 0 });
    db.close();
  } finally {
    fixture.cleanup();
  }
});

it('refuses account provisioning through noninteractive input', () => {
  const fixture = temporaryConfig();
  try {
    const child = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'apps/server/src/cli.ts', 'user:create', 'alice'],
      {
        env: { ...process.env, NODE_ENV: 'test', OPENFLIX_DATA_DIR: fixture.directory },
        encoding: 'utf8',
        timeout: 10000,
        input: 'test-secret-do-not-echo\n',
      },
    );
    expect(child.status).toBe(1);
    expect(child.stdout + child.stderr).not.toContain('test-secret-do-not-echo');
  } finally {
    fixture.cleanup();
  }
});
