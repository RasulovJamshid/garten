# Kindergarten Management System — API Specification (Backend Only)

**Scope change:** no frontend. Deliverable is a documented REST API + OpenAPI spec.
All 10 core operational modules covered. Tenant-ready, single-tenant deployment.

---

## 0. Coverage check against required modules

| Required | Endpoints | Notes |
|---|---|---|
| Children | `/children/*`, `/children/:id/documents`, `/children/:id/medical` | Full profile, documents, status history |
| Parents | `/guardians/*`, `/children/:id/guardians` | M:N — one guardian, many children |
| Groups | `/groups/*`, `/groups/:id/children`, `/groups/:id/staff` | Capacity, transfers, history |
| Attendance | `/attendance/*` | Check-in/out, statuses, currently-inside, corrections |
| Pickup authorization | `/pickup-persons/*`, `/pickup-permissions/*` | Permanent + temporary, verification |
| Payments | `/payments/*`, `/charges/*`, `/tariffs/*`, `/billing-runs/*` | Full ledger |
| Debts | `/debts/*` | Derived, never stored |
| Notifications | `/announcements/*`, `/notifications/*`, `/notification-templates/*` | Telegram + internal |
| Reports | `/reports/*` | Excel/PDF generated server-side |
| Permissions | `/auth/*`, `/users/*`, `/roles/*` | Hardcoded role map, enforced per request |

Plus: `/expenses` (recurring expenses), `/audit`, `/imports`, `/files`, `/settings`, `/dashboard`.

---

## 1. OpenAPI generation — do not hand-write it

Hand-maintained OpenAPI files drift from the code within weeks. Single source of truth:

```ts
// main.ts
const config = new DocumentBuilder()
  .setTitle('Kindergarten API')
  .setVersion('1.0')
  .addBearerAuth()
  .build();

const document = SwaggerModule.createDocument(app, config);
SwaggerModule.setup('docs', app, document);       // Scalar or Redoc UI
writeFileSync('./openapi.json', JSON.stringify(document, null, 2));
```

- Every DTO uses `class-validator` + `@ApiProperty()`. Validation and docs from one definition.
- `openapi.json` is committed and regenerated in CI. **CI fails if the committed file differs from generated** — that guarantees docs never lag code.
- Consumers generate typed clients: `openapi-typescript` (TS), `openapi-generator` (anything else).

Serve `/docs` behind auth in production.

---

## 2. Conventions (apply to every endpoint)

### Auth
```
Authorization: Bearer <access_token>       # JWT, 15 min
POST /auth/refresh with httpOnly refresh cookie   # 30 days, rotating
```
JWT claims: `sub` (userId), `tid` (tenantId), `bid[]` (branchIds), `role`.
**`tid` is never taken from a request body, query, or header — only from the token.**

### Every request passes 5 checks in order
1. Authenticated
2. Role exists
3. Permission for the action
4. Tenant match (automatic via Prisma extension)
5. Branch access + record ownership (e.g. teacher → own group only)

### Money
All amounts are **integer tiyin serialized as strings** (JSON has no int64).
```json
{ "amountTiyin": "150000000", "currency": "UZS" }
```
Never send formatted strings, never send floats. Clients format for display.

### Dates
- Timestamps: ISO 8601 with offset — `2026-07-29T08:14:00+05:00`
- Calendar dates: `YYYY-MM-DD`, always **Asia/Tashkent** local
- Billing periods: `{ "year": 2026, "month": 7 }`

### Pagination (all list endpoints)
```
GET /children?page=1&limit=50&sort=lastName:asc&q=alisher&status=active

{
  "data": [...],
  "meta": { "page": 1, "limit": 50, "total": 342, "pages": 7 }
}
```
`limit` max 200. Default 50.

### Errors
```json
{
  "error": {
    "code": "PERIOD_CLOSED",
    "message": "Accounting period 2026-06 is closed",
    "details": { "periodId": "...", "year": 2026, "month": 6 },
    "traceId": "01J8..."
  }
}
```
Machine-readable `code` is the contract. `message` is English/debug only — **clients localize from `code`**, since there is no server-side UI language.

