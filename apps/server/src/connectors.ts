import { registerPlayback } from './playback.js';
import { registerCatalog } from './catalog.js';
import { randomUUID } from 'node:crypto';
import type { Server, IncomingMessage, ServerResponse } from 'node:http';
import type { createLogger } from './logger.js';
import type { FastifyInstance } from 'fastify';
import { ConnectorError, isConnectorError } from '@openflix/connector-core';
import {
  authenticateJellyfin,
  createJellyfinConnector,
  validateJellyfinUrl,
  revokeJellyfinCredential,
} from '@openflix/connector-jellyfin';
import type { ConnectorSummary } from '@openflix/shared';
import type { OpenFlixDatabase, StoredConnector } from '@openflix/database';
import { API_PREFIX } from '@openflix/protocol';
import { EncryptedCredentialStore } from './connector-credentials.js';
import type { Config } from './config.js';
import type { AuthService } from './auth.js';
/** Explicit projection keeps credential envelopes/metadata out of all HTTP responses. */
function summary(record: StoredConnector | ConnectorSummary): ConnectorSummary {
  return {
    id: record.id,
    type: record.type,
    name: record.name,
    baseUrl: record.baseUrl,
    server: record.server,
    libraries: record.libraries,
    state: record.state,
    lastError: record.lastError,
    lastCheckedAt: record.lastCheckedAt,
    createdAt: record.createdAt,
  };
}
export async function registerConnectors(
  app: FastifyInstance<Server, IncomingMessage, ServerResponse, ReturnType<typeof createLogger>>,
  db: OpenFlixDatabase,
  auth: AuthService,
  config: Config,
): Promise<void> {
  const vault = config.masterKey ? new EncryptedCredentialStore(db, config.masterKey) : undefined;
  app.addHook('onClose', async () => vault?.destroy());
  // Fail closed locally before networking if existing credentials cannot be authenticated.
  for (const record of db.listConnectors()) {
    if (!vault) throw new ConnectorError('credential_unavailable');
    const bytes = await vault.read({ id: record.id });
    bytes.fill(0);
  }
  db.resetConnectorStates();
  // Single operator workflow at a time; bounded work, no duplicate adds/removal races.
  let busy = false;
  const run = async <T>(action: (store: EncryptedCredentialStore) => Promise<T>): Promise<T> => {
    if (!vault) throw new ConnectorError('credential_unavailable');
    if (busy) throw new ConnectorError('busy');
    busy = true;
    try {
      return await action(vault);
    } finally {
      busy = false;
    }
  };
  await registerCatalog(app, db, auth, config, run, () => busy);
  const playback = await registerPlayback(app, db, auth, config, vault);
  await app.register(
    async (routes) => {
      routes.addHook('preHandler', async (request, reply) => {
        const user = auth.currentUser(request.cookies[config.cookieName]);
        if (!user) return reply.code(401).send({ error: 'Authentication required' });
        if (user.role !== 'admin')
          return reply.code(403).send({ error: 'Administrator access required' });
      });
      routes.setErrorHandler((error, request, reply) => {
        if (isConnectorError(error)) {
          const status =
            error.code === 'not_found'
              ? 404
              : error.code === 'invalid_configuration'
                ? 400
                : error.code === 'busy' || error.code === 'credential_unavailable'
                  ? 503
                  : 502;
          request.log.info(
            { event: 'connector.failed', code: error.code },
            'Connector operation failed',
          );
          return reply.code(status).send({ error: error.message, code: error.code });
        }
        const status = (error as { statusCode?: number }).statusCode;
        if (status && status >= 400 && status < 500)
          return reply.code(status).send({ error: 'Invalid request' });
        request.log.error({ event: 'connector.error' }, 'Connector operation failed');
        return reply.code(500).send({ error: 'Internal server error' });
      });
      routes.get('/connectors', async () => ({
        connectors: db.listConnectors().map(summary),
        credentialStorageConfigured: Boolean(vault),
      }));
      routes.post<{ Body: { name: string; baseUrl: string; username: string; password: string } }>(
        '/connectors',
        {
          config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
          schema: {
            body: {
              type: 'object',
              additionalProperties: false,
              required: ['name', 'baseUrl', 'username', 'password'],
              properties: {
                name: { type: 'string', minLength: 1, maxLength: 128 },
                baseUrl: { type: 'string', minLength: 1, maxLength: 2048 },
                username: { type: 'string', minLength: 1, maxLength: 256 },
                password: { type: 'string', minLength: 1, maxLength: 1024 },
              },
            },
          },
        },
        async (request, reply) => {
          try {
            return await run(async (store) => {
              if (db.listConnectors().length >= 10 || !request.body.name.trim())
                throw new ConnectorError('invalid_configuration');
              const id = randomUUID();
              const baseUrl = validateJellyfinUrl(request.body.baseUrl);
              const result = await authenticateJellyfin({
                baseUrl,
                deviceId: id,
                username: request.body.username,
                password: request.body.password,
              });
              request.body.password = '';
              try {
                const now = Date.now();
                const record: ConnectorSummary = {
                  id,
                  type: 'jellyfin',
                  name: request.body.name.trim(),
                  baseUrl,
                  server: result.server,
                  libraries: result.libraries,
                  state: 'connected',
                  lastError: null,
                  lastCheckedAt: now,
                  createdAt: now,
                };
                try {
                  store.create(record, result.secret);
                } catch (error) {
                  try {
                    await revokeJellyfinCredential(baseUrl, id, result.secret);
                  } catch {
                    /* remote token cleanup is best effort when offline */
                  }
                  throw error;
                }
                request.log.info(
                  { event: 'connector.added', connector_id: id },
                  'Media server added',
                );
                return reply.code(201).send({ connector: summary(record) });
              } finally {
                result.secret.fill(0);
              }
            });
          } finally {
            request.body.password = '';
          }
        },
      );
      const params = {
        type: 'object',
        additionalProperties: false,
        required: ['id'],
        properties: { id: { type: 'string', format: 'uuid' } },
      };
      routes.post<{ Params: { id: string } }>(
        '/connectors/:id/test',
        { schema: { params } },
        async (request) =>
          run(async (store) => {
            const record = db.getConnector(request.params.id);
            if (!record) throw new ConnectorError('not_found');
            const connector = createJellyfinConnector(
              { baseUrl: record.baseUrl, credential: { id: record.id } },
              store,
            );
            try {
              await connector.connect();
              const server = await connector.getServerInfo();
              const libraries = await connector.getLibraries();
              const updated: ConnectorSummary = {
                ...summary(record),
                server,
                libraries,
                state: 'connected',
                lastError: null,
                lastCheckedAt: Date.now(),
              };
              db.updateConnector(updated);
              return { connector: updated };
            } catch (error) {
              const safe = isConnectorError(error) ? error : new ConnectorError('unavailable');
              db.updateConnector({
                ...summary(record),
                state: 'error',
                lastError: safe.code,
                lastCheckedAt: Date.now(),
                libraries: [],
              });
              throw safe;
            }
          }),
      );
      routes.delete<{ Params: { id: string } }>(
        '/connectors/:id',
        { schema: { params } },
        async (request) =>
          run(async (store) => {
            const record = db.getConnector(request.params.id);
            if (!record) throw new ConnectorError('not_found');
            const finishRemoval = await playback.prepareRemoval(record.id);
            try {
              let revocation: 'confirmed' | 'unconfirmed' = 'confirmed';
              try {
                await createJellyfinConnector(
                  { baseUrl: record.baseUrl, credential: { id: record.id } },
                  store,
                ).disconnect();
              } catch {
                revocation = 'unconfirmed';
              }
              db.removeConnector(record.id);
              request.log.info(
                { event: 'connector.removed', connector_id: record.id, revocation },
                'Media server removed',
              );
              return { removed: true, revocation };
            } finally {
              finishRemoval();
            }
          }),
      );
    },
    { prefix: API_PREFIX },
  );
}
