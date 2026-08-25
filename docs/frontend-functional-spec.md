# Frontend Functional & API Specification — Kindergarten Management System

The module-by-module reference for building the UI: **what each screen does, which endpoints
back it, what the responses look like, the business rules the UI must honor, and who is allowed
to see it.** Read this together with the [Integration Guide](frontend-integration-guide.md),
which owns the cross-cutting contract (auth, error envelope, money-as-tiyin, dates, pagination,
idempotency, RBAC mechanics).

> **Field names are authoritative in `openapi.json`, not here.** This doc gives you the *structure,
> behavior, and requirements*; generate types from `openapi.json` (Integration Guide §3) for the
> exact request/response shapes. Where a shape is spelled out below it comes from the backend API
> spec, but if it ever disagrees with `openapi.json`, the schema wins.

The API is **fully implemented** — 185 operations across 22 modules. All paths below are relative
to the base prefix `http://localhost:3010/api/v1`.

---

## Part A — Foundations that shape every screen

### A1. The seven roles (personas to design for)

Roles are **data, fully editable per tenant**, but these seven ship seeded and define the primary
personas. Design each major screen around the role(s) that use it. A user may hold **multiple
roles**; grants union and the **broadest scope wins** (`all` > `branch` > `own_group` > `today`).

| Role | Primary jobs | Scope tendency |
|---|---|---|
| **Owner** (protected) | Everything; sole holder of sensitive admin (period reopen, role:manage:sensitive). | `all` |
| **Director** | Oversight: children, groups, staff, reports, dashboards, force-overrides (capacity). | `all` / `branch` |
| **Administrator** | Day-to-day ops: children, guardians, groups, users, settings. | `branch` |
| **Accountant** | Finance: tariffs, billing runs, charges, payments, debts, periods, expenses, finance reports. | `all` / `branch` |
| **Teacher** | Own group only: children (read), attendance check-in/out, medical **alerts only**. | `own_group` |
| **Reception** | Front desk: attendance (today scope), pickup verification, announcements. | `today` |
| **Nurse** | Full medical records, medical alerts, documents. | `branch` / `all` |

**Design rule:** never hard-code role names in UI logic. Gate on **permission keys** from
`/auth/me` (`child:read`, `payment:cancel`, …), because operators create custom roles. Role names
are for display only.

### A2. Permission gating (recap — details in Integration Guide §9)

- `/auth/me` returns `permissions` (key → granted scope) and `permissionsVersion`.
- Show/enable a control only if the user holds the permission; **also** handle `403 FORBIDDEN` /
  `403 OUT_OF_SCOPE` on every action, because a hidden button is UX, not security.
- **Sensitive actions** (`sensitive: true`: payment cancel, period reopen, discounts, role
  management) may exist in the user's grant set but still require confirmation UX — treat them as
  destructive/irreversible in the interface.
- Scopes are **query filters applied server-side**. A teacher's `/children` already returns only
  their group's children. Don't try to widen a scoped list; a directly-requested out-of-scope
  record returns `404`/`OUT_OF_SCOPE`, not the data.

### A3. Cross-cutting UI conventions

- **Every list** = `?page&limit&sort=field:asc&q=&<filters>` → `{ data, meta:{page,limit,total,pages} }`. Build one reusable table/pagination component driven by `meta`.
- **Every money value** = integer-tiyin string. Use the shared `formatMoney`/`toTiyin` helpers. Never a float.
- **Every mutation** should surface the error `code` mapped to a localized message; validation errors (`422`) map `details` to field errors.
- **Financial writes** (`POST /payments`, `/billing-runs/:id/commit`, `/notifications/send`) require an `Idempotency-Key`.
- **Files** are referenced by `fileId`; upload via `POST /files` first, then attach the id. Downloads are short-lived signed URLs (§S4).
- **Localization**: `ru` default + `uz`. Server renders notification text and PDF receipts; everything else the client localizes from codes/keys.

---

## Part B — Modules

Each module lists: **Endpoints** · **Key data** · **Functional requirements** · **Permissions**.

---

### B1. Auth & session