Core codes: `UNAUTHENTICATED` `FORBIDDEN` `NOT_FOUND` `VALIDATION_FAILED` `DUPLICATE` `PERIOD_CLOSED` `BILLING_ALREADY_COMMITTED` `ALREADY_CHECKED_IN` `NOT_CHECKED_IN` `CAPACITY_EXCEEDED` `PERMISSION_EXPIRED` `INSUFFICIENT_ALLOCATION` `CONFLICT`

### Idempotency
Mutating financial endpoints accept:
```
Idempotency-Key: <uuid>
```
Required on `POST /payments`, `POST /billing-runs/:id/commit`, `POST /notifications/send`.
Replay returns the original response, not a duplicate record.

### Rate limits
`POST /auth/login` — 5/min/IP. Notification sends — 20/min/tenant. Everything else — 300/min/user.

---

## 3. Auth & permissions

```
POST   /auth/login                  { login, password }  login = phone|email|username
POST   /auth/refresh
POST   /auth/logout
GET    /auth/me                     -> user, role, permissions[], branches[]
POST   /auth/password/forgot
POST   /auth/password/reset
GET    /auth/sessions               active sessions
DELETE /auth/sessions/:id           revoke

GET    /users            ?role=&status=&branchId=
POST   /users            { fullName, phone, email, role, branchIds[], password }
GET    /users/:id
PATCH  /users/:id
POST   /users/:id/activate
POST   /users/:id/deactivate        blocks login, preserves audit trail
GET    /users/:id/login-history

```

Account lockout after 5 failed attempts / 15 min. Passwords: argon2id.

`GET /auth/me` returns the caller's **resolved** permission set with scopes, plus `permissionsVersion` — consumers cache against that value and refetch when it changes.

```json
{
  "user": { "id": "...", "fullName": "...", "branchIds": ["..."] },
  "roles": [{ "id": "...", "code": "teacher", "nameRu": "Воспитатель" }],
  "permissions": {
    "child:read": "own_group",
    "attendance:checkin": "own_group",
    "medical:alerts": "own_group"
  },
  "permissionsVersion": 47
}
```

### Permission catalog (read-only — defined in code, synced to DB on boot)

```
GET  /permissions                 -> all permissions, grouped, with allowedScopes
     ?group=finance&includeDeprecated=false
GET  /permissions/groups          -> group list for building a matrix UI
```

```json
{
  "group": "finance",
  "items": [
    { "key": "payment:cancel", "descriptionRu": "Отмена платежа",
      "descriptionUz": "To'lovni bekor qilish",
      "allowedScopes": ["all"], "sensitive": true, "deprecated": false }
  ]
}
```

**Permissions cannot be created via API.** They exist only if code enforces them. Attempting `POST /permissions` returns `405`. This is deliberate — a grant that no endpoint checks is a silent security hole.

### Roles — fully manageable

```
GET    /roles                     ?includeSystem=true
       -> id, code, name, isSystem, isProtected, userCount, permissionCount

POST   /roles                     requires role:manage
       { code, nameUz, nameRu, description,
         permissions: [{ key, scope }] }

GET    /roles/:id                 -> full grant list with scopes
PATCH  /roles/:id                 { nameUz, nameRu, description }
DELETE /roles/:id                 409 ROLE_IN_USE if any user holds it
                                  403 ROLE_PROTECTED for owner

POST   /roles/:id/clone           { code, nameUz, nameRu }
       -> copies all grants; the fastest path to a custom role

PUT    /roles/:id/permissions     full replacement (matrix save)
       { permissions: [{ key, scope }] }
POST   /roles/:id/permissions     { key, scope }        grant one
DELETE /roles/:id/permissions/:key                      revoke one

GET    /roles/:id/users           who currently holds this role
GET    /roles/matrix              roles x permissions grid, one call
GET    /roles/:id/diff?against=:otherId    compare two roles
```

### Assigning roles to users

```
GET    /users/:id/roles
POST   /users/:id/roles           { roleId, branchId? }   branchId null = all
DELETE /users/:id/roles/:roleId   ?branchId=
PUT    /users/:id/roles           full replacement
GET    /users/:id/effective-permissions
       -> resolved set + which role granted each (for debugging "why can they?")
```

A user may hold **multiple roles**; grants are unioned, broadest scope wins.

### Per-user overrides (exceptions without inventing a role)

