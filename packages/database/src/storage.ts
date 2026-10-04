import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

// SQLite reopens a pathname. Private storage plus trusted ancestors prevents a
// different local UID from replacing that pathname between inspection and use.
function trustedAncestors(directory: string, uid: number): void {
  for (let current = directory; ; current = dirname(current)) {
    const info = statSync(current);
    if (
      !info.isDirectory() ||
      (info.uid !== uid && info.uid !== 0) ||
      ((info.mode & 0o022) !== 0 && (info.mode & 0o1000) === 0)
    ) {
      throw new Error(
        'Database directory ancestors must be trusted: owned by runtime UID or root, without group/world write (except sticky directories).',
      );
    }
    if (dirname(current) === current) break;
  }
}

function secureDirectory(directory: string, uid: number): string {
  // Resolve existing ancestor aliases (including macOS /tmp), then use only the
  // validated canonical path. Never follow a symlink at the data directory itself.
  const missing: string[] = [];
  let parent = dirname(directory);
  for (;;) {
    try {
      parent = realpathSync(parent);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      missing.unshift(basename(parent));
      parent = dirname(parent);
    }
  }
  trustedAncestors(parent, uid);
  const canonical = join(parent, ...missing, basename(directory));
  mkdirSync(canonical, { recursive: true, mode: 0o700 });
  if (realpathSync(dirname(canonical)) !== dirname(canonical)) {
    throw new Error('Database directory ancestors changed during creation; use trusted storage.');
  }
  trustedAncestors(dirname(canonical), uid);
  const fd = openSync(canonical, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const info = fstatSync(fd);
    if (canonical === dirname(canonical) || (info.mode & 0o1000) !== 0)
      throw new Error(
        'Use a dedicated private database directory, not a root or shared temporary directory.',
      );
    if (info.uid !== uid)
      throw new Error(
        'Database directory must be owned by the effective runtime UID; restore ownership offline before startup.',
      );
    if ((info.mode & 0o7777) !== 0o700) fchmodSync(fd, 0o700);
    const secured = fstatSync(fd);
    if (secured.uid !== uid || (secured.mode & 0o7777) !== 0o700) {
      throw new Error('Cannot establish database directory permissions 0700.');
    }
  } catch (cause) {
    throw new Error(
      'Cannot secure database directory: require runtime UID ownership and effective mode 0700; check storage permissions/restore ownership offline.',
      { cause },
    );
  } finally {
    closeSync(fd);
  }
  return canonical;
}

function secureFile(filename: string, uid: number, create: boolean): void {
  let fd: number;
  try {
    fd = openSync(
      filename,
      constants.O_RDWR |
        constants.O_NOFOLLOW |
        constants.O_NONBLOCK |
        (create ? constants.O_CREAT : 0),
      0o600,
    );
  } catch (error) {
    if (!create && (error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  try {
    const info = fstatSync(fd);
    if (!info.isFile()) throw new Error('Database and sidecars must be regular files.');
    if (info.uid !== uid)
      throw new Error('Database and sidecars must be owned by the effective runtime UID.');
    if (info.nlink !== 1)
      throw new Error('Database and sidecars must not have additional hard links.');
    if ((info.mode & 0o7777) !== 0o600) fchmodSync(fd, 0o600);
    if ((fstatSync(fd).mode & 0o7777) !== 0o600)
      throw new Error('Cannot establish database permissions 0600.');
  } finally {
    closeSync(fd);
  }
}

export function secureStorage(filename: string): string {
  if (process.platform === 'win32' || !process.geteuid) {
    throw new Error('File-backed databases require POSIX permissions; use a Linux container.');
  }
  const uid = process.geteuid();
  const absolute = resolve(filename);
  const directory = secureDirectory(dirname(absolute), uid);
  const canonical = join(directory, basename(absolute));
  secureFile(canonical, uid, true);
  for (const suffix of ['-wal', '-shm', '-journal'])
    secureFile(`${canonical}${suffix}`, uid, false);
  return canonical;
}
