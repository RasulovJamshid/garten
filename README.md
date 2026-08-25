# Kindergarten Management System — Backend

Stage 1 backend API. Built against the spec in [`kindergarten-docs/`](kindergarten-docs/) — read that
first, especially `docs/01-stage1-plan.md` (locked decisions) and `docs/06-ops-reference.md` (error
codes, env config, ops runbooks).

## Status: foundation (weeks 2–5 of the plan)

What's implemented and working end-to-end:

- **Database**: the verified schema (`kindergarten-docs/sql/*.sql`) applied as a Prisma baseline
  migration. 52 tables (see note below), introspected and reformatted to idiomatic
  camelCase/PascalCase with `@map`/`@@map` back to the original snake_case columns.
- **Tenant seam**: `TenantPrisma` (request-scoped, tenant filter forced via a Prisma client
  extension) is the only DB handle domain modules may inject. Enforced by an ESLint rule
  (`no-restricted-imports` override) banning raw `PrismaService` outside `auth/`, `prisma/`,
  `rbac/`, and `health/`.
- **Auth**: login / refresh / logout with rotating opaque refresh tokens (httpOnly cookie, hashed
  at rest), JWT access tokens (15 min), argon2id password hashing, account lockout after repeated
  failures.
- **Dynamic RBAC**: permission catalog in code (`src/rbac/permission-catalog.ts`), synced to the DB
  on boot; role → permission grants and user → role assignments live in the DB; a versioned
  in-memory cache (`tenant.permissionsVersion`) so edits take effect on the next request with no
  Redis and no re-login. `ScopeService` turns a granted scope (`all` / `branch` / `own_group` /
  `today` / `self`) into a Prisma `where` filter.
- **Audit log**: append-only service, `GET /audit` + `GET /audit/:id` (Owner/Director only).
- **Swagger/OpenAPI**: served at `/docs`, regenerated to `openapi.json` on every boot.
- **Seed data**: one tenant, one branch, the 7 system roles from the spec with sensible default
  grants, and an Owner login.

What's **not** built yet — this is scaffolding, not the product:

- No domain modules: children, guardians, groups, attendance, pickup, tariffs/billing, payments,
  debts, notifications, reports, expenses, imports, files. These are weeks 6–20 of the plan.
- No role/user management API (`POST /roles`, `POST /users/:id/roles`, etc.) or the RBAC safety
  rails from §5.5 (self-lockout, last-owner, privilege-escalation checks) — the *mechanics* those
  rails protect (guard, resolver, cache) are built, but the endpoints that would let someone trip
  them don't exist yet.
- No storage/files module (MinIO driver exists as reference in `kindergarten-docs/src/storage.ts`,
  not yet wired in).
- No Telegram integration, no pg-boss job queue.

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

## Running it

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
