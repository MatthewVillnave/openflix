import { createServer } from 'node:net';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { expect, it } from 'vitest';
import { startServer } from '../apps/server/src/lifecycle.js';
import { temporaryConfig } from './helpers.js';
it('opens a real HTTP listener, serves health, closes and releases its port', async () => {
  const fixture = temporaryConfig();
  const app = await startServer({ ...fixture.config, port: 0 });
  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('Missing address');
  try {
    expect((await fetch(`http://127.0.0.1:${address.port}/health`)).status).toBe(200);
    await app.close();
    await expect(fetch(`http://127.0.0.1:${address.port}/health`)).rejects.toThrow();
    const again = await startServer({ ...fixture.config, port: address.port });
    await again.close();
  } finally {
    await app.close();
    fixture.cleanup();
  }
});
it('cleans up a failed bind and permits a subsequent startup', async () => {
  const fixture = temporaryConfig();
  const blocker = createServer();
  blocker.listen(0, '127.0.0.1');
  await once(blocker, 'listening');
  const address = blocker.address();
  if (!address || typeof address === 'string') throw new Error('Missing port');
  try {
    await expect(startServer({ ...fixture.config, port: address.port })).rejects.toThrow();
    await new Promise<void>((resolve, reject) =>
      blocker.close((error) => (error ? reject(error) : resolve())),
    );
    const app = await startServer({ ...fixture.config, port: address.port });
    await app.close();
  } finally {
    if (blocker.listening) blocker.close();
    fixture.cleanup();
  }
});
it.each(['SIGINT', 'SIGTERM'] as const)(
  'shuts down the actual entrypoint on %s',
  async (signal) => {
    const fixture = temporaryConfig();
    const probe = createServer();
    probe.listen(0, '127.0.0.1');
    await once(probe, 'listening');
    const address = probe.address();
    if (!address || typeof address === 'string') throw new Error('Missing port');
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    const child = spawn(process.execPath, ['apps/server/dist/main.js'], {
      env: {
        ...process.env,
        NODE_ENV: 'test',
        OPENFLIX_DATA_DIR: fixture.directory,
        OPENFLIX_HOST: '127.0.0.1',
        OPENFLIX_PORT: String(address.port),
        OPENFLIX_LOG_LEVEL: 'info',
        OPENFLIX_BASE_URL: 'http://localhost:5173',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const exited = once(child, 'exit');
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Startup timeout')), 7000);
        child.stdout.on('data', (chunk) => {
          if (String(chunk).includes('Server listening')) {
            clearTimeout(timer);
            resolve();
          }
        });
        child.once('exit', () => {
          clearTimeout(timer);
          reject(new Error('Exited before readiness'));
        });
      });
      expect((await fetch(`http://127.0.0.1:${address.port}/health`)).ok).toBe(true);
      child.kill(signal);
      expect(await exited).toEqual([0, null]);
    } finally {
      if (child.exitCode === null) {
        child.kill('SIGKILL');
        await exited;
      }
      fixture.cleanup();
    }
  },
);
