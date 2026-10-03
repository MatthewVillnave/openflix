import { buildApp } from './app.js';
import type { Config } from './config.js';
export async function startServer(config: Config) {
  const app = await buildApp(config);
  try {
    await app.listen({ host: config.host, port: config.port });
    return app;
  } catch (error) {
    await app.close();
    throw error;
  }
}