```
GET    /users/:id/permission-overrides
POST   /users/:id/permission-overrides    requires role:manage:sensitive
       { key, scope, effect: 'grant'|'deny', reason, validUntil? }
DELETE /users/:id/permission-overrides/:key
```

Resolution: **deny override → grant override → union of role grants.** Explicit deny always wins. `reason` is mandatory and audit-logged.

### Error codes specific to RBAC

| Code | Meaning |
|---|---|
| `ROLE_PROTECTED` | Owner role cannot be modified or deleted |
| `ROLE_IN_USE` | Users still hold this role; reassign first |
| `LAST_OWNER` | Cannot remove the final active Owner |
| `SELF_LOCKOUT` | Cannot revoke `role:manage` / `user:manage` from yourself |
| `PRIVILEGE_ESCALATION` | Cannot grant a permission you do not hold |
| `SENSITIVE_PERMISSION` | Granting this requires `role:manage:sensitive` |
| `UNKNOWN_PERMISSION` | Key not in the code catalog |
| `INVALID_SCOPE` | Scope not in that permission's `allowedScopes` |

### Cache invalidation contract

Any change to roles, grants, assignments, or overrides increments `tenant.permissionsVersion`. The server's guard keys its cache on that value, so **edits take effect on the affected user's next request** — no re-login, no stale window.

Clients should read `permissionsVersion` from `/auth/me`, cache the permission set against it, and refetch when a `X-Permissions-Version` response header exceeds the cached value.

### Every endpoint declares its requirement

```ts
@Post('payments/:id/cancel')
@RequirePermissions('payment:cancel')
async cancel(@Auth() ctx: AuthContext, ...) {}
```

The decorator metadata is also what generates `/permissions` documentation and the RBAC test matrix — one declaration, three uses.

---

## 4. Children

```
GET    /children      ?groupId=&status=&q=&hasDebt=&hasMedicalAlert=&page=
POST   /children
GET    /children/:id                -> profile + group + tariff + guardians + alerts
PATCH  /children/:id
POST   /children/:id/status         { status, effectiveDate, reason }
GET    /children/:id/history        group, tariff, status, enrollment changes
DELETE /children/:id                soft delete, Owner/Director only
```

Statuses: `applicant` `active` `temporarily_absent` `suspended` `graduated` `withdrawn` `archived`

```
GET    /children/:id/documents
POST   /children/:id/documents      { type, number, issueDate, expiryDate, fileId }
PATCH  /children/:id/documents/:docId
POST   /children/:id/documents/:docId/verify
GET    /documents/expiring          ?withinDays=30

GET    /children/:id/medical        allergies, conditions, medications, emergency
PUT    /children/:id/medical
GET    /children/:id/medical/alerts short flags for reception/teacher
```

**Medical access control:** nurse + director get full records. Teacher and reception get `/alerts` only — allergy name and instruction, nothing else. Accountant gets nothing.

---

## 5. Parents / guardians

```
GET    /guardians              ?q=&phone=
POST   /guardians              deduplicated by (tenantId, phone)
GET    /guardians/:id          -> profile + all linked children
PATCH  /guardians/:id
GET    /guardians/:id/children

GET    /children/:id/guardians
POST   /children/:id/guardians { guardianId, relationship, isPayer,
                                 isEmergencyContact, isPrimaryContact }
PATCH  /children/:id/guardians/:guardianId
DELETE /children/:id/guardians/:guardianId
```

`POST /guardians` with an existing phone returns `409 DUPLICATE` plus the existing record — the client links instead of creating. This is what prevents the duplicate-parent-per-child problem.

Phone normalization to `+998XXXXXXXXX` happens server-side on write.

---

## 6. Groups

```
GET    /groups                ?branchId=&status=
POST   /groups                { name, branchId, ageMin, ageMax, capacity, workingHours }
GET    /groups/:id            -> incl. currentCount, availablePlaces
PATCH  /groups/:id
GET    /groups/:id/children
POST   /groups/:id/children   { childId, effectiveDate }   409 CAPACITY_EXCEEDED
POST   /groups/:id/transfer   { childId, toGroupId, effectiveDate, reason }
GET    /groups/:id/staff
PUT    /groups/:id/staff      { mainTeacherId, assistantTeacherId }
GET    /groups/:id/history
```

