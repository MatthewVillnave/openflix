import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { ConnectorError } from '@openflix/connector-core';
import type { ConnectorCredentialStore, CredentialRef } from '@openflix/connector-core';
import type { OpenFlixDatabase } from '@openflix/database';
import type { ConnectorSummary } from '@openflix/shared';
const envelopeSchema = z
  .object({
    version: z.union([z.literal(1), z.literal(2)]),
    algorithm: z.literal('aes-256-gcm'),
    keyId: z.string().regex(/^[a-f0-9]{32}$/),
    iv: z.string().max(32),
    tag: z.string().max(32),
    ciphertext: z.string().max(16384),
  })
  .strict();
function decode(value: string, length?: number): Buffer {
  const result = Buffer.from(value, 'base64');
  if (result.toString('base64') !== value || (length !== undefined && result.length !== length))
    throw new Error();
  return result;
}
/** Only ciphertext enters SQLite; the key comes from operator configuration. */
export class EncryptedCredentialStore implements ConnectorCredentialStore {
  private readonly key: Buffer;
  private readonly keyId: string;
  constructor(
    private readonly db: OpenFlixDatabase,
    masterKey: string,
  ) {
    this.key = decode(masterKey, 32);
    this.keyId = createHash('sha256').update(this.key).digest('hex').slice(0, 32);
  }
  private aad(record: ConnectorSummary & { ownerUserId?: string | null }): Buffer {
    return Buffer.from(
      JSON.stringify(
        record.ownerUserId
          ? [
              'openflix-connector',
              2,
              this.keyId,
              record.id,
              record.type,
              record.baseUrl,
              record.ownerUserId,
              record.server.id,
            ]
          : ['openflix-connector', 1, this.keyId, record.id, record.type, record.baseUrl],
      ),
    );
  }
  private seal(
    record: ConnectorSummary & { ownerUserId?: string | null },
    secret: Uint8Array,
  ): string {
    if (!secret.length || secret.length > 8192) throw new ConnectorError('credential_unavailable');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv, { authTagLength: 16 });
    cipher.setAAD(this.aad(record));
    const ciphertext = Buffer.concat([cipher.update(secret), cipher.final()]);
    return JSON.stringify({
      version: record.ownerUserId ? 2 : 1,
      algorithm: 'aes-256-gcm',
      keyId: this.keyId,
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    });
  }
  create(record: ConnectorSummary, secret: Uint8Array, ownerUserId: string | null = null): void {
    this.db.insertConnector(record, this.seal({ ...record, ownerUserId }, secret), ownerUserId);
  }
  async store(connectorId: string, secret: Uint8Array): Promise<CredentialRef> {
    const record = this.db.getConnector(connectorId);
    if (!record) throw new ConnectorError('not_found');
    this.db.setConnectorCredential(connectorId, this.seal(record, secret));
    return { id: connectorId };
  }
  async read(ref: CredentialRef): Promise<Uint8Array> {
    let partial: Buffer | undefined;
    try {
      const record = this.db.getConnector(ref.id);
      if (!record?.credentialEnvelope) throw new Error();
      const envelope = envelopeSchema.parse(JSON.parse(record.credentialEnvelope));
      if (envelope.version !== (record.ownerUserId ? 2 : 1) || envelope.keyId !== this.keyId)
        throw new Error();
      const decipher = createDecipheriv('aes-256-gcm', this.key, decode(envelope.iv, 12), {
        authTagLength: 16,
      });
      decipher.setAAD(this.aad(record));
      decipher.setAuthTag(decode(envelope.tag, 16));
      partial = decipher.update(decode(envelope.ciphertext));
      const end = decipher.final(); // Do not return any plaintext before authenticating the tag.
      return Buffer.concat([partial, end]);
    } catch {
      throw new ConnectorError('credential_unavailable');
    } finally {
      partial?.fill(0);
    }
  }
  async delete(ref: CredentialRef): Promise<void> {
    this.db.setConnectorCredential(ref.id, null);
  }
  forUser(userId: string): ConnectorCredentialStore {
    const check = (id: string) => {
      if (!this.db.forUser(userId).getConnector(id))
        throw new ConnectorError('credential_unavailable');
    };
    return {
      read: async (ref) => {
        check(ref.id);
        return this.read(ref);
      },
      store: async (id, secret) => {
        check(id);
        return this.store(id, secret);
      },
      delete: async (ref) => {
        check(ref.id);
        return this.delete(ref);
      },
    };
  }
  destroy(): void {
    this.key.fill(0);
  }
}
