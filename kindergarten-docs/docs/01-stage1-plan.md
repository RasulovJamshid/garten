# Kindergarten Management System — Optimized Stage 1 Plan

**Revision of the original plan.** Single client, single deployment, tenant-ready schema.
Target: a system the kindergarten actually runs on daily, shipped in a defensible timeframe.

---

## 0. Decisions locked (do not revisit mid-build)

| Question | Decision | Why |
|---|---|---|
| Multi-tenancy | `tenant_id` on every table, app-layer enforcement. No RLS. | Seam now, machinery later. |
| Deployment | One Docker Compose stack, one Postgres, one tenant row. | Client #2 = second stack. |
| Frontend | React + Vite + TanStack Query + React Router | Internal tool behind auth. No SSR need. |
| Backend | NestJS + Prisma + Postgres 16 | Matches existing stack. Reuse. |
| Jobs | `pg-boss` (Postgres-backed). **No Redis.** | One less service. Redis only when proven needed. |
| Money | `BIGINT` tiyin. Never float, never Prisma `Decimal` in business logic. | Rounding bugs are unrecoverable trust damage. |
| Finance queries | Raw SQL / SQL views via `$queryRaw`. Prisma for CRUD only. | Prisma is weak at aggregates + locking. |
| Permissions | **Dynamic RBAC.** Permission catalog defined in code, role→permission mapping stored in DB, custom roles creatable per tenant. | Different kindergartens have different org structures; this is the multi-client seam. |
| Files | MinIO, self-hosted, in-country. | UZ personal-data localization law. |
| Offline attendance | PWA write queue + server-side unique constraint. **No conflict resolution.** | Hardware (UPS + 4G failover) solves this cheaper. |

---

## 1. Scope: cut, keep, defer

### CUT from Stage 1 (was in original plan)

| Cut | Moved to | Reason |
|---|---|---|
| Meters, meter readings, consumption anomaly detection | Stage 4 | A second product. ~20% of spec for a gas bill. |
| Utility approval workflow (draft→review→approve→pay) | Stage 4 | Director will just tell the accountant verbally. |
| Utility dashboard, per-child/per-branch utility analytics | Stage 4 | No decisions ride on it yet. |
| Two-factor auth | Stage 2 | Add when a real breach vector exists. |
| Offline sync with conflict resolution | Never (solve with hardware) | Distributed-systems problem for a 3-second outage. |
| `ExportJob` / async report queue | When reports get slow | Sync generation is fine at 5k records. |
| Credit / Refund as separate entities | Stage 2 | Model as reversing ledger entries instead. |
| Disputed invoice status | Stage 4 | — |
| Excel import of historical payments | Replaced by opening-balance import only | Importing bad history poisons the ledger. |

### REPLACES the utilities module in Stage 1

**`RecurringExpense`** — one flat table. Type (electricity/gas/water/rent/internet/security/other), provider name, billing month, amount, due date, status (`unpaid` / `paid`), attachment, paid date, notes. Plus a list screen with "unpaid + overdue" filter and a monthly total.

That is 1–2 days of work and covers 95% of the real need. The full utilities module was 3+ weeks.

### KEEP (unchanged — these were right)

Transaction-based billing · append-only payments · audit log · pickup authorization · medical warnings · attendance corrections with reason · pilot strategy · scope-control rules (§38 of original) · execution order (§45 of original).

---

## 2. Tenant seam — the part that must be right on day one

### 2.1 Hierarchy

```
tenant  (the kindergarten business — 1 row for now)
  └── branch  (physical site — 1 row for now)
        └── everything else
```

Original plan conflated these. Keep them separate. Tenant ≠ branch.

### 2.2 Base columns on every domain table

```prisma
// every table gets these — no exceptions
tenantId    String   @db.Uuid          // FK -> tenant.id
branchId    String?  @db.Uuid          // null = tenant-wide (roles, settings, tariffs)
createdAt   DateTime @default(now()) @db.Timestamptz
updatedAt   DateTime @updatedAt @db.Timestamptz
createdById String?  @db.Uuid
updatedById String?  @db.Uuid
deletedAt   DateTime? @db.Timestamptz  // soft delete — NEVER on financial tables
```

**Financial tables (`charge`, `payment`, `payment_allocation`, `ledger_entry`) have no `deletedAt`.** They are append-only. Corrections are new reversing rows.