Capacity returns `409` by default; `?force=true` (Director+) overrides and writes an audit entry.

---

## 7. Attendance

```
GET  /attendance/today            ?groupId=&branchId=
GET  /attendance                  ?date=&groupId=&childId=&from=&to=&status=
GET  /attendance/inside           children currently in the building
GET  /attendance/absent           ?date=
GET  /attendance/not-picked-up    checked in, not out, past closing time
GET  /attendance/calendar         ?childId=&year=&month=
GET  /attendance/summary          ?groupId=&from=&to=  per-child present/absent counts

POST /attendance/check-in
     { childId, at?, note?, healthObservation? }
     409 ALREADY_CHECKED_IN

POST /attendance/check-out
     { childId, pickupPersonId, at?, note? }
     409 NOT_CHECKED_IN | 403 PERMISSION_EXPIRED

POST /attendance/status
     { childId, date, status, note }    absent/sick/vacation/excused

POST /attendance/:id/correct
     { field, newValue, reason }        reason required, min 10 chars
GET  /attendance/corrections            ?from=&to=&userId=
```

**Duplicate protection:** `UNIQUE (tenantId, childId, attendanceDate)` in Postgres. A replayed check-in from a client-side offline queue is rejected by the database, not by application logic. This is the entire offline strategy — clients queue and retry blindly, the DB is the arbiter.

Check-out triggers a parent notification asynchronously (`pg-boss`), never blocking the response.

Optional live feed for reception clients:
```
GET  /attendance/stream           Server-Sent Events: check-in / check-out events
```

---

## 8. Pickup authorization

```
GET    /children/:id/pickup-persons
POST   /children/:id/pickup-persons
       { fullName, relationship, phone, photoFileId, idDocType, idDocNumber,
         permissionType: 'permanent'|'temporary', validFrom, validTo,
         grantedByGuardianId, note }
PATCH  /pickup-persons/:id
DELETE /pickup-persons/:id
POST   /pickup-persons/:id/revoke   { reason }

GET    /pickup-permissions/active   ?childId=&date=
POST   /pickup-permissions/temporary
       { childId, pickupPersonId?, fullName?, phone?, idDocNumber?,
         validFrom, validTo, grantedByGuardianId, reason }

GET    /children/:id/pickup-history
GET    /pickup/verify?childId=&pickupPersonId=
       -> { allowed, reason, person, photoUrl, expiresAt }
```

`/pickup/verify` is the endpoint reception hits before releasing a child — it returns a single boolean plus the photo. Design any client around this call. It checks: person is linked to child, permission not expired, not revoked, child is currently checked in.

Stage 5 adds one-time PIN/QR — the verify endpoint's response shape already accommodates it.

---

## 9. Tariffs, billing, payments, debts

### Tariffs
```
GET    /tariffs                ?active=
POST   /tariffs                { name, kind, amountTiyin, appliesTo }
PATCH  /tariffs/:id
GET    /children/:id/tariffs
POST   /children/:id/tariffs   { tariffId, effectiveFrom, effectiveTo? }
POST   /children/:id/discounts { kind: 'percent'|'fixed', value,
                                 validFrom, validTo, reason }
```
Tariff kinds: `monthly_fixed` `full_day` `half_day` `group_based` `attendance_based` `meal` `transport` `extra_class` `registration_fee`

Tariff changes affect future periods only. Existing charges keep their `tariffSnapshot`.

### Accounting periods
```
GET    /periods                ?year=
POST   /periods                { year, month }
POST   /periods/:id/close      Accountant+ ; blocks further writes to the period
POST   /periods/:id/reopen     Owner only ; audit-logged, requires reason
```

### Billing runs
```
POST   /billing-runs           { year, month }        -> status: preview
GET    /billing-runs/:id       -> per-child preview lines, totals, warnings
POST   /billing-runs/:id/commit    Idempotency-Key required
       409 BILLING_ALREADY_COMMITTED
DELETE /billing-runs/:id       discards a preview
```
Preview writes nothing to `charge`. Commit is one transaction. A partial unique index makes a second commit for the same period impossible at the DB level.

