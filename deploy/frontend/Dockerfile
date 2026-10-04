# syntax=docker/dockerfile:1
# Build context is an archive of AzizBokhidjonov/alishax at one exact commit.
FROM oven/bun:1.3.10 AS bun
FROM node:22-bookworm-slim AS build
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
COPY package.json bun.lock ./
# Upstream's initial lockfile has stale workspace metadata. Bun retains locked
# resolutions and reconciles that metadata; do not use a frozen install until
# the frontend team commits a synchronized lockfile.
RUN bun install
COPY . .
ARG VITE_API_BASE_URL=https://api.alishaxkids.uz/api/v1
ARG VITE_API_PROXY_TARGET=https://api.alishaxkids.uz
ARG VITE_LANDING_TENANT_CODE=
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_API_PROXY_TARGET=$VITE_API_PROXY_TARGET \
    VITE_LANDING_TENANT_CODE=$VITE_LANDING_TENANT_CODE \
    NITRO_PRESET=node-server
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ARG FRONTEND_REVISION=unknown
LABEL org.opencontainers.image.source="https://github.com/AzizBokhidjonov/alishax" \
      org.opencontainers.image.revision=$FRONTEND_REVISION
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /app/.output ./.output
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/kirish',{signal:AbortSignal.timeout(4000)}).then(async r=>{if(!r.ok||!(r.headers.get('content-type')||'').includes('text/html')||!(await r.text()).includes('<html'))process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", ".output/server/index.mjs"]
