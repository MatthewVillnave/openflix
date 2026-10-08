import { createHash, randomUUID } from 'node:crypto';
import type { Server, IncomingMessage, ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';
import type { OpenFlixDatabase } from '@openflix/database';
import { isConnectorError } from '@openflix/connector-core';
import type {
  ClientProfile,
  ManagedMediaConnector,
  PlaybackInfo,
  PlaybackSession,
} from '@openflix/connector-core';
import { playbackFormats } from '@openflix/shared';
import type { PlaybackView } from '@openflix/shared';
import { createJellyfinConnector } from '@openflix/connector-jellyfin';
import type { Config } from './config.js';
import type { AuthService } from './auth.js';
import type { EncryptedCredentialStore } from './connector-credentials.js';
import type { createLogger } from './logger.js';
const digest = (token: string) => createHash('sha256').update(token).digest('hex');
type App = FastifyInstance<
  Server,
  IncomingMessage,
  ServerResponse,
  ReturnType<typeof createLogger>
>;
interface Grant {
  id: string;
  userId: string;
  loginDigest: string;
  itemId: string;
  connectorId: string;
  expiresAt: number;
  idleAt: number;
  plan: PlaybackInfo;
  connector: ManagedMediaConnector;
  positionMs: number;
  paused: boolean;
  started: boolean;
  reporting: boolean;
  streams: Set<AbortController>;
}
/** Small in-process broker; no credential/URL/session persistence and no catalog-based implicit permission. */
export async function registerPlayback(
  app: App,
  db: OpenFlixDatabase,
  auth: AuthService,
  config: Config,
  store: EncryptedCredentialStore | undefined,
) {
  const grants = new Map<string, Grant>();
  const cleanup = new Set<Promise<unknown>>();
  let pending = 0,
    closing = false;
  const state = (g: Grant): PlaybackSession => ({
    id: g.plan.sessionId,
    itemId: g.plan.itemId,
    sourceId: g.plan.sourceId,
    durationMs: g.plan.durationMs,
    positionMs: g.positionMs,
    paused: g.paused,
  });
  const retire = (g: Grant) => {
    if (!grants.delete(g.id)) return;
    for (const abort of g.streams) abort.abort();
    if (g.started) {
      const job = g.connector.reportPlaybackStop(state(g)).catch(() => {
        app.log.info(
          { event: 'playback.cleanup_unconfirmed' },
          'Upstream playback cleanup unconfirmed',
        );
      });
      cleanup.add(job);
      void job.finally(() => cleanup.delete(job));
    }
  };
  const active = (g: Grant) => {
    const now = Date.now();
    const user = db.sessionUser(g.loginDigest, now);
    const item = db.catalog.item(g.itemId);
    return (
      !closing &&
      now < g.expiresAt &&
      now < g.idleAt &&
      user?.id === g.userId &&
      user.role === 'admin' &&
      item?.connectorId === g.connectorId &&
      db.getConnector(g.connectorId) !== undefined
    );
  };
  const sweep = setInterval(() => {
    for (const g of grants.values()) if (!active(g)) retire(g);
  }, 1000);
  sweep.unref();
  app.addHook('preClose', async () => {
    closing = true;
    clearInterval(sweep);
    for (const g of grants.values()) retire(g);
    await Promise.allSettled(cleanup);
  });
  const schemaId = {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: { id: { type: 'string', format: 'uuid' } },
  };
  const emptyQuery = { type: 'object', additionalProperties: false, properties: {} };
  await app.register(
    async (routes) => {
      routes.addHook('preHandler', async (request, reply) => {
        const user = auth.currentUser(request.cookies[config.cookieName]);
        if (!user)
          return reply.code(401).send({ error: 'Authentication required', code: 'unauthorized' });
        if (user.role !== 'admin')
          return reply
            .code(403)
            .send({ error: 'Playback is restricted to administrators', code: 'forbidden' });
        if (request.headers['sec-fetch-site'] === 'cross-site')
          return reply.code(403).send({ error: 'Cross-site playback denied', code: 'forbidden' });
      });
      routes.setErrorHandler((error, request, reply) => {
        if (isConnectorError(error)) {
          const status =
            error.code === 'unsupported'
              ? 415
              : error.code === 'not_found'
                ? 404
                : error.code === 'invalid_configuration'
                  ? 400
                  : 502;
          request.log.info(
            { event: 'playback.failed', code: error.code },
            'Playback request failed',
          );
          return reply.code(status).send({ error: error.message, code: error.code });
        }
        const status = (error as { statusCode?: number }).statusCode;
        if (status && status >= 400 && status < 500)
          return reply
            .code(status)
            .send({ error: 'Invalid playback request', code: 'invalid_request' });
        request.log.error({ event: 'playback.error' }, 'Playback initialization failed');
        return reply
          .code(500)
          .send({ error: 'Playback initialization failed', code: 'initialization_failed' });
      });
      routes.post<{ Body: { itemId: string; profile: ClientProfile } }>(
        '/sessions',
        {
          config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
          schema: {
            querystring: emptyQuery,
            body: {
              type: 'object',
              additionalProperties: false,
              required: ['itemId', 'profile'],
              properties: {
                itemId: { type: 'string', pattern: '^item_[a-f0-9]{64}$' },
                profile: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['formats'],
                  properties: {
                    formats: {
                      type: 'array',
                      minItems: 1,
                      maxItems: 4,
                      uniqueItems: true,
                      items: { type: 'string', enum: Object.keys(playbackFormats) },
                    },
                  },
                },
              },
            },
          },
        },
        async (request, reply) => {
          if (!store)
            return reply
              .code(503)
              .send({ error: 'Credential storage unavailable', code: 'credential_unavailable' });
          const user = auth.currentUser(request.cookies[config.cookieName])!;
          if (
            closing ||
            pending + grants.size + cleanup.size >= 8 ||
            [...grants.values()].filter((g) => g.userId === user.id).length >= 2
          )
            return reply.code(429).send({ error: 'Playback capacity reached', code: 'busy' });
          const item = db.catalog.item(request.body.itemId);
          if (!item)
            return reply.code(404).send({ error: 'Catalog item not found', code: 'not_found' });
          if (!['movie', 'episode', 'audio'].includes(item.type))
            return reply
              .code(415)
              .send({ error: 'This catalog object is not playable', code: 'unsupported' });
          const record = db.getConnector(item.connectorId);
          if (!record)
            return reply.code(404).send({ error: 'Source not found', code: 'not_found' });
          pending++;
          try {
            const connector = createJellyfinConnector(
              { baseUrl: record.baseUrl, credential: { id: record.id } },
              store,
            );
            const plan = await connector.getPlaybackInfo(item.upstreamId, request.body.profile);
            if ((item.type === 'audio') !== (plan.kind === 'audio'))
              return reply
                .code(502)
                .send({ error: 'Invalid media source', code: 'invalid_response' });
            const now = Date.now();
            const g: Grant = {
              id: randomUUID(),
              userId: user.id,
              loginDigest: digest(request.cookies[config.cookieName]!),
              itemId: item.id,
              connectorId: record.id,
              expiresAt: now + 4 * 60 * 60 * 1000,
              idleAt: now + 5 * 60 * 1000,
              plan,
              connector,
              positionMs: 0,
              paused: true,
              started: false,
              reporting: false,
              streams: new Set(),
            };
            // Revalidate after upstream awaits: logout/removal/expiry must not race initialization.
            if (!active(g))
              return reply
                .code(410)
                .send({ error: 'Playback authorization expired', code: 'expired' });
            if ([...grants.values()].filter((v) => v.userId === user.id).length >= 2)
              return reply.code(429).send({ error: 'Playback capacity reached', code: 'busy' });
            grants.set(g.id, g);
            const result: PlaybackView = {
              id: g.id,
              itemId: item.id,
              kind: plan.kind,
              mode: 'direct',
              contentType: plan.contentType,
              durationMs: plan.durationMs,
              expiresAt: g.expiresAt,
              streamPath: `/api/v1/playback/sessions/${g.id}/stream`,
            };
            return reply.code(201).send(result);
          } finally {
            pending--;
          }
        },
      );
      const find = (id: string, token: string | undefined) => {
        const g = grants.get(id);
        if (!g || !token || digest(token) !== g.loginDigest) return;
        if (!active(g)) {
          retire(g);
          return;
        }
        return g;
      };
      routes.route<{ Params: { id: string } }>({
        method: ['GET', 'HEAD'],
        url: '/sessions/:id/stream',
        exposeHeadRoute: false,
        schema: { params: schemaId, querystring: emptyQuery },
        handler: async (request, reply) => {
          const g = find(request.params.id, request.cookies[config.cookieName]);
          if (!g)
            return reply
              .code(410)
              .send({ error: 'Playback session expired or unavailable', code: 'expired' });
          const range = request.headers.range;
          if (
            range !== undefined &&
            (range.length > 40 ||
              !/^bytes=(\d{0,15})-(\d{0,15})$/.test(range) ||
              range === 'bytes=-' ||
              range === 'bytes=-0' ||
              (range.match(/^bytes=(\d+)-(\d+)$/) &&
                Number(range.split('=')[1]!.split('-')[0]) > Number(range.split('-')[1])))
          )
            return reply
              .code(416)
              .send({ error: 'Only one valid byte range is supported', code: 'invalid_range' });
          if (
            g.streams.size >= 2 ||
            [...grants.values()].reduce((n, v) => n + v.streams.size, 0) >= 16
          )
            return reply.code(429).send({ error: 'Too many active streams', code: 'busy' });
          const abort = new AbortController();
          g.streams.add(abort);
          let cancel: (() => void) | undefined;
          const release = () => {
            abort.abort();
            cancel?.();
            g.streams.delete(abort);
          };
          reply.raw.once('close', release);
          request.raw.once('aborted', release);
          try {
            const upstream = await g.connector.openPlaybackStream(g.plan, {
              method: request.method as 'GET' | 'HEAD',
              ...(range ? { range } : {}),
              signal: abort.signal,
            });
            cancel = upstream.cancel;
            if (abort.signal.aborted || !active(g)) {
              release();
              return reply.code(410).send({ error: 'Playback expired', code: 'expired' });
            }
            reply.code(upstream.status);
            for (const [key, value] of Object.entries(upstream.headers)) reply.header(key, value);
            reply.header('Cache-Control', 'private, no-store, no-transform');
            reply.header('X-Accel-Buffering', 'no');
            if (upstream.body) return reply.send(upstream.body);
            release();
            return reply.send();
          } catch (error) {
            release();
            throw error;
          }
        },
      });
      routes.post<{
        Params: { id: string };
        Body: { positionMs: number; paused: boolean; event: 'start' | 'progress' };
      }>(
        '/sessions/:id/progress',
        {
          schema: {
            params: schemaId,
            querystring: emptyQuery,
            body: {
              type: 'object',
              additionalProperties: false,
              required: ['positionMs', 'paused', 'event'],
              properties: {
                positionMs: { type: 'number', minimum: 0, maximum: 86400000 },
                paused: { type: 'boolean' },
                event: { type: 'string', enum: ['start', 'progress'] },
              },
            },
          },
        },
        async (request, reply) => {
          const g = find(request.params.id, request.cookies[config.cookieName]);
          if (!g)
            return reply
              .code(410)
              .send({ error: 'Playback session expired or unavailable', code: 'expired' });
          if (request.body.positionMs > g.plan.durationMs)
            return reply
              .code(400)
              .send({ error: 'Position exceeds duration', code: 'invalid_request' });
          if (g.reporting)
            return reply.code(409).send({ error: 'Playback report in progress', code: 'busy' });
          if (!g.started && request.body.event !== 'start')
            return reply
              .code(409)
              .send({ error: 'Playback has not started', code: 'invalid_request' });
          g.reporting = true;
          try {
            g.positionMs = request.body.positionMs;
            g.paused = request.body.paused;
            if (!g.started) {
              await g.connector.reportPlaybackStart(state(g));
              g.started = true;
            } else await g.connector.reportPlaybackProgress(state(g));
            if (!active(g) || !grants.has(g.id)) {
              // Stop a report that completed after expiry/removal instead of resurrecting its state.
              await g.connector.reportPlaybackStop(state(g));
              return reply.code(410).send({ error: 'Playback expired', code: 'expired' });
            }
            g.idleAt = Date.now() + 5 * 60 * 1000;
            return reply.code(204).send();
          } finally {
            g.reporting = false;
          }
        },
      );
      routes.post<{ Params: { id: string } }>(
        '/sessions/:id/stop',
        {
          schema: {
            params: schemaId,
            querystring: emptyQuery,
            body: { type: 'object', additionalProperties: false, properties: {} },
          },
        },
        async (request, reply) => {
          const g = find(request.params.id, request.cookies[config.cookieName]);
          if (!g)
            return reply
              .code(410)
              .send({ error: 'Playback session expired or unavailable', code: 'expired' });
          retire(g);
          return reply.code(204).send();
        },
      );
    },
    { prefix: '/api/v1/playback' },
  );
}
