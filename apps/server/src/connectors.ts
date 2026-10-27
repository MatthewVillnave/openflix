import { discoverJellyfin } from './discovery.js';
import { registerArtwork } from './artwork.js';
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
) {
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
  const catalog = await registerCatalog(app, db, auth, config, run, () => busy, vault);
  const artwork = await registerArtwork(app, db, auth, config, vault);
  const playback = await registerPlayback(app, db, auth, config, vault);
  await app.register(
    async (routes) => {
      routes.addHook('preHandler', async (request, reply) => {
        const user = auth.currentUser(request.cookies[config.cookieName]);
        if (!user) return reply.code(401).send({ error: 'Authentication required' });
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
      let discovery: AbortController | undefined;
      routes.addHook('preClose', async () => discovery?.abort());
      routes.post(
        '/connectors/discover',
        {
          config: { rateLimit: { max: 2, timeWindow: '1 minute' } },
          schema: { body: { type: 'object', additionalProperties: false, properties: {} } },
        },
        async (request, reply) => {
          if (auth.currentUser(request.cookies[config.cookieName])?.role !== 'admin')
            return reply.code(403).send({ error: 'Administrator access required' });
          if (discovery) return reply.code(409).send({ error: 'Discovery is already running' });
          const token = request.cookies[config.cookieName];
          const userId = auth.currentUser(token)?.id;
          const controller = new AbortController();
          discovery = controller;
          const cancel = () => controller.abort();
          reply.raw.once('close', cancel);
          try {
            const result = await discoverJellyfin(controller.signal);
            if (auth.currentUser(token)?.id !== userId)
              return reply.code(401).send({ error: 'Authentication required' });
            return reply.header('Cache-Control', 'no-store').send(result);
          } finally {
            reply.raw.removeListener('close', cancel);
            discovery = undefined;
          }
        },
      );
      routes.delete<{ Body: { baseUrl: string; serverId: string } }>(
        '/connectors/approved-server',
        {
          schema: {
            body: {
              type: 'object',
              additionalProperties: false,
              required: ['baseUrl', 'serverId'],
              properties: {
                baseUrl: { type: 'string', minLength: 1, maxLength: 2048 },
                serverId: { type: 'string', pattern: '^[a-fA-F0-9-]{16,64}$' },
              },
            },
          },
        },
        async (request, reply) => {
          if (auth.currentUser(request.cookies[config.cookieName])?.role !== 'admin')
            return reply.code(403).send({ error: 'Administrator access required' });
          return run(async () => {
            const outcome = db.forgetApprovedServer(
              validateJellyfinUrl(request.body.baseUrl),
              request.body.serverId,
            );
            if (outcome === 'in_use')
              return reply
                .code(409)
                .send({ error: 'All users must disconnect this server first.' });
            if (outcome === 'not_found')
              return reply
                .code(404)
                .send({ error: 'Approved server not found or identity changed.' });
            return { removed: true };
          });
        },
      );
      routes.get('/connectors', async (request, reply) => {
        const token = request.cookies[config.cookieName],
          user = auth.currentUser(token)!;
        const scoped = db.forUser(user.id);
        const connectors = [];
        const deadline = Date.now() + 8000;
        for (const record of scoped.listConnectors()) {
          const projected = summary(record);
          try {
            if (!vault || Date.now() > deadline) throw new ConnectorError('credential_unavailable');
            projected.libraries = await createJellyfinConnector(
              { baseUrl: record.baseUrl, credential: { id: record.id } },
              vault.forUser(user.id),
            ).getLibraries();
          } catch {
            projected.libraries = [];
            projected.state = 'error';
            projected.lastError = 'unavailable';
          }
          if (auth.currentUser(token)?.id !== user.id)
            return reply.code(401).send({ error: 'Authentication required' });
          if (scoped.getConnector(record.id)) connectors.push(projected);
        }
        return {
          connectors,
          approvedServers: db.approvedServers(),
          canRegisterServers: user.role === 'admin',
          credentialStorageConfigured: Boolean(vault),
        };
      });
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
          const token = request.cookies[config.cookieName];
          const user = auth.currentUser(token)!;
          try {
            return await run(async (store) => {
              if (db.forUser(user.id).listConnectors().length >= 10 || !request.body.name.trim())
                throw new ConnectorError('invalid_configuration');
              const id = randomUUID();
              const baseUrl = validateJellyfinUrl(request.body.baseUrl);
              const approved = db.approvedServers().find((server) => server.baseUrl === baseUrl);
              if (
                (!approved && user.role !== 'admin') ||
                db
                  .forUser(user.id)
                  .listConnectors()
                  .some((c) => c.baseUrl === baseUrl)
              )
                throw new ConnectorError('invalid_configuration');
              const result = await authenticateJellyfin({
                ...(approved ? { expectedServerId: approved.serverId } : {}),
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
                  if (auth.currentUser(token)?.id !== user.id)
                    throw new ConnectorError('cancelled');
                  db.transaction(() => {
                    store.create(record, result.secret, user.id);
                    if (user.role === 'admin')
                      db.approveServer(baseUrl, result.server.id, result.server.name);
                  });
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
            const user = auth.currentUser(request.cookies[config.cookieName])!;
            const record = db.forUser(user.id).getConnector(request.params.id);
            if (!record) throw new ConnectorError('not_found');
            const connector = createJellyfinConnector(
              { baseUrl: record.baseUrl, credential: { id: record.id } },
              store.forUser(user.id),
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
              if (auth.currentUser(request.cookies[config.cookieName])?.id !== user.id)
                throw new ConnectorError('cancelled');
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
        async (request) => {
          const token = request.cookies[config.cookieName];
          const owner = auth.currentUser(token)!;
          if (!db.forUser(owner.id).getConnector(request.params.id))
            throw new ConnectorError('not_found');
          await catalog.cancelConnector(request.params.id);
          if (auth.currentUser(token)?.id !== owner.id) throw new ConnectorError('cancelled');
          return run(async (store) => {
            const user = auth.currentUser(request.cookies[config.cookieName])!;
            const record = db.forUser(user.id).getConnector(request.params.id);
            if (!record) throw new ConnectorError('not_found');
            const finishRemoval = await playback.prepareRemoval(record.id);
            try {
              let revocation: 'confirmed' | 'unconfirmed' = 'confirmed';
              try {
                await createJellyfinConnector(
                  { baseUrl: record.baseUrl, credential: { id: record.id } },
                  store.forUser(user.id),
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
          });
        },
      );
    },
    { prefix: API_PREFIX },
  );
  return {
    async endLogin(token: string | undefined) {
      catalog.endLogin(token);
      artwork.endLogin(token);
      await playback.endLogin(token);
    },
  };
}
