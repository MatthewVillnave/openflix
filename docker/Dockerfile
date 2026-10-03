# syntax=docker/dockerfile:1
FROM node:24.19.0-bookworm-slim AS dependencies
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN npm install --global pnpm@11.19.0
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build:packages
RUN mkdir -p /config && chown -R node:node /app /config

FROM dependencies AS development
USER node
CMD ["pnpm", "dev"]

FROM dependencies AS build
RUN pnpm build
RUN pnpm --filter @openflix/server deploy --prod /out
# The output must work after the build workspace is removed.
RUN mv /app /workspace-build && cd /out && node --input-type=module -e "await import('./dist/app.js')" && mv /workspace-build /app

FROM node:24.19.0-bookworm-slim AS server
ENV NODE_ENV=production OPENFLIX_HOST=0.0.0.0 OPENFLIX_PORT=8787 OPENFLIX_DATA_DIR=/config
WORKDIR /app
RUN mkdir /config && chown node:node /config
COPY --from=build --chown=node:node /out/ ./
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD node -e "fetch('http://127.0.0.1:8787/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]

FROM nginx:1.30.5-alpine AS web
COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
USER nginx
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD wget -q -O /dev/null http://127.0.0.1:8080/health || exit 1
ENTRYPOINT ["nginx"]
CMD ["-g", "daemon off;"]

# Disposable HTTPS/browser verification, excluded from production images.
FROM node:24.19.0-bookworm-slim AS browser-verification
RUN apt-get update && apt-get install -y --no-install-recommends chromium libnss3-tools openssl && rm -rf /var/lib/apt/lists/*
RUN npm install --prefix /opt/browser --ignore-scripts playwright-core@1.62.1
WORKDIR /app
COPY docker/verify-browser.mjs docker/verify-browser.mjs
USER node
CMD ["node", "docker/verify-browser.mjs"]
