import { createServer } from 'node:http';
import { expect, it } from 'vitest';
import { binaryTransport } from '../packages/connector-jellyfin/dist/playback-transport.js';

it.each(['idle', 'intentional', 'deadline'] as const)(
  'distinguishes %s after upstream media headers',
  async (mode) => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'video/mp4' });
      res.write('test-byte');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error();
    const abort = new AbortController();
    try {
      const stream = await binaryTransport(
        { authorizationHeader: 'synthetic-only' } as Parameters<typeof binaryTransport>[0],
        new URL(`http://127.0.0.1:${address.port}/fixture`),
        { method: 'GET', signal: mode === 'deadline' ? AbortSignal.timeout(100) : abort.signal },
        'video/mp4',
        ['video/mp4'],
        undefined,
        1000,
        { resourceKind: 'segment' },
        mode === 'idle' ? 100 : 1000,
      );
      const read = (async () => {
        for await (const _chunk of stream.body!) {
          if (mode === 'intentional') abort.abort();
        }
      })();
      await expect(read).rejects.toMatchObject({
        code: mode === 'intentional' ? 'cancelled' : 'timeout',
        diagnostic: {
          stage: 'upstream_body',
          reason: mode === 'intentional' ? 'cancelled' : 'timeout',
        },
      });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);