### Charges
```
GET    /charges                ?childId=&periodId=&kind=&unpaidOnly=
POST   /charges                manual charge
POST   /charges/:id/reverse    { reason }   inserts sign=-1 row, never deletes
GET    /children/:id/charges
```

### Payments
```
GET    /payments               ?childId=&from=&to=&method=&recordedBy=
POST   /payments               Idempotency-Key required
       { childId, payerGuardianId, amountTiyin, method, paidAt,
         receiptNo?, bankRef?, attachmentFileId?, note?,
         allocations?: [{ chargeId, amountTiyin }] }
GET    /payments/:id           -> payment + allocations
POST   /payments/:id/cancel    { reason }   Accountant+ ; sign=-1 reversal
GET    /payments/:id/receipt   ?format=pdf|html
```

Omit `allocations` → server allocates **FIFO oldest charge first** inside a `SERIALIZABLE` transaction with `SELECT ... FOR UPDATE`. Unallocated remainder becomes advance credit, applied automatically by the next billing run.

### Debts
```
GET  /debts                  ?groupId=&overdueOnly=&minAmountTiyin=&ageing=
GET  /debts/:childId         -> currentCharge, previousDebt, totalPaid,
                                advanceBalance, currentDebt, overdueAmount,
                                ageing { notOverdue, d1_7, d8_30, d30plus }
GET  /debts/summary          totals by group and by ageing bucket
```
Always computed from the ledger view. **No stored balance column exists to be queried or corrupted.**

---

## 10. Notifications & announcements

```
GET    /announcements
POST   /announcements
       { title, body, priority, publishAt, expiresAt, fileIds[],
         audience: { type: 'all'|'group'|'children'|'guardians'|'staff', ids[] } }
GET    /announcements/:id
POST   /announcements/:id/publish
DELETE /announcements/:id

GET    /notification-templates
PUT    /notification-templates/:key   { uz, ru, variables[] }
POST   /notification-templates/:key/preview   { sampleData }

POST   /notifications/send      Idempotency-Key required
       { templateKey, recipients[], channel: 'telegram'|'sms'|'internal', data }
GET    /notifications           ?recipientId=&channel=&status=&from=&to=
GET    /notifications/:id       -> delivery attempts, error detail
POST   /notifications/:id/retry
```

Template keys: `child_arrived` `child_departed` `payment_received` `charge_created` `debt_reminder` `announcement` `event_reminder` `emergency`

Templates are stored **per language (uz/ru)** because the server renders the final text — there is no frontend to localize it. Guardian record carries `preferredLanguage`.

All sends are queued jobs with exponential backoff, max 3 attempts, and a dedup key of `(templateKey, recipientId, entityId)` to prevent double-sends on retry.

---

## 11. Reports & dashboard

```
GET  /reports/attendance/daily        ?date=&groupId=
GET  /reports/attendance/monthly      ?year=&month=&groupId=
GET  /reports/attendance/corrections  ?from=&to=
GET  /reports/children/active         ?groupId=
GET  /reports/children/enrollments    ?from=&to=
GET  /reports/children/documents-expiring
GET  /reports/children/medical-alerts
GET  /reports/finance/charges         ?periodId=
GET  /reports/finance/payments        ?from=&to=&method=
GET  /reports/finance/debts           ?ageing=
GET  /reports/finance/discounts       ?from=&to=
GET  /reports/finance/cancellations   ?from=&to=
GET  /reports/expenses/monthly        ?year=&month=

Every report accepts:  ?format=json|xlsx|pdf
```

`json` returns rows inline. `xlsx`/`pdf` returns `202` with a job id when the row count is large:
```json
{ "jobId": "...", "status": "processing" }
GET /exports/:jobId   -> { status, downloadUrl, expiresAt }
```
Under ~5,000 rows, generate synchronously and stream the file.

```
GET  /dashboard/director
GET  /dashboard/accountant
GET  /dashboard/reception
```
One aggregate call each, returning the exact tiles from the original spec. Without a frontend these are still worth building — any consumer (Telegram bot, tablet client, third-party UI) needs one cheap call rather than fifteen.

---

## 12. Expenses, files, imports, audit, settings

