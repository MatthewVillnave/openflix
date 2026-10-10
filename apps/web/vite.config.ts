import { fileURLToPath } from 'node:url';
import { legalAssets, sourceUrl } from '../../scripts/legal-assets.js';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  define: { __OPENFLIX_SOURCE_URL__: JSON.stringify(sourceUrl(process.env.OPENFLIX_SOURCE_URL)) },
  plugins: [
    react(),
    {
      name: 'openflix-legal-assets',
      generateBundle() {
        for (const [name, source] of Object.entries(
          legalAssets(fileURLToPath(new URL('../..', import.meta.url))),
        ))
          this.emitFile({ type: 'asset', fileName: `legal/${name}`, source });
      },
      configureServer(server) {
        const assets = legalAssets(fileURLToPath(new URL('../..', import.meta.url)));
        server.middlewares.use((request, response, next) => {
          const name = request.url?.startsWith('/legal/') ? request.url.slice(7) : '';
          if (!Object.hasOwn(assets, name) || !['GET', 'HEAD'].includes(request.method ?? ''))
            return next();
          response.setHeader('Content-Type', 'text/plain; charset=utf-8');
          response.setHeader('X-Content-Type-Options', 'nosniff');
          response.end(request.method === 'HEAD' ? undefined : assets[name]);
        });
      },
    },
  ],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': process.env.OPENFLIX_DEV_API_TARGET ?? 'http://127.0.0.1:8787',
      '/health': process.env.OPENFLIX_DEV_API_TARGET ?? 'http://127.0.0.1:8787',
    },
  },
});
