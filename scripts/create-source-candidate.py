#!/usr/bin/env python3
"""Create a deterministic source-only candidate from an explicit allowlist."""
import gzip
import hashlib
import io
import os
from pathlib import Path
import tarfile

root = Path(__file__).resolve().parent.parent
out = root.parent / 'openflix-source-candidate.tar.gz'
fixed = ['README.md', 'LICENSE', 'NOTICE', 'THIRD-PARTY-NOTICES.md', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.npmrc', '.nvmrc', '.dockerignore', 'tsconfig.base.json', 'docker-compose.local.yml', 'docker-compose.yml', 'docker/Dockerfile', 'docker/nginx.conf', 'scripts/legal-assets.ts', 'scripts/create-source-candidate.py', 'docs/self-hosted-candidate.md', 'docs/candidate-release-notes.md', 'docs/licensing.md', 'docs/configuration.md', 'docs/security.md', 'docs/connector-security.md', 'docs/playback-scope.md']
paths = [root / p for p in fixed]
for tree in ('apps/server', 'apps/web', 'packages', 'third-party'):
    for p in (root / tree).rglob('*'):
        parts = p.relative_to(root).parts
        if p.is_file() and not p.is_symlink() and not any(x in ('node_modules', 'dist') for x in parts) and p.name != 'vite.personal-test.config.ts':
            paths.append(p)
paths = sorted(set(paths), key=lambda p: p.relative_to(root).as_posix())
for p in paths:
    if not p.is_file() or p.is_symlink():
        raise SystemExit(f'Missing or unsafe input: {p.relative_to(root)}')
    name = p.relative_to(root).as_posix()
    if any(x in name.lower() for x in ('secret', 'credential-store', '.sqlite', '.env', 'screenshot', 'evidence')):
        raise SystemExit(f'Unexpected package path: {name}')
with out.open('wb') as raw:
    with gzip.GzipFile(filename='', mode='wb', fileobj=raw, mtime=0) as gz:
        with tarfile.open(fileobj=gz, mode='w', format=tarfile.PAX_FORMAT) as archive:
            for p in paths:
                data = p.read_bytes()
                info = tarfile.TarInfo('openflix/' + p.relative_to(root).as_posix())
                info.size, info.mtime, info.uid, info.gid, info.mode = len(data), 0, 0, 0, 0o644
                archive.addfile(info, io.BytesIO(data))
print(f'{out} {hashlib.sha256(out.read_bytes()).hexdigest()} {len(paths)} files')
