import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

it('runs the documented restore in a fresh shell and preserves existing data on failure', () => {
  const root = mkdtempSync(join(tmpdir(), 'openflix-restore-doc-'));
  try {
    const config = join(root, '.config/openflix');
    const bin = join(root, 'bin');
    const data = join(root, 'data');
    mkdirSync(config, { recursive: true });
    mkdirSync(bin);
    mkdirSync(data);
    writeFileSync(join(config, 'local.env'), 'synthetic fixture only');
    writeFileSync(join(data, 'account.txt'), 'synthetic account');
    execFileSync('tar', ['-C', data, '-cf', join(config, 'backup.tar'), '.']);
    const fake = join(bin, 'docker');
    writeFileSync(
      fake,
      `#!/bin/sh
case "$1 $2" in
'compose --env-file') case "$*" in *'images -q server') echo fixture-image;; *'up --build -d --wait') touch "$FIXTURE_ROOT/started";; *) exit 1;; esac;;
'image inspect') [ "$3" = fixture-image ];;
'volume inspect') [ -f "$FIXTURE_ROOT/existing" ];;
'volume create') mkdir "$FIXTURE_ROOT/restored";;
'run --rm') tar -C "$FIXTURE_ROOT/restored" -xf -;;
*) exit 1;;
esac
`,
    );
    chmodSync(fake, 0o755);
    const blocks = [
      ...readFileSync('docs/self-hosted-candidate.md', 'utf8').matchAll(/```sh\n([\s\S]*?)```/g),
    ];
    const restore = blocks
      .find((block) => block[1]!.includes('restore_volume='))![1]!
      .replaceAll('$HOME', root);
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, FIXTURE_ROOT: root };
    execFileSync('sh', ['-c', restore], { env });
    expect(readFileSync(join(root, 'restored/account.txt'), 'utf8')).toBe('synthetic account');
    rmSync(join(root, 'started'));
    writeFileSync(join(root, 'existing'), 'preserve');
    expect(() => execFileSync('sh', ['-c', restore], { env, stdio: 'pipe' })).toThrow();
    expect(readFileSync(join(root, 'restored/account.txt'), 'utf8')).toBe('synthetic account');
    expect(() => readFileSync(join(root, 'started'))).toThrow();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
