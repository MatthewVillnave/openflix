import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../apps/server/src/config.js';
export function temporaryConfig(env: NodeJS.ProcessEnv = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'openflix-test-'));
  const config = loadConfig({
    NODE_ENV: 'test',
    OPENFLIX_DATA_DIR: directory,
    OPENFLIX_LOG_LEVEL: 'silent',
    ...env,
  });
  return { config, directory, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}
export const testPassword = 'test-only-long-password';
