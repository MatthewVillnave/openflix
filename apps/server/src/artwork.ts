import { createJellyfinConnector } from '@openflix/connector-jellyfin';
import type { OpenFlixDatabase } from '@openflix/database';
import type { registerConnectors } from './connectors.js';
import type { AuthService } from './auth.js';
import type { Config } from './config.js';
import type { EncryptedCredentialStore } from './connector-credentials.js';
export async function registerArtwork(
  app: Parameters<typeof registerConnectors>[0],
  db: OpenFlixDatabase,
  auth: AuthService,
  config: Config,
  vault: EncryptedCredentialStore | undefined,
) {
  const active = new Map<AbortController, string>();
  app.addHook('preClose', async () => {
    for (const request of active.keys()) request.abort();
  });
  app.get<{ Params: { id: string; kind: 'poster' | 'backdrop' } }>(
    '/api/v1/catalog/items/:id/artwork/:kind',
    {
      schema: {
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'kind'],
          properties: {
            id: { type: 'string', pattern: '^item_[a-f0-9]{64}$' },
            kind: { type: 'string', enum: ['poster', 'backdrop'] },
          },
        },
        querystring: { type: 'object', additionalProperties: false, properties: {} },
      },
    },
    async (request, reply) => {
      const token = request.cookies[config.cookieName];
      const user = auth.currentUser(token);
      if (!user) return reply.code(401).send({ error: 'Authentication required' });
      const scoped = db.forUser(user.id);
      const item = scoped.catalog.item(request.params.id);
      const record = item && scoped.getConnector(item.connectorId);
      if (!item || !record) return reply.code(404).send({ error: 'Artwork unavailable' });
      if (!vault) return reply.code(503).send({ error: 'Artwork unavailable' });
      if (active.size >= 4) return reply.code(429).send({ error: 'Artwork busy' });
      const controller = new AbortController();
      active.set(controller, token!);
      const cancel = () => controller.abort();
      reply.raw.once('close', cancel);
      try {
        const connector = createJellyfinConnector(
          { baseUrl: record.baseUrl, credential: { id: record.id } },
          vault.forUser(user.id),
        );
        await connector.getItem(item.upstreamId);
        if (auth.currentUser(token)?.id !== user.id)
          return reply.code(401).send({ error: 'Authentication required' });
        const bytes = await connector.getArtwork!(
          item.upstreamId,
          request.params.kind,
          AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
        );
        // A revoked login or removed source must not receive a late response.
        if (auth.currentUser(token)?.id !== user.id)
          return reply.code(401).send({ error: 'Authentication required' });
        if (!scoped.catalog.item(item.id) || !scoped.getConnector(record.id))
          return reply.code(404).send({ error: 'Artwork unavailable' });
        return reply
          .header('Cache-Control', 'private, no-store')
          .header('X-Content-Type-Options', 'nosniff')
          .type('image/jpeg')
          .send(Buffer.from(bytes));
      } catch {
        if (auth.currentUser(token)?.id !== user.id)
          return reply.code(401).send({ error: 'Authentication required' });
        return reply.code(502).send({ error: 'Artwork unavailable' });
      } finally {
        active.delete(controller);
        reply.raw.removeListener('close', cancel);
      }
    },
  );
  return {
    endLogin(token: string | undefined) {
      for (const [controller, owner] of active) if (token === owner) controller.abort();
    },
  };
}
