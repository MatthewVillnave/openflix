import { describe, expect, it } from 'vitest';
import { loadConfig } from '../apps/server/src/config.js';
describe('configuration', () => {
  it('uses loopback development defaults', () => {
    expect(loadConfig({})).toMatchObject({ host: '127.0.0.1', port: 8787, origin: 'http://localhost:5173', secureCookies: false });
  });
  it.each([
    { OPENFLIX_PORT: '0' }, { OPENFLIX_PORT: '65536' }, { OPENFLIX_PORT: '1.5' }, { OPENFLIX_PORT: '' },
    { OPENFLIX_SESSION_TTL_SECONDS: '2' }, { OPENFLIX_LOG_LEVEL: 'anything' }, { OPENFLIX_DATA_DIR: '' },
    { NODE_ENV: 'prod' }, { OPENFLIX_HOST: 'anywhere' }, { OPENFLIX_BASE_URL: 'javascript:alert(1)' },
    { OPENFLIX_BASE_URL: 'https://user:secret@example.test' }, { OPENFLIX_BASE_URL: 'https://example.test/path' },
    { OPENFLIX_BASE_URL: 'https://example.test?token=secret' }, { OPENFLIX_BASE_URL: 'http://192.168.1.10' },
    { NODE_ENV: 'production' }, { NODE_ENV: 'production', OPENFLIX_BASE_URL: 'http://localhost' },
  ])('rejects invalid or unsafe configuration %#', env => expect(() => loadConfig(env)).toThrow());
  it('uses secure host-only cookie names for production HTTPS', () => {
    expect(loadConfig({ NODE_ENV: 'production', OPENFLIX_BASE_URL: 'https://openflix.example' })).toMatchObject({ secureCookies: true, cookieName: '__Host-openflix_session' });
  });
  it('does not echo invalid configuration values', () => {
    expect(() => loadConfig({ OPENFLIX_PORT: 'sensitive-value' })).toThrow('Invalid configuration fields: OPENFLIX_PORT');
  });
});
