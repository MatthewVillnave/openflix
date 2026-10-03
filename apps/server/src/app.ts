import { randomUUID } from 'node:crypto';
import Fastify, { LogController } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { openDatabase } from '@openflix/database';
import { API_PREFIX } from '@openflix/protocol';
import type { CurrentUserResponse, HealthResponse } from '@openflix/protocol';
import type { Config } from './config.js';
import { AuthService, AuthBusyError } from './auth.js';
import { createLogger } from './logger.js';
export async function buildApp(config: Config, logger = createLogger(config)) {
  const db = openDatabase(config.databasePath);
  const app = Fastify({
    loggerInstance: logger,
    logController: new LogController({ disableRequestLogging: true }),
    requestIdHeader: false,
    genReqId: () => randomUUID(),
    bodyLimit: 8192,
    requestTimeout: 15000,
    connectionTimeout: 15000,
    keepAliveTimeout: 5000,
    trustProxy: false,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
  });
  app.addHook('onClose', async () => {
    db.close();
  });
  try {
    const auth = await AuthService.create(db, config.sessionTtlSeconds);
    await app.register(cookie);
    await app.register(helmet, { hsts: config.secureCookies });
    await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });
    app.addHook('onRequest', async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      reply.header('X-Request-Id', request.id);
      if (
        !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
        request.headers.origin !== config.origin
      ) {
        return reply.code(403).send({ error: 'Origin not allowed' });
      }
    });
    app.addHook('onResponse', async (request, reply) => {
      request.log.info(
        {
          event: 'http.completed',
          method: request.method,
          route: request.routeOptions.url ?? 'unmatched',
          status: reply.statusCode,
        },
        'Request completed',
      );
    });
    app.setErrorHandler((error, request, reply) => {
      const status = (error as { statusCode?: number }).statusCode;
      if (status && status >= 400 && status < 500)
        return reply
          .code(status)
          .send({ error: status === 429 ? 'Too many requests' : 'Invalid request' });
      request.log.error({ event: 'http.error' }, 'Internal request failure');
      return reply.code(500).send({ error: 'Internal server error' });
    });
    app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: 'Not found' }));
    app.get('/health', async (_request, reply): Promise<HealthResponse> => {
      try {
        if (db.healthy()) return { status: 'healthy', database: 'ok' };
      } catch {
        /* sanitized below */
      }
      reply.code(503);
      return { status: 'unhealthy', database: 'unavailable' };
    });
    const cookieOptions = {
      path: '/',
      httpOnly: true,
      secure: config.secureCookies,
      sameSite: 'strict' as const,
    };
    app.post<{ Body: { username: string; password: string } }>(
      `${API_PREFIX}/auth/login`,
      {
        config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
        schema: {
          body: {
            type: 'object',
            additionalProperties: false,
            required: ['username', 'password'],
            properties: {
              username: {
                type: 'string',
                minLength: 3,
                maxLength: 64,
                pattern: '^[a-zA-Z0-9_.-]+$',
              },
              password: { type: 'string', minLength: 1, maxLength: 1024 },
            },
          },
        },
      },
      async (request, reply) => {
        if (Buffer.byteLength(request.body.password, 'utf8') > 1024)
          return reply.code(400).send({ error: 'Invalid request' });
        try {
          const result = await auth.login(
            request.body.username,
            request.body.password,
            request.cookies[config.cookieName],
          );
          if (!result) {
            request.log.info({ event: 'auth.login_failed' }, 'Login failed');
            return reply.code(401).send({ error: 'Invalid username or password' });
          }
          reply.setCookie(config.cookieName, result.token, {
            ...cookieOptions,
            maxAge: config.sessionTtlSeconds,
          });
          request.log.info({ event: 'auth.login', user_id: result.user.id }, 'Login succeeded');
          return { user: result.user } satisfies CurrentUserResponse;
        } catch (error) {
          if (error instanceof AuthBusyError)
            return reply
              .code(503)
              .header('Retry-After', '1')
              .send({ error: 'Authentication busy' });
          throw error;
        }
      },
    );
    app.post(`${API_PREFIX}/auth/logout`, async (request, reply) => {
      auth.logout(request.cookies[config.cookieName]);
      reply.clearCookie(config.cookieName, cookieOptions);
      return reply.code(204).send();
    });
    app.get(`${API_PREFIX}/me`, async (request, reply) => {
      const user = auth.currentUser(request.cookies[config.cookieName]);
      if (!user) return reply.code(401).send({ error: 'Authentication required' });
      return { user } satisfies CurrentUserResponse;
    });
    await app.ready();
    return app;
  } catch (error) {
    await app.close();
    throw error;
  }
}