### 2.3 The critical unique constraint

```prisma
model User {
  id       String @id @default(uuid()) @db.Uuid
  tenantId String @db.Uuid
  email    String
  phone    String

  @@unique([tenantId, email])   // NOT @unique on email alone
  @@unique([tenantId, phone])
}
```

This single line is what keeps shared-infrastructure multi-tenancy possible later. Get it wrong and you are locked into per-client deploys forever.

### 2.4 Tenant scoping — one place, enforced automatically

Build this in Week 3 (auth week), before any domain module exists. Every module written after it is tenant-safe by default.

```ts
// prisma/tenant-extension.ts
import { Prisma } from '@prisma/client';

// tables that are genuinely global (no tenantId column)
const GLOBAL_MODELS = new Set(['Tenant', 'Migration']);

export function forTenant(client: PrismaClient, tenantId: string) {
  return client.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (GLOBAL_MODELS.has(model!)) return query(args);

          // reads + updates + deletes: force the filter
          if (['findFirst', 'findMany', 'findUnique', 'count', 'aggregate',
               'updateMany', 'deleteMany', 'update', 'delete'].includes(operation)) {
            args.where = { ...args.where, tenantId };
          }

          // writes: force the value
          if (operation === 'create') {
            args.data = { ...args.data, tenantId };
          }
          if (operation === 'createMany') {
            args.data = (args.data as any[]).map(d => ({ ...d, tenantId }));
          }
          if (operation === 'upsert') {
            args.where  = { ...args.where, tenantId };
            args.create = { ...args.create, tenantId };
          }

          return query(args);
        },
      },
    },
  });
}
```

Wire it to a request-scoped NestJS provider:

```ts
@Injectable({ scope: Scope.REQUEST })
export class TenantPrisma {
  readonly db: ReturnType<typeof forTenant>;
  constructor(@Inject(REQUEST) req: RequestWithUser, base: PrismaService) {
    this.db = forTenant(base, req.user.tenantId);
  }
}
```

**Rule with no exceptions:** modules inject `TenantPrisma`, never `PrismaService`. Add an ESLint rule banning direct `PrismaService` imports outside `auth/` and `admin/`.

**Raw SQL is the hole in this.** Every `$queryRaw` must carry `WHERE tenant_id = ${tenantId}`. Write finance reports as SQL views that take tenant as a parameter, and code-review every raw query for it.

### 2.5 What you are explicitly NOT building now

No tenant onboarding UI · no subdomain routing · no per-tenant billing · no RLS policies · no tenant switcher. That is the machinery. You want the seam.

---

## 3. Money model — spec this in Week 2, before building anything around it

This is where the project fails if it fails. Everything below is non-negotiable.

### 3.1 Representation

- Store **`BIGINT` tiyin** (1 som = 100 tiyin). `1_500_000` som → `150_000_000`.
- Prisma type: `BigInt`. Serialize to string at the API boundary (JSON has no int64).
- Format for display only, at the last possible moment.
- **Zero floating-point arithmetic anywhere in the finance path.**

### 3.2 Core tables

```
accounting_period
  id, tenant_id, year, month, status(open|closed), closed_at, closed_by
  UNIQUE (tenant_id, year, month)

charge                          -- immutable
  id, tenant_id, branch_id, child_id, period_id,
  kind(tuition|meal|transport|extra_class|registration|manual),
  amount_tiyin BIGINT,          -- always positive
  sign SMALLINT,                -- +1 charge, -1 reversal
  source_charge_id,             -- set when sign = -1
  tariff_snapshot JSONB,        -- what the tariff WAS at generation time
  billing_run_id, description, issued_at
  UNIQUE (tenant_id, child_id, period_id, kind) WHERE sign = 1

payment                         -- immutable
  id, tenant_id, branch_id, child_id, payer_guardian_id,
  amount_tiyin BIGINT, sign SMALLINT,
  method(cash|bank|card|online|other),
  source_payment_id,            -- set when sign = -1 (cancellation)
  receipt_no, bank_ref, paid_at, recorded_by, attachment_id, note
  UNIQUE (tenant_id, receipt_no)

payment_allocation              -- immutable
  id, tenant_id, payment_id, charge_id, amount_tiyin BIGINT
  -- SUM per payment <= payment.amount; remainder = advance credit

discount
  id, tenant_id, child_id, kind(percent|fixed), value,
  valid_from, valid_to, reason, approved_by
```

