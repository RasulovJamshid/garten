# Kindergarten Management System — Documentation Set

Backend-only, Stage 1. Single client at launch, tenant-ready for resale.
All SQL in this set has been executed against PostgreSQL 16 and behaviourally tested.

---

## 1. Document map — read in this order

| # | Document | What it is | Read it when |
|---|---|---|---|
| 0 | **README** (this file) | Locked decisions, timeline, build order | First |
| 1 | `kindergarten-stage1-optimized.md` | Scope, architecture, tenant seam, money model, dynamic RBAC, testing, deployment, acceptance criteria | Before writing any code |
| 2 | `kindergarten-accountant-questionnaire.md` | Client-facing form that unblocks billing | **Send this today** |
| 3 | `kindergarten-billing-rules.md` | Configurable billing engine: discount order, per-day pricing, versioning, calculation code | Week 2 |
| 4 | `kindergarten-schema.sql` | Complete DDL — 49 tables, 5 views, 112 indexes, 14 triggers | Week 3 |
| 5 | `kindergarten-config-layer.sql` | Trimmed configurability additions | Week 3 (apply after #4) |
| 5b | `kindergarten-storage.ts` | Pluggable storage driver — local or S3/MinIO | Week 18 (files) |
| 6 | `kindergarten-api-spec.md` | Full REST surface, conventions, RBAC management API, OpenAPI generation | Weeks 3–17 |
| 7 | `kindergarten-telegram-spec.md` | Binding flow, sending pipeline, retry semantics | Week 15 |
| 8 | `kindergarten-ops-reference.md` | Audit spec, error registry, env config, NFRs, migration and ops runbooks | Weeks 17–20 |

---

## 2. Locked decisions

Changing any of these mid-build is expensive. They are settled.

| Area | Decision |
|---|---|
| Deliverable | Backend API + OpenAPI docs. No frontend. |
| Multi-tenancy | `tenant_id` on every table, enforced in a Prisma extension. No RLS yet. One deployment, one tenant row. Client #2 = second Docker stack. |
| Hierarchy | tenant → branch → everything. Tenant ≠ branch. |
| Stack | NestJS + Prisma + PostgreSQL 16 + pg-boss + MinIO + Caddy. **No Redis. No Next.js. No Kubernetes.** |
| Money | `BIGINT` tiyin, serialized as strings. No floats anywhere in the finance path. |
| Ledger | Append-only. Charges and payments immutable, enforced by DB trigger. Corrections are reversing rows (`sign = -1`). Balance always derived from a view, never stored. |
| Billing timing | **Arrears** — pay per attended day means March is invoiced on 1 April. |
| Discount order | **Fixed first, then percent.** Configurable and versioned. |
| Billing rules | Versioned data, effective-dated. Every charge stores which version produced it plus a full calculation trace. |
| Permissions | Dynamic RBAC. Permission catalog in code; roles, grants and assignments in the database. Custom roles creatable without a deploy. |
| Utilities | Cut to a flat `expense` table. Meters, anomaly detection and approval workflow deferred to Stage 4. |
| Offline attendance | Client queues and retries; a unique constraint on `(tenant, child, date)` is the arbiter. No conflict resolution. Solve outages with a UPS and 4G failover. |
| Configurability | Lookup values (5 categories), feature flags, document templates. **Custom fields, report registry and dashboard layouts deliberately not built** — see the reasoning in `kindergarten-config-layer.sql`. |
| Storage | Pluggable driver: `local` filesystem or `s3`/MinIO, chosen by `STORAGE_DRIVER`. Start local; switch to s3 when running 2+ containers. Downloads always stream through `GET /files/:id`, never a presigned URL. |

---

## 3. Build order

Foundations first. Weeks 2–5 cannot be parallelized — everything else sits on them.

```
 1  Discovery, questionnaire returned and signed
 2  MONEY MODEL SPIKE          <- before any endpoint exists
 3  Foundation + tenant seam   <- Prisma extension, auth, audit, Swagger
 4  Dynamic RBAC
 5  RBAC continued + users, settings, holidays
 6  Children, documents, medical
 7  Guardians, child-guardian links, dedup
 8  Groups, staff, transfers, capacity
 9  Attendance
10  Pickup persons, permissions, /pickup/verify
11  Tariffs, discounts, accounting periods
12  Billing runs, charges, reversals
13  Period locking, billing rules versioning
14  Payments, allocation, advance credit, receipts
15  Debts, ageing, dashboard aggregates
16  Telegram notifications
17  Reports, xlsx/pdf, expenses
18  Imports, files, opening balances
19  Security hardening, backups with tested restore, load test
20  Buffer                     <- will be used
21  Buffer
22  Postman collections, UAT with the accountant, handoff
```

**22 weeks solo. 15 weeks with a second backend developer** (parallelize from week 6).

Quote 22, aim for 20. If pressure hits, cut in this order: PDF export → dashboard aggregates → Excel import → Telegram. **Never cut** billing tests, the audit log, or backup restore testing.

---

## 4. Verified, not just written

The DDL was executed on PostgreSQL 16.14. Twelve constraint tests pass:

| Test | Result |
|---|---|
| Duplicate check-in for the same child and day | Rejected by unique constraint |
| Duplicate charge, same child/period/kind | Rejected by partial unique index |
| `UPDATE` on `charge` | Rejected by immutability trigger |
| Reversal row (`sign = -1`) with source | Accepted |
| `sign = -1` without a source charge | Rejected by check constraint |
| Insert into a closed accounting period | Rejected by trigger |
| Overlapping group assignments for one child | Rejected by GiST exclusion constraint |
| Role change bumps `permissions_version` | 1 → 3, cache invalidation works |
| Balance view through a reversal | 1.5M charged, reversed, nets to 0 |
| Payment allocation and outstanding view | 20M − 12M = 8M outstanding |
| Duplicate guardian phone in one tenant | Rejected |
| Attendance correction with a 4-character reason | Rejected by length check |
| Half-day at weight 0.5 + non-billable sick day | Sums to 1.5 billable weighted days |

Final object count: **49 tables, 5 views, 112 indexes, 14 triggers, 109 foreign keys, 57 check constraints.**

---

## 5. Blocking now

1. **Send the questionnaire.** Billing cannot be built until sections 1–3 are answered. Sick days and vacation days are the two that matter most.
2. **Confirm arrears billing with the client** (questionnaire §4.1–4.2). If they collect in advance today, the deposit conversation has to happen before go-live, not after.
3. **Get opening balances signed** before migration. Printed list, accountant's signature. A wrong opening balance is nearly impossible to unwind once payments allocate against it.

---

## 6. Explicitly out of scope for Stage 1

Mobile apps · QR/NFC access · online payments · parent portal · curriculum and development tracking · staff HR and payroll · kitchen, menu and inventory · GPS and transport · accounting-system integration · OCR · AI features · utility-provider API integration · meter readings and consumption analytics · multi-branch dashboards · custom field builder · report builder · workflow engine.

Each is a **new feature** under the scope-control rules: description → estimate → price → delivery date → written approval. None is warranty work.

---

## 7. The three failure modes

1. **Building endpoints before the money model is settled.** Week 2 exists for this reason. A billing bug found in week 18 means migrating live financial data.
2. **A raw SQL query without `tenant_id`.** One leak between clients permanently ends the multi-client business case. ESLint rule banning direct `PrismaService` imports, plus code review on every `$queryRaw`.
3. **Promising the original 18 weeks.** The original plan, at its original scope, solo, was a 9–12 month project. This reduced backend-only scope at 22 weeks is honest and defensible.
