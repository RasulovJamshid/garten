# Kindergarten Management System — Backend

Stage 1 NestJS API for child records, attendance, authorized pickup, billing, payments, expenses,
staff permissions, communication and reports. The original requirements are in
[kindergarten-docs/](kindergarten-docs/).

## Current status

The October audit defects have been corrected locally. See
[the correction and validation record](docs/project-fixes-2026-10-03.md) for the changes,
regression coverage, deployment migration and remaining verification limits. The
[original audit](docs/project-audit-2026-10-03.md) is historical evidence.

The maintained tests cover tenant boundaries, permission delegation, session rotation,
billing history and policy, payment/billing concurrency, ledger audit rollback, attendance,
pickup, exports and notification retries. Use an isolated database for all integration tests:
they create synthetic records and some fixtures remain because ledger rows are append-only.
A passing source build does not establish production deployment or external Telegram delivery.

The web application lives in [AzizBokhidjonov/alishax](https://github.com/AzizBokhidjonov/alishax).
This repository provides its SSR build recipe, deployment watcher and versioned contract patches.
The inspected local web checkout is from 9 September 2026; the current remote and deployed
application were not inspected. The Flutter application is an initial staff companion;
its documented exclusions are in [mobile/README.md](mobile/README.md).

The nullable branch assignment key in user_role was corrected by the July migration. Apply
all migrations before seeding. Production database privilege separation remains an operational
hardening task documented in [DEPLOYMENT.md](DEPLOYMENT.md#7-known-deviation-from-the-ops-doc).

## Frontend handoff and deployment

Start with the [Frontend Developer Handbook](docs/FRONTEND-DEVELOPER-HANDBOOK.md) and
[current correction record](docs/project-fixes-2026-10-03.md). Generate client contracts from
[openapi.json](openapi.json). Dated September reviews are historical and may describe behavior
that subsequent fixes changed.

[DEPLOYMENT.md](DEPLOYMENT.md) covers PostgreSQL, storage, Caddy, backend CI deployment and the
frontend watcher. The watcher applies patches before building its archived upstream checkout
and fails before replacement if those patches no longer match.

## Local development

```bash
docker compose up -d postgres minio
cp .env.example .env
npm install
npm run prisma:migrate:deploy
npm run seed
npm run start:dev
npm run seed:demo
```

Set JWT_SECRET and other configuration in .env. PostgreSQL uses port 5433 and the API normally
uses http://localhost:3010/api/v1; Swagger is at http://localhost:3010/docs.
The optional demo seed drives the running HTTP API and refuses NODE_ENV=production.
Default development owner: owner@demo.local / ChangeMe12345!; override the seed settings
before creating a real installation.

## Verification

```bash
npx eslint "{src,test}/**/*.ts"
npx tsc --noEmit -p tsconfig.json
npm test -- --runInBand
npm run build
npm run openapi
python -m unittest discover -s test/deployment -v
```

For integration checks, configure DATABASE_URL to an isolated local PostgreSQL database,
set NODE_ENV=test, apply migrations and run the seed first. Telegram must remain disabled.
Then run npm run test:e2e serially. The real-worker check runs after a build:

```bash
TEST_DATABASE_ISOLATED=true NODE_ENV=test TELEGRAM_ENABLED=false node test/runtime/worker-smoke.cjs
```

That script checks real pg-boss processing, internal notifications, XLSX/PDF exports, local
storage, authenticated downloads and expiry. TEST_DATABASE_ISOLATED is an explicit declaration
that the database contains test data; the script also restricts connections to localhost.
Windows can run the portable patch tests; deployment shell tests require POSIX and run in CI.

## Development conventions

- Inject TenantPrisma in domain services. ESLint restricts raw PrismaService access to infrastructure.
- Money uses BigInt tiyin and serializes to decimal strings through the shared JSON polyfill.
- Return AppErrors domain errors so clients can rely on stable error codes.
- Add permissions to PERMISSION_CATALOG and guard endpoints with @RequirePermissions.
- Combine TenantPrisma.childWhere()/branchWhere() with request filters using AND. Use each
  operation's own permission when resolving its target.
- Keep transactional financial writes and audit events in the same transaction.
- Root TypeScript covers backend, tests, scripts and seeds. data/ and mobile/ have separate
  ownership; historical output and local databases must stay outside backend compilation and
  image contexts.