**Endpoints**
```
POST /auth/login {login,password} -> {accessToken, user}   (+ kg_refresh cookie)
POST /auth/refresh -> {accessToken}                         POST /auth/logout -> {success}
GET  /auth/me -> {user, branchIds, roles[], permissions, permissionsVersion}
POST /auth/change-password {currentPassword,newPassword}
POST /auth/forgot-password {login}     POST /auth/reset-password {token,newPassword}
```
**Functional requirements**
- Login accepts phone **or** email **or** username in one field. Handle `423 ACCOUNT_LOCKED`
  (5 fails / 15 min) with a countdown message, and `429` on the 5/min/IP limit.
- Implement the refresh-on-load + single-flight refresh loop (Integration Guide §2).
- After login, fetch `/auth/me`, store `permissions`/`permissionsVersion`, and build the nav from
  the user's grants.
- Change-password and forgot/reset-password flows; enforce the min length client-side (server
  default 10).

**Permissions:** public (login/refresh/logout/forgot/reset); authenticated (me/change-password).

---

### B2. Users

**Endpoints**
```
GET  /users ?role=&status=&branchId=          POST /users {fullName,phone,email,username,password,role,branchIds[]}
GET  /users/:id    PATCH /users/:id           POST /users/:id/activate | /deactivate
GET  /users/:id/login-history
GET  /users/:id/roles   POST /users/:id/roles {roleId,branchId?}   DELETE /users/:id/roles/:roleId   PUT /users/:id/roles
GET  /users/:id/effective-permissions         (resolved set + which role granted each — "why can they?")
GET  /users/:id/permission-overrides   POST /users/:id/permission-overrides   DELETE .../:key
```
**Functional requirements**
- User list with role/status/branch filters; create/edit forms; **deactivate blocks login but
  preserves the audit trail** (never hard-delete users).
- Role assignment UI: a user can hold multiple roles, each optionally scoped to a `branchId`
  (null = all branches).
- **Per-user overrides** (advanced): grant/deny a single permission with a mandatory `reason` and
  optional `validUntil`. Resolution is **deny → grant → role union**; show effect clearly.
  Setting an override requires `role:manage:sensitive`.
- `effective-permissions` powers a "why can this user do X?" debug view — show the granting role
  per permission.

**Permissions:** `user:manage` (sensitive); overrides need `role:manage:sensitive`.

---

### B3. Roles & permissions (RBAC admin)

**Endpoints**
```
GET  /permissions ?group=&includeDeprecated=false   GET /permissions/groups
GET  /roles ?includeSystem=true    POST /roles {code,nameUz,nameRu,description,permissions:[{key,scope}]}
GET  /roles/:id   PATCH /roles/:id {nameUz,nameRu,description}   DELETE /roles/:id
POST /roles/:id/clone {code,nameUz,nameRu}
PUT  /roles/:id/permissions {permissions:[{key,scope}]}   POST /roles/:id/permissions {key,scope}   DELETE .../:key
GET  /roles/:id/users    GET /roles/matrix    GET /roles/:id/diff?against=:otherId
```
**Key data:** each permission has `key`, `group`, `descriptionRu/Uz`, `allowedScopes[]`,
`sensitive`, `deprecated`. Roles have `code`, `nameUz/Ru`, `isSystem`, `isProtected`, `userCount`,
`permissionCount`.
**Functional requirements**
- **Permission matrix UI**: `/permissions/groups` + `/roles/matrix` build a roles × permissions
  grid in one call each. A cell picks a scope from that permission's `allowedScopes`. Save via
  `PUT /roles/:id/permissions` (full replacement).
- **Permissions are read-only** — there is no create-permission endpoint (a grant no code checks is
  a security hole). Only *grants* and *roles* are editable.
- **Clone** is the fastest path to a custom role. **Diff** compares two roles side-by-side.
- Enforce the **safety rails** in the UI (and expect the matching error codes):
  Owner role is protected (`ROLE_PROTECTED`); can't delete a role users hold (`ROLE_IN_USE`);
  can't remove the last Owner (`LAST_OWNER`); can't revoke `role/user:manage` from yourself
  (`SELF_LOCKOUT`); can't grant what you don't hold (`PRIVILEGE_ESCALATION`); sensitive grants need
  `role:manage:sensitive` (`SENSITIVE_PERMISSION`).
- Any role/grant/assignment change bumps `permissionsVersion` → refetch `/auth/me` afterward.

