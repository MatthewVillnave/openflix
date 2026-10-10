import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export function sourceUrl(value: string | undefined): string | null {
  if (!value) return null;
  if (value.length > 2048 || /\s/.test(value)) throw new Error('Invalid public source URL');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    throw new Error('Invalid public source URL');
  return url.href;
}

// Build-time inventory only. No runtime request can select a filesystem path.
export function dependencyNotices(root: string): string {
  const base = join(root, 'node_modules/.pnpm');
  const records = new Map<string, string>();
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const modules = join(base, entry.name, 'node_modules');
    let names: string[];
    try {
      names = readdirSync(modules);
    } catch {
      continue;
    }
    for (const name of names) {
      const candidates = name.startsWith('@')
        ? readdirSync(join(modules, name)).map((child) => join(name, child))
        : [name];
      for (const candidate of candidates) {
        const dir = join(modules, candidate);
        let pkg: { name: string; version: string; license?: string };
        try {
          pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
        } catch {
          continue;
        }
        if (pkg.name.startsWith('@openflix/')) continue;
        const key = `${pkg.name}@${pkg.version}`;
        if (records.has(key)) continue;
        const files = readdirSync(dir).filter((file) =>
          /^(licen[cs]e|notice|copying|copyright)/i.test(file),
        );
        if (!files.length) files.push(...readdirSync(dir).filter((file) => /^readme/i.test(file)));
        const texts = files
          .sort()
          .map((file) => {
            try {
              return `--- ${file} ---\n${readFileSync(join(dir, file), 'utf8')}`;
            } catch {
              return '';
            }
          })
          .join('\n');
        records.set(key, `\n=== ${key} (${pkg.license ?? 'see original notices'}) ===\n${texts}`);
      }
    }
  }
  return (
    'Installed build dependencies retain their original licenses. Platform inventory varies; consult the lockfile and third-party review.\n' +
    [...records]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, text]) => text)
      .join('\n')
  );
}

export function legalAssets(root: string): Record<string, string> {
  return {
    'LICENSE.txt': readFileSync(join(root, 'LICENSE'), 'utf8'),
    'NOTICE.txt': readFileSync(join(root, 'NOTICE'), 'utf8'),
    'THIRD-PARTY.txt':
      readFileSync(join(root, 'THIRD-PARTY-NOTICES.md'), 'utf8') +
      '\n' +
      readFileSync(join(root, 'third-party/Apache-2.0.txt'), 'utf8') +
      '\n' +
      dependencyNotices(root),
  };
}
