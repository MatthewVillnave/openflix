import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../packages/database/dist/index.js';
import { EncryptedCredentialStore } from '../apps/server/src/connector-credentials.js';
import { loadConfig } from '../apps/server/src/config.js';
import type { ConnectorSummary } from '../packages/shared/dist/index.js';
const record: ConnectorSummary = {
  id: 'credential-test',
  type: 'jellyfin',
  name: 'Fixture',
  baseUrl: 'http://localhost:8096',
  server: { id: 'server', name: 'Fixture', version: '12.1.0' },
  libraries: [],
  state: 'connected',
  lastError: null,
  lastCheckedAt: 1,
  createdAt: 1,
};
describe('authenticated connector credential encryption', () => {
  let db: ReturnType<typeof openDatabase>;
  let vault: EncryptedCredentialStore;
  let key: string;
  const secret = Buffer.from('disposable-fixture-credential');
  beforeEach(() => {
    db = openDatabase(':memory:');
    key = randomBytes(32).toString('base64');
    vault = new EncryptedCredentialStore(db, key);
    vault.create(record, secret);
  });
  afterEach(() => {
    vault.destroy();
    db.close();
  });
  it('round-trips, uses distinct nonces, and never stores key or plaintext', async () => {
    const first = db.getConnector(record.id)!.credentialEnvelope!;
    expect(Buffer.from(await vault.read({ id: record.id }))).toEqual(secret);
    await vault.store(record.id, secret);
    const second = db.getConnector(record.id)!.credentialEnvelope!;
    expect(first).not.toBe(second);
    expect(first).not.toContain(secret.toString());
    expect(first).not.toContain(key);
    expect(JSON.parse(first)).toMatchObject({ version: 1, algorithm: 'aes-256-gcm' });
  });
  it.each(['ciphertext', 'tag', 'iv', 'keyId', 'version'])(
    'fails closed after tampering %s',
    async (field) => {
      const envelope = JSON.parse(db.getConnector(record.id)!.credentialEnvelope!);
      envelope[field] =
        field === 'version'
          ? 2
          : field === 'keyId'
            ? '0'.repeat(32)
            : Buffer.from('tampered').toString('base64');
      db.setConnectorCredential(record.id, JSON.stringify(envelope));
      await expect(vault.read({ id: record.id })).rejects.toMatchObject({
        code: 'credential_unavailable',
      });
    },
  );
  it('rejects a wrong master key and a copied envelope at another identity/origin', async () => {
    const wrong = new EncryptedCredentialStore(db, randomBytes(32).toString('base64'));
    try {
      await expect(wrong.read({ id: record.id })).rejects.toMatchObject({
        code: 'credential_unavailable',
      });
    } finally {
      wrong.destroy();
    }
    db.insertConnector(
      { ...record, id: 'other', baseUrl: 'https://other.example' },
      db.getConnector(record.id)!.credentialEnvelope!,
    );
    await expect(vault.read({ id: 'other' })).rejects.toMatchObject({
      code: 'credential_unavailable',
    });
  });
  it('deletes credentials without returning plaintext', async () => {
    await vault.delete({ id: record.id });
    expect(db.getConnector(record.id)!.credentialEnvelope).toBeNull();
    await expect(vault.read({ id: record.id })).rejects.toMatchObject({
      code: 'credential_unavailable',
    });
  });
  it.each([
    'short',
    'A'.repeat(43),
    Buffer.alloc(31).toString('base64'),
    ' ' + Buffer.alloc(32).toString('base64'),
  ])('rejects invalid operator keys without echoing them', (value) => {
    expect(() => loadConfig({ OPENFLIX_MASTER_KEY: value })).toThrow('OPENFLIX_MASTER_KEY must');
    try {
      loadConfig({ OPENFLIX_MASTER_KEY: value });
    } catch (error) {
      expect(String(error)).not.toContain(value);
    }
  });
});
