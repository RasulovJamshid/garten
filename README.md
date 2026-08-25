# Kindergarten Management System — Backend

Stage 1 backend API. Built against the spec in [`kindergarten-docs/`](kindergarten-docs/) — read that
first, especially `docs/01-stage1-plan.md` (locked decisions) and `docs/06-ops-reference.md` (error
codes, env config, ops runbooks).

## Status: backend feature-complete, pre-launch hardening in progress

Every domain module in the plan is implemented: auth, dynamic RBAC (including the §5.5 safety
rails — self-lockout, last-owner, privilege-escalation, sensitive-permission gating), children,
guardians, groups, attendance, pickup, billing, payments, debts, expenses, notifications,
telegram, reports, imports, files/storage (local + S3/MinIO drivers), pg-boss jobs, audit log,
dashboard, admin, users, roles. Lint, type-check, build, unit tests, and e2e tests are all green
(`npm test`, `npm run test:e2e`).

What's genuinely outstanding before this is a finished product, not just an API:

- **No frontend yet.** This repo is backend-only. The client UI is a separate repo, deployed to
  `alishaxkids.uz` on the same VPS while this API serves `api.alishaxkids.uz` — see
  [`DEPLOYMENT.md`](DEPLOYMENT.md) §8 for how the two are wired together, and
  `docs/frontend-functional-spec.md` / `docs/frontend-integration-guide.md` for what a frontend
  build against this API needs to cover (also packaged as `frontend-developer-handoff.zip` for
  handing to whoever builds it).
- **Finance-path test coverage is thinner than `01-stage1-plan.md` §7 calls "non-negotiable."**
  Billing math has unit tests (`src/billing/*.spec.ts`); still missing: a tenant-isolation test
  (two seeded tenants, assert zero cross-tenant leakage), concurrent billing-run and
  concurrent-payment-allocation race tests, self-lockout/last-owner/privilege-escalation e2e
  coverage, period-close rejection, discount stacking, and proration. Do not treat the finance
  path as fully proven until these exist.
- **DB privilege separation** (`06-ops-reference.md` §3: runtime user restricted to
  `SELECT/INSERT`-only on ledger tables, migrations run as a separate more-privileged role) isn't
  implemented yet — see `DEPLOYMENT.md` §7 for the exact gap.

## Production deployment

`DEPLOYMENT.md` has the full VPS-to-CI/CD walkthrough: `docker-compose.prod.yml` (api + postgres
+ minio + Caddy with automatic TLS + a nightly-backup sidecar) and the GitHub Actions `deploy`
job in `.github/workflows/ci.yml` that builds, publishes to GHCR, and SSH-deploys on every push
to `main`.

## Known issue inherited from the delivered schema

`user_role.branch_id` is documented as "NULL = all branches" and has a partial unique index for
that case (`uq_user_role_allbranch`), but `branch_id` is also part of the composite primary key
`(user_id, role_id, branch_id)` — Postgres silently forces every primary-key column `NOT NULL`, so
the NULL case can never actually occur. Harmless for Stage 1 (single branch, so "this branch" and
"all branches" are the same set) but will need a migration fix — drop `branch_id` from the PK,
rely on the two partial unique indexes instead — before a second branch exists. See the comment in
`prisma/seed.ts`.

Also: the schema's own README claims 49 tables / 14 triggers; the DDL as delivered actually
produces 52 tables (confirmed by direct introspection) and 28 rows in
`information_schema.triggers` (multi-event triggers count once per event in that view, so this is
likely just 14 actual `CREATE TRIGGER` statements counted differently — not investigated further).
Neither discrepancy blocked anything; noting it in case it matters later.

## Local development

```bash
docker compose up -d postgres minio       # Postgres on 5433, MinIO on 9000/9001
cp .env.example .env                      # then edit JWT_SECRET etc. for anything beyond local dev
npm install
npx prisma generate
npm run seed                              # creates the demo tenant + owner login
npm run start:dev
```

API listens on `http://localhost:3010/api/v1` (port/prefix from `.env`). Swagger UI at
`http://localhost:3010/docs`.

Seed prints the owner login — default `owner@demo.local` / `ChangeMe12345!` (override via
`SEED_OWNER_EMAIL` / `SEED_OWNER_PASSWORD` in `.env` before seeding).

### Ports

Local Postgres is mapped to **5433** (not 5432) and MinIO/API ports were chosen to avoid clashing
with other projects already running on this machine — check `docker-compose.yml` / `.env.example`
if you move to a machine without that conflict and want the conventional ports back.

## Conventions worth knowing before adding a module

- Inject `TenantPrisma`, never `PrismaService`. ESLint enforces this outside the exempted dirs.
- Money is `BigInt` tiyin everywhere; never a float. The `BigInt.prototype.toJSON` polyfill in
  `src/common/bigint-json.polyfill.ts` handles JSON serialization — don't add manual `.toString()`
  calls for it.
- Every domain error is an `AppException` from `src/common/exceptions/app.exception.ts` (the
  `AppErrors` factory), not a bare `HttpException` — that's what keeps `code` stable for clients to
  localize from.
- Guard a new endpoint with `@RequirePermissions('some:key')`; add the key to
  `PERMISSION_CATALOG` first (code owns what exists, data owns who has it).
- Scope a list/read query with `ScopeService.apply(ctx, 'some:key', where, { ...fieldNames })`
  rather than hand-rolling the branch/own_group filter.
- RBAC infrastructure (`src/rbac/`) is a deliberate exception to the "always request-scoped"
  instinct — see the comment in `permission-resolver.service.ts` for why guards specifically should
  stay singletons here.
