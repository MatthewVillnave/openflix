import { loadConfig } from './config.js';
import { startServer } from './lifecycle.js';
process.umask(0o077);
try {
  const app = await startServer(loadConfig());
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => {
      process.exit(1);
    }, 10000).unref();
    try {
      await app.close();
    } catch {
      process.exitCode = 1;
    } finally {
      clearTimeout(deadline);
    }
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
} catch {
  // Config values and driver errors can contain secrets; don't print arbitrary errors.
  console.error(
    'OpenFlix startup failed. Check configuration, database permissions, migrations, and port availability.',
  );
  process.exitCode = 1;
}
