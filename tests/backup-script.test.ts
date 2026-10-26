import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';

it('preserves existing backups on failure and restores a successful new archive', () => {
  const root = mkdtempSync(join(tmpdir(), 'openflix-backup-test-'));
  try {
    const bin = join(root, 'bin');
    const data = join(root, 'data');
    mkdirSync(bin);
    mkdirSync(data);
    writeFileSync(join(data, 'account.txt'), 'synthetic account');
    const input = join(root, 'input.tar');
    execFileSync('tar', ['-C', data, '-cf', input, '.']);
    const fakeDocker = join(bin, 'docker');
    writeFileSync(
      fakeDocker,
      '#!/bin/sh\n[ "${FAIL_BACKUP:-0}" = 0 ] || { echo partial; exit 1; }\ncat "$ARCHIVE_FIXTURE"\n',
    );
    chmodSync(fakeDocker, 0o755);
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, ARCHIVE_FIXTURE: input };
    const script = resolve('scripts/backup-volume.sh');
    const existing = join(root, 'existing.tar');
    writeFileSync(existing, 'old recovery point');
    expect(() =>
      execFileSync('sh', [script, 'fixture-volume', 'fixture-image', existing], { env }),
    ).toThrow();
    expect(readFileSync(existing, 'utf8')).toBe('old recovery point');
    const failed = join(root, 'failed.tar');
    expect(() =>
      execFileSync('sh', [script, 'fixture-volume', 'fixture-image', failed], {
        env: { ...env, FAIL_BACKUP: '1' },
      }),
    ).toThrow();
    expect(() => readFileSync(failed)).toThrow();
    const output = join(root, 'new.tar');
    execFileSync('sh', [script, 'fixture-volume', 'fixture-image', output], { env });
    const restore = join(root, 'restore');
    mkdirSync(restore);
    execFileSync('tar', ['-C', restore, '-xf', output]);
    expect(readFileSync(join(restore, 'account.txt'), 'utf8')).toBe('synthetic account');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
