# Multi-stage build. Same Debian-based node image in every stage
# (node:22-slim, not alpine) so the Prisma query engine binary generated
# in `build` is guaranteed to match the runtime's libc — Prisma's default
# binaryTargets don't include musl, and schema.prisma isn't configured for
# it, so an alpine runtime would silently fail to load the engine. Node 22
# specifically because pg-boss requires it (>=22.12.0).

FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts: the postinstall (`prisma generate`) needs
# prisma/schema.prisma, which isn't copied into this deps-only stage —
# `build` below copies the full source and runs it explicitly instead.
RUN npm ci --ignore-scripts

FROM node:22-slim AS build
WORKDIR /app
# Without this, Prisma can't detect libssl on debian-slim and silently
# guesses "openssl-1.1.x" — wrong on this base image (ships OpenSSL 3),
# so the query engine binary it fetches wouldn't load at all.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system app && useradd --system --gid app app

# The whole node_modules (including devDependencies) is carried over
# rather than a fresh `npm ci --omit=dev` — the `prisma` CLI is a
# devDependency, but `migrate deploy` below needs it at runtime, and
# picking apart exactly which @prisma/* subpaths the CLI needs is fragile
# across Prisma versions. Trading some image size for that reliability.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json ./package.json

# `npm run seed` runs prisma/seed.ts through ts-node (tsconfig.build.json
# deliberately excludes `prisma/` from `nest build`, so there is no
# compiled dist/seed.js to run instead) and seed.ts imports
# src/rbac/permission-catalog.ts directly — so ts-node needs the real TS
# source tree at runtime, not just dist/. Omitting this makes `docker
# compose exec api npm run seed` fail with "Cannot find module
# '../src/rbac/permission-catalog'" the first time anyone actually runs
# it against this image. ts-node/typescript themselves are devDependencies,
# already covered by the full node_modules copy above.
COPY --from=build /app/src ./src

# Only the local-storage write target needs the app user's ownership —
# recursively chowning all of node_modules (976 packages) cost 2.5+
# minutes for zero benefit, since the app process only ever reads there.
RUN mkdir -p /app/data/files && chown -R app:app /app/data
USER app

EXPOSE 3000
# Applies any migrations not yet in this database before the app starts —
# safe to run on every container start (prisma migrate deploy is a no-op
# when there's nothing pending), and is how this image stays correct
# across redeploys without a separate manual migration step.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]