**No `balance` column anywhere.** Balance is always derived:

```sql
CREATE VIEW child_balance AS
SELECT
  c.tenant_id, c.id AS child_id,
  COALESCE(ch.charged, 0)   AS charged_tiyin,
  COALESCE(pm.paid, 0)      AS paid_tiyin,
  COALESCE(ch.charged, 0) - COALESCE(pm.paid, 0) AS debt_tiyin
FROM child c
LEFT JOIN (
  SELECT child_id, tenant_id, SUM(amount_tiyin * sign) AS charged
  FROM charge GROUP BY 1, 2
) ch ON ch.child_id = c.id AND ch.tenant_id = c.tenant_id
LEFT JOIN (
  SELECT child_id, tenant_id, SUM(amount_tiyin * sign) AS paid
  FROM payment GROUP BY 1, 2
) pm ON pm.child_id = c.id AND pm.tenant_id = c.tenant_id;
```

If this view gets slow (it won't at 5k children), add a materialized view refreshed on write. Never a mutable column.

### 3.3 Payment allocation algorithm

Default: **FIFO, oldest unpaid charge first.** Accountant may override per-charge in the UI.

```ts
async function allocatePayment(db, paymentId: string) {
  return db.$transaction(async (tx) => {
    const payment = await tx.$queryRaw`
      SELECT * FROM payment WHERE id = ${paymentId} FOR UPDATE`;

    // lock the child's open charges to prevent concurrent double-allocation
    const openCharges = await tx.$queryRaw`
      SELECT c.id, c.amount_tiyin - COALESCE(a.allocated, 0) AS remaining
      FROM charge c
      LEFT JOIN (
        SELECT charge_id, SUM(amount_tiyin) allocated
        FROM payment_allocation GROUP BY 1
      ) a ON a.charge_id = c.id
      WHERE c.child_id = ${payment.child_id}
        AND c.tenant_id = ${payment.tenant_id}
        AND c.sign = 1
        AND c.amount_tiyin - COALESCE(a.allocated, 0) > 0
      ORDER BY c.issued_at ASC
      FOR UPDATE OF c`;

    let remaining = payment.amount_tiyin;
    for (const charge of openCharges) {
      if (remaining <= 0n) break;
      const amount = remaining < charge.remaining ? remaining : charge.remaining;
      await tx.paymentAllocation.create({
        data: { paymentId, chargeId: charge.id, amountTiyin: amount },
      });
      remaining -= amount;
    }
    // remaining > 0 stays unallocated = advance credit, auto-applied next billing run
  }, { isolationLevel: 'Serializable' });
}
```

`FOR UPDATE` + `Serializable` is the whole point. Two accountants registering payments for the same child simultaneously must not both allocate to the same charge.

### 3.4 Corrections — never UPDATE, never DELETE

| Action | Implementation |
|---|---|
| Cancel a payment | Insert `payment` with `sign = -1`, `source_payment_id`, reason, approver. Original stays visible. |
| Cancel a charge | Insert `charge` with `sign = -1`, `source_charge_id`. |
| Fix a wrong amount | Reverse + re-issue. Two rows, not one edit. |
| Apply a discount retroactively | Negative `charge` of kind `manual`, with reason. |

### 3.5 Period locking

Once the accountant closes a month, no charge or payment may be inserted with `period_id` pointing at a closed period. Enforce in a DB trigger, not just app code:

```sql
CREATE FUNCTION reject_closed_period() RETURNS trigger AS $$
BEGIN
  IF (SELECT status FROM accounting_period WHERE id = NEW.period_id) = 'closed' THEN
    RAISE EXCEPTION 'accounting period is closed';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
```

Reopening a period is an Owner-only action, audit-logged.

### 3.6 Idempotent billing runs

```
billing_run
  id, tenant_id, period_id, status(preview|committed|failed),
  idempotency_key, child_count, total_tiyin, created_by, committed_at
  UNIQUE (tenant_id, period_id) WHERE status = 'committed'
```

Flow: generate → `preview` (nothing written to `charge`) → accountant reviews totals → commit inside one transaction. The partial unique index makes a second commit for the same month impossible at the database level, not just the UI.

The `UNIQUE (tenant_id, child_id, period_id, kind) WHERE sign = 1` index on `charge` is the second line of defense.

### 3.7 Timezone

Every timestamp is `TIMESTAMPTZ`. Server runs UTC. Uzbekistan is UTC+5, no DST — but "which day is this attendance record" must be computed in `Asia/Tashkent`, not UTC, or 03:00 arrivals land on the wrong date. Store `attendance_date` as a separate `DATE` column computed in local time.

---

## 4. Attendance model (simplified but correct)

```
attendance_day
  id, tenant_id, branch_id, child_id, group_id,
  attendance_date DATE,        -- computed in Asia/Tashkent
  status(present|absent|sick|vacation|excused|late|early_departure),
  check_in_at, check_in_by, check_in_note,
  check_out_at, check_out_by, check_out_note,
  pickup_person_id, pickup_permission_id
  UNIQUE (tenant_id, child_id, attendance_date)   -- kills duplicate check-ins dead

attendance_correction
  id, tenant_id, attendance_day_id, field, old_value, new_value,
  reason TEXT NOT NULL, corrected_by, corrected_at
```

One row per child per day, not separate check-in/check-out tables. The unique constraint is what makes the PWA offline queue safe — replay a queued check-in twice and the second one is rejected by Postgres. That is the entire offline strategy.

"Currently inside" = `check_in_at IS NOT NULL AND check_out_at IS NULL AND attendance_date = today`. Index it.

---

## 5. Dynamic RBAC — fully manageable roles and permissions

**The critical split:** the *permission catalog* is defined in code; the *role→permission mapping* lives in the database.

This is not a compromise — it is the only correct design. A permission string only means something if some endpoint actually checks it. Letting users invent arbitrary permission names produces grants that silently do nothing, which is worse than no RBAC at all. So:

- **Code owns:** what permissions exist, what each protects, which scopes it supports.
- **Data owns:** which roles exist, what each role is granted, who has which role.

Result: an operator can create "Senior Teacher", "Branch Manager", "Part-time Accountant" — any role, any combination, any scope — without a deploy. They cannot invent a permission the code doesn't enforce.

### 5.1 Permission catalog (code, versioned, seeded into DB on boot)

```ts
// permissions/catalog.ts — the single source of truth
export const PERMISSION_CATALOG = [
  // group          key                        scopes allowed
  { group: 'children',   key: 'child:read',        scopes: ['all','branch','own_group'] },
  { group: 'children',   key: 'child:create',      scopes: ['all','branch'] },
  { group: 'children',   key: 'child:update',      scopes: ['all','branch'] },
  { group: 'children',   key: 'child:delete',      scopes: ['all'] },
  { group: 'children',   key: 'child:status',      scopes: ['all','branch'] },

  { group: 'medical',    key: 'medical:read',      scopes: ['all','branch','own_group'] },
  { group: 'medical',    key: 'medical:alerts',    scopes: ['all','branch','own_group'] },
  { group: 'medical',    key: 'medical:write',     scopes: ['all','branch'] },

  { group: 'attendance', key: 'attendance:read',   scopes: ['all','branch','own_group','today'] },
  { group: 'attendance', key: 'attendance:checkin',  scopes: ['all','branch','own_group'] },
  { group: 'attendance', key: 'attendance:checkout', scopes: ['all','branch','own_group'] },
  { group: 'attendance', key: 'attendance:correct', scopes: ['all','branch'] },

  { group: 'pickup',     key: 'pickup:read',       scopes: ['all','branch','own_group'] },
  { group: 'pickup',     key: 'pickup:manage',     scopes: ['all','branch'] },
  { group: 'pickup',     key: 'pickup:temporary',  scopes: ['all','branch'] },

  { group: 'finance',    key: 'tariff:manage',     scopes: ['all'] },
  { group: 'finance',    key: 'charge:read',       scopes: ['all','branch'] },
  { group: 'finance',    key: 'charge:generate',   scopes: ['all'] },
  { group: 'finance',    key: 'charge:reverse',    scopes: ['all'],  sensitive: true },
  { group: 'finance',    key: 'payment:read',      scopes: ['all','branch'] },
  { group: 'finance',    key: 'payment:create',    scopes: ['all','branch'] },
  { group: 'finance',    key: 'payment:cancel',    scopes: ['all'],  sensitive: true },
  { group: 'finance',    key: 'discount:manage',   scopes: ['all'],  sensitive: true },
  { group: 'finance',    key: 'period:close',      scopes: ['all'],  sensitive: true },
  { group: 'finance',    key: 'period:reopen',     scopes: ['all'],  sensitive: true },
  { group: 'finance',    key: 'debt:read',         scopes: ['all','branch','own_group'] },

  { group: 'admin',      key: 'role:manage',       scopes: ['all'],  sensitive: true },
  { group: 'admin',      key: 'user:manage',       scopes: ['all'],  sensitive: true },
  { group: 'admin',      key: 'audit:read',        scopes: ['all'] },
  { group: 'admin',      key: 'settings:manage',   scopes: ['all'] },
  // ... groups, guardians, reports, notifications, expenses, imports, files
] as const;

export type PermissionKey = typeof PERMISSION_CATALOG[number]['key'];
```

On application boot, upsert the catalog into a `permission` table. New permissions added in a release appear automatically; **they are granted to nobody by default** (fail-closed). Removed permissions are marked `deprecated`, never deleted, so audit history stays readable.

### 5.2 Schema

```
permission                    -- synced from code catalog, read-only to users
  key PK, group, description_uz, description_ru,
  allowed_scopes TEXT[], sensitive BOOL, deprecated BOOL

role
  id, tenant_id, code, name_uz, name_ru, description,
  is_system BOOL,               -- seeded template; grants editable, role undeletable
  is_protected BOOL,            -- owner role: cannot be edited or deleted at all
  created_by, created_at
  UNIQUE (tenant_id, code)

role_permission               -- the editable mapping
  role_id, permission_key, scope,
  PRIMARY KEY (role_id, permission_key)

user_role                     -- a user may hold multiple roles
  user_id, role_id, branch_id NULL,   -- NULL = all branches user has access to
  granted_by, granted_at
  PRIMARY KEY (user_id, role_id, branch_id)

user_permission_override      -- optional per-user exception
  user_id, permission_key, scope, effect('grant'|'deny'),
  reason TEXT NOT NULL, valid_until, granted_by
```

**Resolution order:** `deny` override → `grant` override → union of all role grants. Explicit deny always wins. When a user holds two roles granting the same permission at different scopes, the **broader** scope wins (`all` > `branch` > `own_group` > `today`).

### 5.3 Scopes are query filters, not UI hints

A scope is meaningless unless it narrows the actual database query.

```ts
@Injectable()
export class ScopeService {
  applyChildScope(ctx: AuthContext, where: Prisma.ChildWhereInput) {
    const scope = ctx.scopeFor('child:read');
    switch (scope) {
      case 'all':       return where;
      case 'branch':    return { ...where, branchId: { in: ctx.branchIds } };
      case 'own_group': return { ...where, groupId: { in: ctx.ownGroupIds } };
      default:          throw new ForbiddenException('FORBIDDEN');
    }
  }
}
```

Every list endpoint runs its `where` through the scope service. A teacher who guesses a child's UUID and requests it directly gets `404`, not the record.

### 5.4 Guard + cache invalidation (no Redis)

Permissions change at runtime, so a JWT carrying a permission list goes stale the moment an operator edits a role. Solution: version the permission set per tenant.

```ts
// tenant.permissions_version — a counter, incremented on ANY role/grant/assignment change

@Injectable()
export class PermissionGuard implements CanActivate {
  private cache = new LRUCache<string, ResolvedPermissions>({ max: 5000, ttl: 60_000 });

  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const required = this.reflector.get<PermissionKey[]>(PERMISSIONS_KEY, ctx.getHandler());
    if (!required?.length) return true;

    const currentVersion = await this.tenants.permissionsVersion(req.user.tid); // cached 10s
    const cacheKey = `${req.user.sub}:${currentVersion}`;

    let perms = this.cache.get(cacheKey);
    if (!perms) {
      perms = await this.resolveFromDb(req.user.sub);   // roles ∪ overrides
      this.cache.set(cacheKey, perms);
    }

    req.authContext = new AuthContext(req.user, perms);
    return required.every(p => perms.has(p));
  }
}
```

Bumping `permissions_version` invalidates every cached entry for that tenant instantly — no Redis pub/sub, no stale-permission window, no forced re-login. Edits take effect on the user's very next request.

Usage:
```ts
@Post('payments/:id/cancel')
@RequirePermissions('payment:cancel')
async cancel(...) {}
```

### 5.5 Safety rails (these prevent the classic self-lockout disaster)

1. **The Owner role is `is_protected`** — cannot be edited, cannot be deleted, cannot have grants removed. It always holds `*`.
2. **At least one active user must hold Owner.** Removing the last one returns `409 LAST_OWNER`.
3. **You cannot remove `role:manage` or `user:manage` from yourself.** `403 SELF_LOCKOUT`.
4. **Privilege escalation block:** a user cannot grant a permission they do not themselves hold. Prevents an admin with `role:manage` from minting themselves a finance role.
5. **`sensitive: true` permissions** (payment cancel, period reopen, discounts, role management) require the granting user to hold `role:manage:sensitive` — a separate, Owner-only permission.
6. **Every role and grant change is audit-logged** with before/after permission diffs. This is non-negotiable: RBAC changes are the highest-value audit target in the system.
7. **System roles are undeletable** if any user still holds them; reassign first.

### 5.6 Seeded system roles (starting templates, fully editable)

`owner` (protected) · `director` · `administrator` · `accountant` · `teacher` · `reception` · `nurse`

These ship as data, seeded per tenant on creation. An operator can clone any of them, rename, adjust grants, and assign. That is the "fully manageable" requirement satisfied — with the guardrail that new *permissions* still come from code, where they're actually enforced.

Defaults worth keeping: teachers get `medical:alerts` at `own_group` scope but never `medical:read` full records, and never any `finance:*`. Reception gets `attendance:*` at `today` scope only.

### 5.7 Honest cost

This adds roughly **1.5 weeks** over a hardcoded map — schema, guard, resolution logic, safety rails, and the permission-matrix endpoints — plus permanent test surface. It is worth it here because the whole business case is selling to a second kindergarten whose org chart won't match the first one's.

---

## 6. Realistic schedule

The original 18-week solo estimate was not achievable. This is the reduced scope, honestly estimated.

### Solo full-stack — 26 weeks

| Weeks | Block | Output |
|---|---|---|
| 1 | Discovery | Real forms collected, billing rules written down, tariff edge cases confirmed with the accountant |
| **2** | **Money-model spike** | Schema for charge/payment/allocation/period. Allocation algorithm unit-tested against 20 real scenarios. **Before any UI exists.** |
| 3 | Foundation | Repo, Docker Compose, Prisma, migrations, **tenant extension**, auth, sessions, i18n scaffolding |
| 4–5 | **Dynamic RBAC** | Permission catalog + boot sync, role/grant schema, resolution engine, versioned cache guard, scope service, safety rails, user CRUD, settings, holidays, audit-log infrastructure |
| 5–6 | Children & guardians | Profiles, photos, guardian M:N, documents, search, Excel import of children |
| 7 | Groups | Groups, teacher assignment, transfers with history, capacity warnings |
| 8–9 | Attendance | Daily attendance, check-in, statuses, currently-inside, group view, PWA queue |
| 10 | Pickup | Authorized persons, temporary permissions, check-out, pickup history, corrections |
| 11 | Tariffs | Tariff types, child assignment with effective dates, discounts, extras, snapshots |
| 12–13 | Billing | Preview → commit, idempotency, charge items, manual charges, reversals, period close |
| 14–15 | Payments & debt | Registration, allocation, advance credit, cancellation, receipts, debt + ageing views |
| 16 | Expenses | The flat `RecurringExpense` table + screens (replaces the whole utilities module) |
| 17 | Notifications | Telegram bot, templates, delivery log, **idempotency keys on sends** |
| 18 | Dashboards | Director / accountant / reception |
| 19–20 | Reports & export | Attendance, child, finance reports. Excel + PDF. Opening-balance import. |
| 21 | Security hardening | Permission audit, file access, rate limits, backups configured + **restore tested** |
| 22 | Buffer | Reserved for overrun. It will be used. |
| 23–24 | UAT | Real data loaded, each role tested by its actual user, issues fixed |
| 25–26 | Pilot & launch | Training, deploy, 2 groups, monitor, then all groups, acceptance sign-off |

### Two developers (1 FE + 1 BE) — 16 weeks

Same blocks, parallelized after week 4. Weeks 2 and 3 are not parallelizable — the money model and tenant seam must be settled by one person before anything is built on them.

### Schedule rules

- **Week 2 is not optional and cannot be moved.** Every later week depends on the money model being right.
- Week 22 buffer is real. Do not promise it away.
- If schedule pressure hits, cut in this order: PDF export → dashboards → Excel import → notifications. **Never cut** billing tests, audit log, or backup restore testing.

---

## 7. Testing — the parts that actually matter

Everything else is optional; these are not.

```
Unit (must be exhaustive):
  - allocation: exact payment / partial / overpayment / multiple open charges /
    payment after reversal / advance carried forward
  - debt: charged - paid, with reversals present
  - tariff proration on mid-month enrollment and withdrawal
  - discount stacking (percent then fixed vs fixed then percent — decide and test)
  - period-close rejection

Integration:
  - two concurrent billing runs for the same month → exactly one commits
  - two concurrent payments for the same child → allocations never overlap
  - double check-in → second rejected by unique constraint
  - tenant isolation: seed 2 tenants, assert every endpoint leaks nothing
  - RBAC matrix: for every endpoint x every seeded role, assert allow/deny
  - scope enforcement: teacher requests a child UUID outside own_group -> 404
  - permission edit takes effect on the NEXT request (version bump invalidates cache)
  - self-lockout, last-owner, and privilege-escalation attempts all rejected

E2E (the 10 workflows from original §37 — keep them)
```

The **tenant isolation test** is the one that protects the future business. Write it in Week 3 with a second seeded tenant, and keep that second tenant in the test fixtures forever even though production has one.

---

## 8. Production setup

```
docker-compose:
  api        (NestJS)
  web        (nginx serving Vite build)
  postgres   (16, daily pg_dump + weekly full, encrypted, off-server)
  minio      (in-country object storage)
  caddy      (reverse proxy + automatic TLS)
```

No Redis. No Kubernetes. No managed services until the client count justifies them.

- Backups: `pg_dump` nightly → encrypted → off-server. **Restore test monthly, into staging, verified by an actual query.** An untested backup is not a backup.
- Monitoring: uptime ping + Sentry + disk-space alert. That is sufficient at this scale.
- Environments: dev / staging / prod. Never test in prod.

---

## 9. Acceptance criteria (trimmed to what proves the system works)

1. Create users in every role; each sees only what it should
2. Register child + guardians + documents + medical warning
3. Assign to group; transfer to another group; history preserved
4. Add pickup person; create a one-day temporary permission
5. Check in, check out with pickup person recorded, parent notified
6. "Currently inside" list is correct at any moment
7. Create tariffs; assign with effective dates; apply a discount
8. Generate monthly charges → preview → commit; **second commit attempt rejected**
9. Register partial payment; debt reflects it correctly
10. Register advance payment; it carries to next month automatically
11. Cancel a payment with reason; original visible in audit; debt corrects
12. Close the month; attempt to insert a charge into it → rejected
13. Debt report with ageing buckets matches manual calculation on 10 sample children
14. Print a receipt
15. Record and pay a recurring expense
16. Send an announcement to a group; delivery log shows result
17. Export attendance and debt reports to Excel
18. Review audit history for a payment cancellation
19. **Restore last night's backup into staging and query it successfully**

Note #8, #12, and #19 — those are the ones that separate a real system from a demo.

---

## 10. Non-goals for Stage 1 (say this to the client in writing)

Mobile apps · QR/NFC · online payments · parent portal · curriculum · staff HR/payroll · kitchen/menu/inventory · GPS · accounting-system integration · OCR · AI features · utility-provider API integration · meter readings · multi-branch dashboards.

Every one of these is a **new feature** under the original §38 scope-control rules: description → estimate → price → date → written approval. Not warranty work.

---

## 11. The three things that will kill this project if ignored

1. **Building UI before the money model is settled.** Week 2 exists for this reason. A billing bug found in week 20 means re-migrating live financial data.
2. **A raw SQL query without `tenant_id`.** One leak between clients ends the multi-client business case permanently. ESLint rule + code review on every `$queryRaw`.
3. **Promising 18 weeks.** The original estimate, with the original scope, solo, was roughly a 9–12 month project. Reduced scope at 26 weeks is honest. Quote 26, deliver at 24, look excellent.