```
GET    /expenses           ?year=&month=&type=&status=
POST   /expenses           { type, provider, billingYear, billingMonth,
                             amountTiyin, dueDate, attachmentFileId, note }
PATCH  /expenses/:id
POST   /expenses/:id/pay   { paidAt, amountTiyin, attachmentFileId }
GET    /expenses/summary   ?year=

POST   /files              multipart -> { fileId, url, size, mime }
GET    /files/:id          signed URL, 15 min expiry, permission-checked
DELETE /files/:id

GET    /imports/templates/:entity        xlsx template download
POST   /imports/validate                 multipart -> row-level errors
POST   /imports/commit                   { importJobId, skipInvalid }
GET    /imports/:id                      status, processed, failed rows
```
Import entities: `children` `guardians` `groups` `users` `opening_balances` `expenses`

```
GET  /audit    ?entity=&entityId=&userId=&action=&from=&to=
GET  /audit/:id  -> before/after JSON diff
```
Append-only. No write endpoints exist. Owner + Director read access only.

```
GET  /settings
PUT  /settings     name, logo, address, phones, bankDetails, taxInfo,
                   workingHours, workingDays, currency, timezone,
                   receiptNumberFormat, defaultLanguage
GET  /holidays  |  POST /holidays  |  DELETE /holidays/:id
GET  /branches  |  POST /branches  |  PATCH /branches/:id
```

---

## 13. Revised timeline — backend only

Dropping the frontend removes roughly 8 weeks. Reduced Stage 1, solo:

| Weeks | Block |
|---|---|
| 1 | Discovery — real forms, billing rules, tariff edge cases confirmed with the accountant |
| **2** | **Money-model spike** — ledger schema, allocation algorithm, 20 unit-tested scenarios. Before anything else. |
| 3 | Foundation — Docker Compose, Prisma, migrations, **tenant extension**, auth, audit infrastructure, Swagger wiring |
| 4–5 | **Dynamic RBAC** — catalog sync, role/grant CRUD, resolution engine, versioned cache guard, scope service, safety rails, user CRUD, settings, holidays |
| 5 | Children + documents + medical |
| 6 | Guardians + child-guardian links + dedup |
| 7 | Groups, staff assignment, transfers, capacity |
| 8 | Attendance — check-in/out, statuses, queries, corrections |
| 9 | Pickup persons, temporary permissions, `/pickup/verify` |
| 10 | Tariffs, discounts, periods |
| 11–12 | Billing runs, charges, reversals, period locking |
| 13 | Payments, allocation, advance credit, cancellation, receipts |
| 14 | Debts, ageing, dashboard aggregates |
| 15 | Notifications — Telegram bot, templates, delivery log, queue |
| 16 | Reports + xlsx/pdf generation + expenses module |
| 17 | Imports, files, opening balances |
| 18 | Security hardening, rate limits, backups **with tested restore**, load test at 5k children |
| 19 | Buffer — will be used |
| 20 | API docs polish, Postman collection, integration handoff, UAT with accountant via docs UI |

**21–22 weeks solo. 14–15 weeks with a second backend developer** (parallelize from week 6; weeks 2–5 cannot be split — money model, tenant seam and RBAC are foundations everything else sits on).

Dynamic RBAC adds ~1.5 weeks over a hardcoded role map. Remaining weeks shift by one; the buffer week stays.

---

## 14. Backend-only implications worth stating explicitly

1. **UAT is harder without a UI.** The accountant cannot verify billing by clicking. Mitigation: build a thin internal admin using the Swagger/Scalar docs UI plus a set of prepared Postman/Bruno collections for the 19 acceptance scenarios. Budget week 20 for this — do not skip it.
2. **Localization moves to the client**, except notification templates and PDF receipts, which the server renders. Keep uz/ru template pairs server-side.
3. **The offline story becomes a client responsibility.** Server contract: idempotent writes + unique constraints. Document this clearly for whoever builds the client.
4. **`/dashboard/*` aggregate endpoints are still worth building** — otherwise every future client makes 15 calls to render one screen.
5. **API versioning from day one:** prefix everything `/api/v1`. Breaking changes go to `/v2`; never mutate `/v1` response shapes once a client exists.
6. **Contract tests.** Since the API is the product, add tests that assert response shapes, not just status codes. A silently renamed field is a production outage for the consumer.
