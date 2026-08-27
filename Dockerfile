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
# Separate from `npm run build`: tsconfig.build.json deliberately excludes
# prisma/ from the main compile (nest build only emits the app), so
# prisma/seed.ts has never had a compiled JS counterpart to run in
# production — only `ts-node prisma/seed.ts` locally/in CI. ts-node itself
# turned out to be the wrong tool to ship into the runtime image: it's
# unmaintained against Node's newer module-detection behavior, and broke
# outright on this base image (its own `-e` eval path emits invalid ESM
# `export {}` into a non-module vm.Script context — a ts-node/Node bug,
# nothing to do with this app's code — and running prisma/seed.ts as a
# file failed silently the same way: exit 0, zero output, nothing
# written). This compiles prisma/seed.ts and its small, dependency-free
# src/ closure (src/rbac/permission-catalog.ts, src/common/auth-context.ts
# — nothing else) to plain JS instead, so production runs it with `node`,
# same as dist/main below, and never touches ts-node at all.
RUN npm run build:seed

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
# One-time bootstrap (tenant + owner login), run manually per
# DEPLOYMENT.md — `docker compose exec api npm run seed:prod` — never
# from CMD below. Plain compiled JS; see the build stage's comment for
# why this isn't `npm run seed` (ts-node) in production.
COPY --from=build /app/dist-seed ./dist-seed
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json ./package.json

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
