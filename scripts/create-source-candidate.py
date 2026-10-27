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
manifest = root / 'scripts/source-manifest.txt'
names = manifest.read_text(encoding='utf-8').splitlines()
if not names or names != sorted(set(names)):
    raise SystemExit('Source manifest must be nonempty, sorted, and unique')
paths = []
for name in names:
    relative = Path(name)
    if relative.is_absolute() or '..' in relative.parts or str(relative) != name:
        raise SystemExit(f'Unsafe manifest path: {name}')
    path = root / relative
    if not path.is_file() or path.is_symlink() or any(parent.is_symlink() for parent in path.parents if parent != root.parent):
        raise SystemExit(f'Missing or unsafe input: {name}')
    paths.append(path)
if len(os.sys.argv) == 3 and os.sys.argv[1] == '--stage':
    destination = Path(os.sys.argv[2])
    for path in paths:
        target = destination / path.relative_to(root)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(path.read_bytes())
        target.chmod(0o755 if path.stat().st_mode & 0o111 else 0o644)
    raise SystemExit(0)
if len(os.sys.argv) != 1:
    raise SystemExit('Usage: create-source-candidate.py [--stage DESTINATION]')
with out.open('wb') as raw:
    with gzip.GzipFile(filename='', mode='wb', fileobj=raw, mtime=0) as gz:
        with tarfile.open(fileobj=gz, mode='w', format=tarfile.PAX_FORMAT) as archive:
            for p in paths:
                data = p.read_bytes()
                info = tarfile.TarInfo('openflix/' + p.relative_to(root).as_posix())
                info.size, info.mtime, info.uid, info.gid, info.mode = len(data), 0, 0, 0, 0o644
                archive.addfile(info, io.BytesIO(data))
print(f'{out} {hashlib.sha256(out.read_bytes()).hexdigest()} {len(paths)} files')