**Permissions:** `role:manage`; sensitive grants gated by `role:manage:sensitive`.

---

### B4. Settings, branches, holidays

**Endpoints**
```
GET /settings   PUT /settings {name,logo,address,phones,bankDetails,taxInfo,workingHours,
                               workingDays,currency,timezone,receiptNumberFormat,defaultLanguage}
GET /branches   POST /branches   PATCH /branches/:id
GET /holidays   POST /holidays {date,name}   DELETE /holidays/:id
```
**Functional requirements**
- Org settings screen (logo upload via Files, bank/tax details for receipts, working
  hours/days, `receiptNumberFormat`, default language, timezone — default `Asia/Tashkent`).
- Branch management (Stage 1 is single-branch but the model is multi-branch — don't assume one).
- Holiday calendar feeds attendance/billing working-day logic; simple date+name CRUD.

**Permissions:** `settings:manage`.

---

### B5. Children

**Endpoints**
```
GET  /children ?groupId=&status=&q=&hasDebt=&hasMedicalAlert=&page=
POST /children   GET /children/:id (profile+group+tariff+guardians+alerts)   PATCH /children/:id
POST /children/:id/status {status,effectiveDate,reason}   GET /children/:id/history   DELETE /children/:id (soft, Owner/Director)
GET/POST /children/:id/documents {type,number,issueDate,expiryDate,fileId}   PATCH .../:docId   POST .../:docId/verify
GET  /documents/expiring ?withinDays=30
GET  /children/:id/medical   PUT /children/:id/medical   GET /children/:id/medical/alerts
GET/POST /children/:id/consents   POST /children/:id/consents/:consentId/revoke
```
**Key data:** statuses = `applicant · active · temporarily_absent · suspended · graduated ·
withdrawn · archived`. Profile detail aggregates group, current tariff, guardians, and alert flags.
**Functional requirements**
- Children directory: search (`q`), filters (group, status, `hasDebt`, `hasMedicalAlert`),
  paginated table. Row badges for debt and medical alerts.
- Profile page tabs: overview, guardians, group/tariff, documents, medical, history, consents.
- **Status changes go through `POST /children/:id/status`** with `effectiveDate` + `reason` (not a
  plain PATCH); render the status timeline from `/history`.
- Documents: attach a `fileId` (upload first), track `expiryDate`, a **verify** action, and an
  expiring-documents view (`/documents/expiring` + report).
- **Medical is access-controlled** (see B6 rule): full record vs alerts-only.
- Consents: record/revoke (e.g. photo/data-processing consent).
- Delete is a **soft delete**, Owner/Director only.

**Permissions:** `child:read`/`child:manage` (scoped: teacher = `own_group`); medical split below.

---

### B6. Medical (within Children) — strict access control

- **Full record** (`GET/PUT /children/:id/medical`: allergies, conditions, medications, emergency
  contacts): **nurse + director only**.
- **Alerts only** (`GET /children/:id/medical/alerts`: allergy name + instruction, nothing else):
  teacher and reception.
- **Accountant: nothing.**
- Design two distinct UIs — a full medical editor gated on `medical:read`, and a compact
  alert banner/flag surface gated on `medical:alerts` (`own_group` for teachers). Never leak full
  medical fields into the alerts surface.

---

### B7. Guardians & child–guardian links

**Endpoints**
```
GET /guardians ?q=&phone=   POST /guardians   GET /guardians/:id (+linked children)   PATCH /guardians/:id
GET /guardians/:id/children
GET  /children/:id/guardians
POST /children/:id/guardians {guardianId,relationship,isPayer,isEmergencyContact,isPrimaryContact}
PATCH/DELETE /children/:id/guardians/:guardianId
POST /guardians/:guardianId/telegram-invite   GET /telegram/bindings   GET /telegram/unbound
```
**Functional requirements**
- Guardians are **deduplicated by phone**. `POST /guardians` with an existing phone returns
  `409 DUPLICATE` **plus the existing record** — the UI should then **link** the existing guardian
  to the child rather than creating a duplicate. This is the core anti-duplicate flow; build the
  create form to detect-and-link.
- One guardian ↔ many children (M:N). Link carries flags: `isPayer`, `isEmergencyContact`,
  `isPrimaryContact`, and `relationship`.
- Phone is normalized server-side to `+998XXXXXXXXX`; accept flexible input, display normalized.
- Telegram: invite a guardian to bind their account; show bound/unbound status.

**Permissions:** `guardian:read`/`guardian:manage`.

---

### B8. Groups

**Endpoints**
```
GET /groups ?branchId=&status=   POST /groups {name,branchId,ageMin,ageMax,capacity,workingHours}
GET /groups/:id (incl. currentCount, availablePlaces)   PATCH /groups/:id
GET /groups/:id/children   POST /groups/:id/children {childId,effectiveDate}
POST /groups/:id/transfer {childId,toGroupId,effectiveDate,reason}
GET /groups/:id/staff   PUT /groups/:id/staff {mainTeacherId,assistantTeacherId}   GET /groups/:id/history
```
**Functional requirements**
- Group list + detail showing `currentCount` / `availablePlaces` / capacity.
- Assign child and transfer child (with `effectiveDate` + `reason`); render `/history`.
- **Capacity**: assignment returns `409 CAPACITY_EXCEEDED` by default; `?force=true` (Director+)
  overrides and writes an audit entry. Show a force-confirm dialog only to users who can force.
- Staff assignment: main + assistant teacher.

**Permissions:** `group:read`/`group:manage`; force override = Director+.

---

### B9. Attendance

**Endpoints**
```
GET /attendance/today ?groupId=&branchId=     GET /attendance ?date=&groupId=&childId=&from=&to=&status=
GET /attendance/inside   /absent ?date=   /not-picked-up   /calendar ?childId=&year=&month=   /summary ?groupId=&from=&to=
POST /attendance/check-in {childId,at?,note?,healthObservation?}     409 ALREADY_CHECKED_IN
POST /attendance/check-out {childId,pickupPersonId,at?,note?}        409 NOT_CHECKED_IN | 403 PERMISSION_EXPIRED
POST /attendance/status {childId,date,status,note}                   absent/sick/vacation/excused
POST /attendance/:id/correct {field,newValue,reason(min 10 chars)}   GET /attendance/corrections ?from=&to=&userId=
```
**Functional requirements**
- **Reception board**: `/attendance/today` grid per group; check-in and check-out actions.
  Check-out **requires selecting a `pickupPersonId`** — wire it to pickup verification (B10).
- Live surfaces: children currently `/inside`, `/absent`, and `/not-picked-up` (checked in, not
  out, past closing) for end-of-day follow-up.
- **Offline strategy is client-side**: a `UNIQUE(tenant,child,date)` DB constraint rejects
  duplicate check-ins, so the client may **queue and blindly retry**; treat
  `409 ALREADY_CHECKED_IN` on replay as success.
- Corrections require a `reason` (min 10 chars) and are audited; provide a corrections log view.
- Calendar (per child, per month) and summary (present/absent counts) views.
- Check-out fires a parent notification asynchronously — don't block the UI on it.
- An SSE feed `GET /attendance/stream` may exist for live reception updates (optional enhancement).

**Permissions:** `attendance:*` (reception = `today` scope; teacher = `own_group`).

---

### B10. Pickup authorization

**Endpoints**
```
GET/POST /children/:id/pickup-persons {fullName,relationship,phone,photoFileId,idDocType,idDocNumber,
         permissionType:'permanent'|'temporary',validFrom,validTo,grantedByGuardianId,note}
PATCH/DELETE /pickup-persons/:id   POST /pickup-persons/:id/revoke {reason}
GET /pickup-permissions/active ?childId=&date=   POST /pickup-permissions/temporary {childId,pickupPersonId?,...,validFrom,validTo,grantedByGuardianId,reason}
GET /children/:id/pickup-history
GET /pickup/verify?childId=&pickupPersonId= -> {allowed, reason, person, photoUrl, expiresAt}
```
**Functional requirements**
- **`/pickup/verify` is the money screen**: reception hits it before releasing a child. It returns
  a single `allowed` boolean + the authorized person's **photo**. Build a big, glanceable
  verify card (photo, name, allowed/blocked, reason). It checks: person linked to child, permission
  not expired, not revoked, child currently checked in.
- Manage permanent pickup persons (with photo + ID doc) and issue **temporary** permissions
  (date-bounded, `grantedByGuardianId`, reason). Revoke with reason. Show pickup history.
- Expect `403 PERMISSION_EXPIRED` at check-out for lapsed temporary permissions.

**Permissions:** `pickup:read`/`pickup:manage`; verify at front-desk scope.

---

### B11. Tariffs & discounts

**Endpoints**
```
GET /tariffs ?active=   POST /tariffs {name,kind,amountTiyin,appliesTo}   PATCH /tariffs/:id
GET /children/:id/tariffs   POST /children/:id/tariffs {tariffId,effectiveFrom,effectiveTo?}
GET/POST/DELETE /children/:childId/discounts {kind:'percent'|'fixed',value,validFrom,validTo,reason}
```
**Key data:** tariff kinds = `monthly_fixed · full_day · half_day · group_based · attendance_based ·
meal · transport · extra_class · registration_fee`.
**Functional requirements**
- Tariff catalog CRUD (amounts in tiyin). Assign tariffs to a child with date ranges.
- **Tariff changes affect future periods only**; existing charges keep their `tariffSnapshot` —
  make that explicit in the UI so accountants know past charges won't move.
- Discounts per child (`percent` or `fixed`, date-bounded, mandatory `reason`). Discount
  management is **sensitive** — confirm and expect audit.

**Permissions:** `tariff:manage`; `discount:manage` (sensitive).

---

### B12. Accounting periods

**Endpoints**
```
GET /periods ?year=   POST /periods {year,month}
POST /periods/:id/close (Accountant+)   POST /periods/:id/reopen (Owner only, reason required, audited)
```
**Functional requirements**
- Period list per year with open/closed state.
- **Close** blocks further writes to the period — surface a clear "period closed" state and expect
  `409 PERIOD_CLOSED` on any financial write into it.
- **Reopen is Owner-only, requires a reason, and is audit-logged** — gate hard and confirm.

**Permissions:** `period:close` / `period:reopen` (both sensitive).

---

### B13. Billing runs & charges

**Endpoints**
```
POST /billing-runs {year,month} -> status:preview   GET /billing-runs/:id (per-child lines, totals, warnings)
GET  /billing-runs/:id/explain/:childId   POST /billing-runs/:id/commit (Idempotency-Key) 409 BILLING_ALREADY_COMMITTED
DELETE /billing-runs/:id (discard preview)
GET /billing-rules   /billing-rules/active   /billing-rules/:id   /billing-rules/:id/diff
POST /billing-rules   POST /billing-rules/simulate   POST /billing-rules/:id ... (see openapi)
GET /charges ?childId=&periodId=&kind=&unpaidOnly=   POST /charges (manual)   POST /charges/:id/reverse {reason}
GET /children/:childId/charges
```
**Functional requirements**
- **Two-phase billing**: `POST /billing-runs` produces a **preview** that writes nothing —
  show per-child lines, totals, and **warnings**. `commit` is one transaction and requires an
  `Idempotency-Key`; a second commit for the same period is impossible (`BILLING_ALREADY_COMMITTED`).
  A user can **discard** a preview.
- `explain/:childId` gives a per-child breakdown ("why is this charge this amount?") — build a
  drill-down from the preview line.
- **Billing rules** are configurable and versioned (`/billing-rules/active`, `diff`, `simulate`);
  provide a rules editor with a **simulate** step before saving. (Deep logic: proration,
  attendance-based charges, etc. lives in `kindergarten-docs/docs/03-billing-rules.md`.)
- **Charges are an append-only ledger**: reverse inserts a `sign=-1` row, never deletes. Manual
  charges are possible. Show reversals as offsetting lines, not edits.

**Permissions:** `charge:generate`; `charge:reverse` (sensitive); billing-rules under finance/admin.

---

### B14. Payments & receipts

**Endpoints**
```
GET /payments ?childId=&from=&to=&method=&recordedBy=
POST /payments (Idempotency-Key) {childId,payerGuardianId,amountTiyin,method,paidAt,receiptNo?,bankRef?,
     attachmentFileId?,note?,allocations?:[{chargeId,amountTiyin}]}
GET /payments/:id (+allocations)   POST /payments/:id/cancel {reason} (Accountant+, sign=-1 reversal)
GET /payments/:id/receipt ?format=pdf|html
```
**Functional requirements**
- Record payment form: child, payer guardian, amount (tiyin), method, date, optional receipt/bank
  ref and attachment. **Idempotency-Key required** — mint on form open, reuse on retry.
- **Allocations**: omit `allocations` → server allocates **FIFO oldest-charge-first**; unallocated
  remainder becomes **advance credit** auto-applied by the next billing run. Optionally let the
  accountant allocate manually per charge. Show resulting allocations on the payment detail.
- **Cancel** is a `sign=-1` reversal (Accountant+, reason required), never a delete — display as an
  offsetting entry.
- Receipt view/print: `GET /payments/:id/receipt?format=pdf|html` (server-rendered, localized).

**Permissions:** `payment:read`/`payment:create`; `payment:cancel` (sensitive).

---

### B15. Debts

**Endpoints**
```
GET /debts ?groupId=&overdueOnly=&minAmountTiyin=&ageing=
GET /debts/:childId -> {currentCharge, previousDebt, totalPaid, advanceBalance, currentDebt,
                        overdueAmount, ageing:{notOverdue,d1_7,d8_30,d30plus}}
GET /debts/summary -> totals by group and by ageing bucket
```
**Functional requirements**
- Debts are **always computed from the ledger** — there is **no stored balance to edit**. The UI
  is read-only reporting; you never "set" a balance, you record charges/payments and debt follows.
- Debtors list with overdue/min-amount/ageing filters; per-child debt card with the ageing
  breakdown; summary dashboard by group and ageing bucket. Consider a "send reminder" action wired
  to notifications.

**Permissions:** `debt:read` (scoped `all`/`branch`/`own_group`).

---

### B16. Notifications & announcements

**Endpoints**
```
GET/POST /announcements {title,body,priority,publishAt,expiresAt,fileIds[],
         audience:{type:'all'|'group'|'children'|'guardians'|'staff',ids[]}}
GET /announcements/:id   POST /announcements/:id/publish   DELETE /announcements/:id
GET /notification-templates   PUT /notification-templates/:key {uz,ru,variables[]}   POST .../:key/preview {sampleData}
POST /notifications/send (Idempotency-Key) {templateKey,recipients[],channel:'telegram'|'sms'|'internal',data}
GET /notifications ?recipientId=&channel=&status=&from=&to=   GET /notifications/:id (attempts, error detail)   POST /notifications/:id/retry
```
**Key data:** template keys = `child_arrived · child_departed · payment_received · charge_created ·
debt_reminder · announcement · event_reminder · emergency`.
**Functional requirements**
- Announcements: compose with audience targeting (all/group/children/guardians/staff), schedule
  (`publishAt`/`expiresAt`), attachments, priority; explicit **publish** step.
- **Templates are stored per language (uz/ru)** and rendered server-side — the editor edits both
  language variants and lists `variables[]`; provide a **preview** with sample data. The client
  does **not** localize notification text.
- Send: `POST /notifications/send` requires an `Idempotency-Key`; sends are queued with backoff,
  max 3 attempts, and server-side dedup — a delivery log (`/notifications`) shows status/attempts,
  with a **retry** action. Respect the 20/min/tenant send rate limit.

**Permissions:** `notification:send` / `announcement:manage` / template management under admin.

---

### B17. Reports & exports

**Endpoints**
```
GET /reports/attendance/{daily|monthly|corrections}   /reports/children/{active|enrollments|documents-expiring|medical-alerts}
GET /reports/finance/{charges|payments|debts|discounts|cancellations}   /reports/expenses/monthly
Every report accepts ?format=json|xlsx|pdf   +  report-specific filters (dates, group, period, method, ageing)
GET /exports/:id -> {status, downloadUrl, expiresAt}
```
**Functional requirements**
- Report screens with filters; `format=json` renders inline tables. `xlsx`/`pdf` **may return
  `202 {jobId,status:'processing'}`** for large result sets (~>5,000 rows) — poll `GET /exports/:id`
  until `downloadUrl` is ready, then download. Build one reusable "async export" handler.
- Finance reports are permission-gated (finance); attendance/children reports per their scopes.

**Permissions:** `report:read` (per-report scoping; finance reports under finance).

---

### B18. Dashboards

**Endpoints**
```
GET /dashboard/director   GET /dashboard/accountant   GET /dashboard/reception
```
**Functional requirements**
- One aggregate call per role-dashboard returns all tiles for that screen — **use it instead of
  fanning out** to a dozen endpoints. Route the user to the dashboard matching their primary role;
  if they hold several, let them switch.
- Director: enrollment/attendance/finance overview. Accountant: charges/payments/debts/period
  status. Reception: today's attendance, currently inside, not-picked-up, pickup queue.

**Permissions:** each dashboard gated by its role's read permissions.

---

### B19. Expenses

**Endpoints**
```
GET /expenses ?year=&month=&type=&status=   POST /expenses {type,provider,billingYear,billingMonth,amountTiyin,dueDate,attachmentFileId,note}
PATCH /expenses/:id   POST /expenses/:id/pay {paidAt,amountTiyin,attachmentFileId}   GET /expenses/summary ?year=
```
**Functional requirements**
- Recurring/operational expense tracking (utilities, providers): create with due date + optional
  attachment, mark paid, filter by year/month/type/status, and a yearly summary. Amounts in tiyin.

**Permissions:** `expense:manage` (finance).

---

### B20. Files

**Endpoints**
```
POST /files (multipart) -> {fileId,url,size,mime}   GET /files/:id (signed URL, 15-min expiry, permission-checked)   DELETE /files/:id
```
**Functional requirements**
- Generic upload used by children documents, pickup photos, payment/expense attachments, settings
  logo, announcements. **Flow: upload → get `fileId` → attach the id to the parent record.**
- Enforce client-side limits matching the server: max size `MAX_UPLOAD_MB` (default 20) and MIME
  allow-list (jpeg/png/webp/pdf) — expect `413 FILE_TOO_LARGE` / `415 UNSUPPORTED_MEDIA_TYPE`.
- Download URLs are **signed and expire in 15 min** — fetch a fresh URL at click time; never cache
  or hard-link them.

**Permissions:** checked per owning resource.

---

### B21. Imports

**Endpoints**
```
GET /imports/templates/:entity (xlsx template)   POST /imports/validate (multipart -> row-level errors)
POST /imports/commit {importJobId,skipInvalid}   GET /imports/:id (status, processed, failed rows)
```
**Key data:** entities = `children · guardians · groups · users · opening_balances · expenses`.
**Functional requirements**
- Wizard: download template → upload → **validate** (show row-level errors) → **commit** (with
  `skipInvalid` option) → poll `/imports/:id` for progress and a failed-rows report.
- `opening_balances` is how debts are seeded at go-live — treat carefully.

**Permissions:** `import:manage`.

---

### B22. Audit

**Endpoints**
```
GET /audit ?entity=&entityId=&userId=&action=&from=&to=   GET /audit/:id (before/after JSON diff)
```
**Functional requirements**
- **Read-only** audit browser (Owner + Director only): filter by entity/user/action/date, and a
  detail view showing the before/after JSON diff. No write endpoints exist.

**Permissions:** `audit:read` (Owner/Director).

---

## Part C — Suggested build order

Ship in slices that give a usable app early; each depends roughly on the ones above it.

1. **Auth shell** — login, refresh loop, `/auth/me`, permission-gated nav, error/i18n scaffolding, money/date helpers.
2. **Children + Guardians + Groups** — the core records everything else references.
3. **Attendance + Pickup** — the daily reception workflow (`/attendance/today`, `/pickup/verify`).
4. **Finance** — tariffs → periods → billing runs → charges → payments → debts (in that order; each builds on the last).
5. **Notifications + Announcements**, then **Reports + Dashboards**.
6. **Admin** — Users, Roles/permissions matrix, Settings/branches/holidays, Audit.
7. **Expenses, Files polish, Imports** — supporting flows.

For anything not fully specified here, the endpoint's exact contract is in `openapi.json`; the
deep business rules are in `kindergarten-docs/docs/` (billing in `03-billing-rules.md`, Telegram in
`05-telegram-spec.md`). When the schema and this doc disagree, **the schema wins** — and if
neither answers a question, flag it rather than guessing.
