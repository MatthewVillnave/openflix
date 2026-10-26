import { catalogPermissions } from './catalog-permissions.js';
import { ConnectorError, isConnectorError } from '@openflix/connector-core';
import type { ManagedMediaConnector } from '@openflix/connector-core';
import type { OpenFlixDatabase } from '@openflix/database';
import { mediaTypes } from '@openflix/shared';
import { createJellyfinConnector } from '@openflix/connector-jellyfin';
import type { EncryptedCredentialStore } from './connector-credentials.js';
import type { AuthService } from './auth.js';
import type { Config } from './config.js';
import type { registerConnectors } from './connectors.js';
type App = Parameters<typeof registerConnectors>[0];
/** A full scan publishes atomically; partial scans only write disposable disk staging. */
export async function synchronizeCatalog(
  db: OpenFlixDatabase,
  connectorId: string,
  connector: ManagedMediaConnector,
  libraryId: string | null = null,
  signal?: AbortSignal,
  permitted: () => boolean = () => true,
) {
  const selected = libraryId ? db.catalog.library(libraryId) : undefined;
  if (libraryId && (!selected || selected.connectorId !== connectorId))
    throw new ConnectorError('not_found');
  const runId = db.catalog.begin(connectorId, libraryId);
  try {
    const libraries = await connector.getLibraries();
    if (libraries.length > 1000 || new Set(libraries.map((v) => v.id)).size !== libraries.length)
      throw new ConnectorError('invalid_response');
    const scan = selected ? libraries.filter((v) => v.id === selected.upstreamId) : libraries;
    // Missing selected library is not proof that an arbitrary targeted scan succeeded.
    if (selected && scan.length !== 1) throw new ConnectorError('not_found');
    for (const library of scan) {
      signal?.throwIfAborted();
      db.catalog.stageLibrary(runId, library);
      for await (const page of connector.scanCatalog(library.id, {
        pageSize: 100,
        ...(signal ? { signal } : {}),
      })) {
        signal?.throwIfAborted();
        db.catalog.stagePage(runId, library.id, page);
      }
    }
    signal?.throwIfAborted();
    if (!permitted()) throw new ConnectorError('cancelled');
    db.catalog.publish(runId);
  } catch (error) {
    const safe = isConnectorError(error)
      ? error
      : new ConnectorError(signal?.aborted ? 'timeout' : 'invalid_response');
    db.catalog.fail(runId, safe.code);
    throw safe;
  }
  return db.catalog.status(connectorId);
}
export async function registerCatalog(
  app: App,
  db: OpenFlixDatabase,
  auth: AuthService,
  config: Config,
  run: <T>(action: (store: EncryptedCredentialStore) => Promise<T>) => Promise<T>,
  isBusy: () => boolean,
  vault?: EncryptedCredentialStore,
) {
  const verify = catalogPermissions(db, auth, vault);
  db.catalog.recover();
  let job: Promise<unknown> | undefined;
  let stop: AbortController | undefined;
  let jobToken: string | undefined;
  let jobConnector: string | undefined;
  app.addHook('preClose', async () => {
    stop?.abort();
    await job;
  });
  await app.register(
    async (routes) => {
      routes.addHook('onSend', async (request, reply, payload) => {
        if (request.method !== 'GET' || reply.statusCode !== 200 || typeof payload !== 'string')
          return payload;
        const value = JSON.parse(payload) as Record<string, unknown>;
        if (!value.items && !value.work && !value.libraries) return payload;
        const token = request.cookies[config.cookieName];
        try {
          await verify(token, value);
          return payload;
        } catch (error) {
          request.log.info(
            {
              event: 'catalog.permission_failed',
              code: isConnectorError(error) ? error.code : 'invalid_response',
            },
            'Catalog permission verification failed',
          );
          reply.code(auth.currentUser(token) ? 503 : 401);
          return JSON.stringify({
            error:
              'Catalog permissions could not be verified. Check your connection and synchronize again.',
          });
        }
      });
      routes.addHook('preHandler', async (request, reply) => {
        const user = auth.currentUser(request.cookies[config.cookieName]);
        if (!user) return reply.code(401).send({ error: 'Authentication required' });
      });
      const pagination = {
        offset: { type: 'string', pattern: '^[0-9]{1,7}$' },
        limit: { type: 'string', pattern: '^[0-9]{1,3}$' },
      };
      const bounds = (q: { offset?: string; limit?: string }) => ({
        offset: Number(q.offset ?? 0),
        limit: Number(q.limit ?? 50),
      });
      routes.get<{
        Querystring: {
          offset?: string;
          limit?: string;
          type?: string;
          connectorId?: string;
          seriesWorkId?: string;
          seasonNumber?: string;
        };
      }>(
        '/works',
        {
          schema: {
            querystring: {
              type: 'object',
              additionalProperties: false,
              properties: {
                ...pagination,
                type: { type: 'string', enum: mediaTypes },
                connectorId: { type: 'string', maxLength: 128 },
                seriesWorkId: { type: 'string', pattern: '^work_[a-f0-9]{64}$' },
                seasonNumber: { type: 'string', pattern: '^[0-9]{1,6}$' },
              },
            },
          },
        },
        async (request, reply) => {
          const { offset, limit } = bounds(request.query);
          if (limit < 1 || limit > 100 || offset > 1000000)
            return reply.code(400).send({ error: 'Invalid pagination' });
          const { type, connectorId, seriesWorkId, seasonNumber } = request.query;
          return db.forUser(auth.currentUser(request.cookies[config.cookieName])!.id).works.browse({
            offset,
            limit,
            ...(type ? { type } : {}),
            ...(connectorId ? { connectorId } : {}),
            ...(seriesWorkId ? { seriesWorkId } : {}),
            ...(seasonNumber ? { seasonNumber: Number(seasonNumber) } : {}),
          });
        },
      );
      routes.get<{ Params: { id: string }; Querystring: { offset?: string; limit?: string } }>(
        '/works/:id',
        {
          schema: {
            params: {
              type: 'object',
              required: ['id'],
              properties: { id: { type: 'string', pattern: '^work_[a-f0-9]{64}$' } },
            },
            querystring: { type: 'object', additionalProperties: false, properties: pagination },
          },
        },
        async (request, reply) => {
          const { offset, limit } = bounds(request.query);
          if (limit < 1 || limit > 100 || offset > 1000000)
            return reply.code(400).send({ error: 'Invalid pagination' });
          const work = db
            .forUser(auth.currentUser(request.cookies[config.cookieName])!.id)
            .works.work(request.params.id);
          return work
            ? {
                work,
                sources: db
                  .forUser(auth.currentUser(request.cookies[config.cookieName])!.id)
                  .works.sources(work.id, offset, limit),
              }
            : reply.code(404).send({ error: 'Work not found' });
        },
      );
      routes.get('/libraries', async (request) => ({
        libraries: db
          .forUser(auth.currentUser(request.cookies[config.cookieName])!.id)
          .catalog.libraries(),
      }));
      routes.get<{
        Params: { id: string };
        Querystring: { offset?: string; limit?: string; type?: string; parentId?: string };
      }>(
        '/libraries/:id/items',
        {
          schema: {
            querystring: {
              type: 'object',
              additionalProperties: false,
              properties: {
                offset: { type: 'string', pattern: '^[0-9]{1,7}$' },
                limit: { type: 'string', pattern: '^[0-9]{1,3}$' },
                type: { type: 'string', enum: mediaTypes },
                parentId: { type: 'string', pattern: '^item_[a-f0-9]{64}$' },
              },
            },
          },
        },
        async (request, reply) => {
          if (
            !db
              .forUser(auth.currentUser(request.cookies[config.cookieName])!.id)
              .catalog.library(request.params.id)
          )
            return reply.code(404).send({ error: 'Library not found' });
          const offset = Number(request.query.offset ?? 0),
            limit = Number(request.query.limit ?? 50);
          if (limit < 1 || limit > 100 || offset > 1000000)
            return reply.code(400).send({ error: 'Invalid pagination' });
          return db
            .forUser(auth.currentUser(request.cookies[config.cookieName])!.id)
            .catalog.browse(request.params.id, {
              offset,
              limit,
              ...(request.query.type ? { type: request.query.type } : {}),
              ...(request.query.parentId ? { parentId: request.query.parentId } : {}),
            });
        },
      );
      routes.get<{ Params: { id: string } }>('/items/:id', async (request, reply) => {
        const token = request.cookies[config.cookieName];
        const user = auth.currentUser(token)!;
        const scoped = db.forUser(user.id);
        const item = scoped.catalog.item(request.params.id);
        const record = item && scoped.getConnector(item.connectorId);
        if (!item || !record) return reply.code(404).send({ error: 'Item not found' });
        if (!vault) return reply.code(503).send({ error: 'Item unavailable' });
        try {
          await createJellyfinConnector(
            { baseUrl: record.baseUrl, credential: { id: record.id } },
            vault.forUser(user.id),
          ).getItem(item.upstreamId);
        } catch {
          return reply.code(404).send({ error: 'Item unavailable' });
        }
        if (auth.currentUser(token)?.id !== user.id)
          return reply.code(401).send({ error: 'Authentication required' });
        if (!scoped.catalog.item(item.id) || !scoped.getConnector(record.id))
          return reply.code(404).send({ error: 'Item unavailable' });
        return { item };
      });
      routes.get<{ Params: { id: string } }>('/sync/:id', async (request, reply) => {
        if (
          !db
            .forUser(auth.currentUser(request.cookies[config.cookieName])!.id)
            .getConnector(request.params.id)
        )
          return reply.code(404).send({ error: 'Connection not found' });
        return db
          .forUser(auth.currentUser(request.cookies[config.cookieName])!.id)
          .catalog.status(request.params.id);
      });
      routes.post<{ Params: { id: string }; Body: { libraryId?: string } }>(
        '/sync/:id',
        {
          schema: {
            body: {
              type: 'object',
              additionalProperties: false,
              properties: { libraryId: { type: 'string', pattern: '^lib_[a-f0-9]{64}$' } },
            },
          },
          config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
        },
        async (request, reply) => {
          const record = db
            .forUser(auth.currentUser(request.cookies[config.cookieName])!.id)
            .getConnector(request.params.id);
          if (!record) return reply.code(404).send({ error: 'Connection not found' });
          if (!config.masterKey)
            return reply.code(503).send({ error: 'Credential storage unavailable' });
          if (isBusy()) return reply.code(503).send({ error: 'Connector operation in progress' });
          const libraryId = request.body.libraryId ?? null;
          if (
            libraryId &&
            db
              .forUser(auth.currentUser(request.cookies[config.cookieName])!.id)
              .catalog.library(libraryId)?.connectorId !== record.id
          )
            return reply.code(404).send({ error: 'Library not found' });
          const token = request.cookies[config.cookieName];
          const userId = auth.currentUser(token)!.id;
          jobToken = token;
          jobConnector = record.id;
          stop = new AbortController();
          const signal = AbortSignal.any([stop.signal, AbortSignal.timeout(30 * 60 * 1000)]);
          job = run((store) =>
            synchronizeCatalog(
              db,
              record.id,
              createJellyfinConnector(
                { baseUrl: record.baseUrl, credential: { id: record.id } },
                store.forUser(userId),
              ),
              libraryId,
              signal,
              () =>
                auth.currentUser(token)?.id === userId &&
                !!db.forUser(userId).getConnector(record.id),
            ),
          )
            .then(() => {
              app.log.info(
                { event: 'catalog.synced', connector_id: record.id },
                'Catalog synchronized',
              );
            })
            .catch((error) => {
              app.log.info(
                {
                  event: 'catalog.failed',
                  code: isConnectorError(error) ? error.code : 'invalid_response',
                },
                'Catalog synchronization failed',
              );
            });
          return reply
            .code(202)
            .send(
              db
                .forUser(auth.currentUser(request.cookies[config.cookieName])!.id)
                .catalog.status(record.id),
            );
        },
      );
    },
    { prefix: '/api/v1/catalog' },
  );
  return {
    async cancelConnector(id: string) {
      if (id === jobConnector) {
        stop?.abort();
        await job;
      }
    },
    endLogin(token: string | undefined) {
      if (token && token === jobToken) stop?.abort();
    },
  };
}
