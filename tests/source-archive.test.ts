import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, it } from 'vitest';

it('stages and archives only the explicit source manifest, never arbitrary extra files', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'openflix-source-test-'));
  try {
    const source = join(scratch, 'source');
    const stage = join(scratch, 'stage');
    const names = readFileSync('scripts/source-manifest.txt', 'utf8').trim().split('\n');
    for (const name of names) {
      const target = join(source, name);
      mkdirSync(dirname(target), { recursive: true });
      cpSync(name, target);
    }
    const extra = join(source, 'apps/server/operator-notes.txt');
    writeFileSync(extra, 'synthetic private canary');
    const script = join(source, 'scripts/create-source-candidate.py');
    execFileSync('python3', [script, '--stage', stage]);
    execFileSync('python3', [script]);
    const entries = execFileSync(
      'tar',
      ['-tzf', join(scratch, 'openflix-source-candidate.tar.gz')],
      {
        encoding: 'utf8',
      },
    )
      .trim()
      .split('\n');
    expect(entries).toEqual(names.map((name) => `openflix/${name}`));
    expect(entries).not.toContain('openflix/apps/server/operator-notes.txt');
    expect(() => readFileSync(join(stage, 'apps/server/operator-notes.txt'))).toThrow();
    expect(readFileSync(join(stage, 'apps/server/src/app.ts'))).toEqual(
      readFileSync('apps/server/src/app.ts'),
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
