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
) {
  db.catalog.recover();
  let job: Promise<unknown> | undefined;
  let stop: AbortController | undefined;
  app.addHook('preClose', async () => {
    stop?.abort();
    await job;
  });
  await app.register(
    async (routes) => {
      routes.addHook('preHandler', async (request, reply) => {
        const user = auth.currentUser(request.cookies[config.cookieName]);
        if (!user) return reply.code(401).send({ error: 'Authentication required' });
        if (request.method !== 'GET' && user.role !== 'admin')
          return reply.code(403).send({ error: 'Administrator access required' });
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
          return db.works.browse({
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
          const work = db.works.work(request.params.id);
          return work
            ? { work, sources: db.works.sources(work.id, offset, limit) }
            : reply.code(404).send({ error: 'Work not found' });
        },
      );
      routes.get('/libraries', async () => ({ libraries: db.catalog.libraries() }));
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
          if (!db.catalog.library(request.params.id))
            return reply.code(404).send({ error: 'Library not found' });
          const offset = Number(request.query.offset ?? 0),
            limit = Number(request.query.limit ?? 50);
          if (limit < 1 || limit > 100 || offset > 1000000)
            return reply.code(400).send({ error: 'Invalid pagination' });
          return db.catalog.browse(request.params.id, {
            offset,
            limit,
            ...(request.query.type ? { type: request.query.type } : {}),
            ...(request.query.parentId ? { parentId: request.query.parentId } : {}),
          });
        },
      );
      routes.get<{ Params: { id: string } }>('/items/:id', async (request, reply) => {
        const item = db.catalog.item(request.params.id);
        return item ? { item } : reply.code(404).send({ error: 'Item not found' });
      });
      routes.get<{ Params: { id: string } }>('/sync/:id', async (request, reply) => {
        if (!db.getConnector(request.params.id))
          return reply.code(404).send({ error: 'Connection not found' });
        return db.catalog.status(request.params.id);
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
          const record = db.getConnector(request.params.id);
          if (!record) return reply.code(404).send({ error: 'Connection not found' });
          if (!config.masterKey)
            return reply.code(503).send({ error: 'Credential storage unavailable' });
          if (isBusy()) return reply.code(503).send({ error: 'Connector operation in progress' });
          const libraryId = request.body.libraryId ?? null;
          if (libraryId && db.catalog.library(libraryId)?.connectorId !== record.id)
            return reply.code(404).send({ error: 'Library not found' });
          stop = new AbortController();
          const signal = AbortSignal.any([stop.signal, AbortSignal.timeout(30 * 60 * 1000)]);
          job = run((store) =>
            synchronizeCatalog(
              db,
              record.id,
              createJellyfinConnector(
                { baseUrl: record.baseUrl, credential: { id: record.id } },
                store,
              ),
              libraryId,
              signal,
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
          return reply.code(202).send(db.catalog.status(record.id));
        },
      );
    },
    { prefix: '/api/v1/catalog' },
  );
}
