# Frontend Developer Handbook — Kindergarten Management

Repository handoff, reviewed 18 September 2026 against the checked-in backend source and OpenAPI. This document covers the staff application, public website, integration contract, screen behavior, visual direction, and delivery checklist. It describes implemented backend capabilities; proposed layouts and frontend organization are implementation guidance, not claims about an existing UI.

**Current corrections (3 October 2026):** read [the correction record](project-fixes-2026-10-03.md) and use the current OpenAPI. It covers branch filters and transfer validation, medical warning shapes, notification retries, export authorization, and the deployable web contract patch.

## Contents

1. [Project and architecture](#1-project-and-architecture)
2. [Connect and run locally](#2-connect-and-run-locally)
3. [API and session contract](#3-api-and-session-contract)
4. [Permissions and data handling](#4-permissions-and-data-handling)
5. [Screens and workflows](#5-screens-and-workflows)
6. [Visual design](#6-visual-design)
7. [Frontend implementation structure](#7-frontend-implementation-structure)
8. [Deployment and troubleshooting](#8-deployment-and-troubleshooting)
9. [Build order and acceptance](#9-build-order-and-acceptance)
10. [Complete API inventory](#10-complete-api-inventory)

## 1. Project and architecture

The product manages a kindergarten's children, guardians, groups, daily attendance, authorized pickup, billing, payments, debts, staff access, communication, and reports. It also provides a CMS for the public kindergarten website.

| Surface | Audience | Responsibility |
|---|---|---|
| Staff application | Reception, teachers, nurse, administrator, accountant, director, owner | Authenticated operational workflows; screens depend on effective permissions |
| Public website | Prospective parents | Published marketing content, languages, contact information, SEO |
| Landing editor | Authorized staff | Draft content, preview, publish, version history and restore |
| Telegram integration | Guardians and staff | Backend-managed account binding and notifications |

The backend is NestJS/TypeScript with PostgreSQL, Prisma, JWT authentication, dynamic RBAC, pg-boss background jobs, and local or S3-compatible file storage. The browser communicates through REST; it never connects directly to PostgreSQL, MinIO, the job queue, or Telegram credentials. Tenant identity comes from authentication; branch/group access is enforced server-side.

```text
Staff UI -- Bearer + refresh cookie --> NestJS /api/v1
Public website -- anonymous GET -----> /api/v1/public/landing/...
                                          |
                               PostgreSQL + file storage
                                          |
                               Background jobs / Telegram
```

This checkout contains the backend, a mobile directory, documentation, and frontend deployment infrastructure. The web frontend is referenced as `AzizBokhidjonov/alishax` by the deployment files; its source was not inspected for this handoff. Preserve that application's existing framework, routing and design conventions when implementing these requirements. Older guides suggest a React/Vite SPA, but the current deployment expects a server-rendered `.output` build. Do not assume the older suggested stack describes the deployed frontend.

### Sources and precedence

- [OpenAPI](../openapi.json): exact paths, methods, request/response schemas and documented parameters. Generate frontend types from this file.
- Current controllers, DTOs and services under [src](../src): runtime behavior, permissions, validation and supported capabilities. If runtime and schema differ, record the discrepancy and follow the verified runtime behavior.
- [Backend handoff](backend-handoff-2026-09-11.md): important corrections to earlier frontend specifications.
- [Integration guide](frontend-integration-guide.md), [functional specification](frontend-functional-spec.md), [design guide](frontend-design-guide.md), [landing specification](frontend-landing-page.md): deeper reference; apply the corrections in this handbook and the backend handoff.
- [Deployment](../DEPLOYMENT.md): infrastructure and rollout procedure.

This is a source review, not a verification of the live production service. Recheck contracts when the backend revision changes.

## 2. Connect and run locally

Use Node.js 22.12 or newer within the Node 22 line used by the Docker build, npm, Docker Compose, and an isolated development database. Commands below run from the backend repository in PowerShell.

```powershell
# Copy only if .env does not already exist; keep existing local configuration.
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
docker compose up -d postgres minio
npm ci
npm run prisma:generate
npm run prisma:migrate:deploy
npm run seed
npm run start:dev
```

Before migrations/seeding, confirm `.env` points to the local database. Set the following values for a frontend running on port 5173; substitute its actual origin if different:

```dotenv
PORT=3010
API_PREFIX=/api/v1
APP_URL=http://localhost:5173
CORS_ORIGINS=http://localhost:5173
DATABASE_URL=postgresql://kg_app:kg_app_dev_password@localhost:5433/kindergarten
TELEGRAM_ENABLED=false
STORAGE_DRIVER=local
```

Keep `JWT_SECRET` server-side. Use `.env.example` for the remaining backend settings. Restart the backend after changing its environment. With local storage, MinIO is optional; Compose also supplies it for S3 integration development.

| Item | Local value |
|---|---|
| API base | `http://localhost:3010/api/v1` |
| Swagger UI | `http://localhost:3010/docs` |
| Health endpoint | `http://localhost:3010/api/v1/health` |
| PostgreSQL host port | `5433` |
| MinIO API / console | `9000` / `9001` |
| Default seeded owner | `owner@demo.local` / `ChangeMe12345!` — local fake-data environment only |

Seed credentials can be overridden with `SEED_OWNER_EMAIL` and `SEED_OWNER_PASSWORD`. In a second terminal, after the API is running, `npm run seed:demo` creates realistic fake groups, staff, children, attendance, charges and payments. It drives the HTTP API and must only target development data.

Frontend public build variables used by this repository's deployment:

```dotenv
VITE_API_BASE_URL=http://localhost:3010/api/v1
VITE_API_PROXY_TARGET=http://localhost:3010
VITE_LANDING_TENANT_CODE=demo
```

Use the frontend repository's scripts and lockfile to install/start its application. No frontend development command is supplied by this backend's `package.json`. `VITE_*` values are public: never put tokens, database passwords or storage secrets in them.

Smoke check: open Swagger, log in, then call `/auth/bootstrap` with the returned access token. Confirm organization and permitted lookup data load before building domain screens.

## 3. API and session contract

### Paths, schemas and payloads

Paths in the narrative below are relative to `/api/v1`. The committed OpenAPI paths already include `/api/v1`: configure a generated client with the origin or strip that prefix in your wrapper, so it is never appended twice.

The API generally uses JSON. Uploads use `multipart/form-data`; files, receipts and reports can return binary content. Inspect status and content type before parsing. Authentication POSTs explicitly return 200; many other POSTs return 201. Handle successful `2xx` responses instead of assuming every mutation returns 200 or every response contains JSON.

Generate request and response types from the supplied schema using the frontend's chosen code-generation tooling. For a frontend that uses `openapi-typescript`, the command is:

```bash
npx openapi-typescript ./openapi.json -o ./src/api/schema.d.ts
```

Refresh the schema and regenerate types when the backend changes. Dynamic calculation traces and report values still require explicit UI adapters. Unknown request properties can be rejected by the backend validation pipe; do not send the entire UI form state as a DTO.

### Login, startup, refresh and logout

1. Send `POST /auth/login` with `{ "login": "owner@demo.local", "password": "ChangeMe12345!" }` and `credentials: 'include'`.
2. Keep the returned `accessToken` in memory. The response also contains `user`; the server sets the `kg_refresh` cookie.
3. Send `Authorization: Bearer <accessToken>` on protected requests. Load `GET /auth/bootstrap` to initialize identity, roles, effective permissions, organization, accessible branches/groups, own group IDs, timezone and currency.
4. On page reload, call `POST /auth/refresh` with credentials included, then bootstrap. Show an initial session-loading state while this resolves.
5. On an authenticated request's 401, share one in-flight refresh across concurrent requests, then replay each failed request at most once. The current JWT guard returns `UNAUTHENTICATED` for invalid/expired JWTs; **do not require `TOKEN_EXPIRED` to trigger refresh**.
6. Do not apply the refresh loop to login/refresh/reset endpoints themselves. If refresh is rejected, clear identity and private query caches and show login. Distinguish a temporary network outage from a confirmed invalid session; never loop indefinitely.
7. On logout, call `POST /auth/logout` with credentials included, then clear in-memory session and private caches. Cancel pending requests so old results cannot populate the next user's session.

The refresh cookie is HttpOnly, SameSite=Lax, Secure in production, and scoped to `/api/v1/auth` with the default prefix. JavaScript cannot read it. Default lifetimes are 15 minutes for access and 30 days for refresh, configurable by the backend. Login/forgot/reset are rate-limited to 5/minute/IP; repeated failed logins can lock the account.

Both login and refresh need `credentials: 'include'` for browser cross-origin cookie handling. CORS must list the exact UI origin, including scheme and port. Keep local hosts consistent (`localhost` versus `127.0.0.1`). A UI hosted on a different site from the API needs a backend cookie/deployment review; adding a CORS origin alone does not change SameSite behavior.

`/auth/forgot-password` always responds generically; delivery currently depends on an active Telegram binding. Do not promise an email reset message. `/auth/change-password` and `/auth/reset-password` use their generated DTOs.

### Example authenticated request

```ts
// accessToken comes from the session manager; this illustrates transport only.
const response = await fetch(`${apiBase}/auth/bootstrap`, {
  headers: { Authorization: `Bearer ${accessToken}` },
  credentials: 'include',
});
if (!response.ok) {
  // Route through the shared error/refresh handler before reading success data.
  throw await response.json();
}
const bootstrap = await response.json();
```

Use one shared transport for normal JSON requests and authenticated binary downloads. Handle non-JSON gateway failures with a generic transport error rather than crashing the error parser. Set `Content-Type: application/json` only for JSON bodies; let the browser set multipart boundaries for `FormData`.

### Lists and errors

`GET /children?page=1&limit=50` returns:

```json
{
  "data": [],
  "meta": { "page": 1, "limit": 50, "total": 0, "pages": 0 }
}
```

Other ordinary array collections return a pagination envelope when `page` or `limit` is provided; without those parameters they retain array responses. Object aggregates, the attendance board and report streams have distinct contracts. Default limit is 50, maximum 200; page numbers start at 1. Only children currently paginates at the database level. Apply filters/sorts only where the endpoint supports them; do not assume all lists accept `q` or `sort`.

Use actual response `meta` for page counts. Keep search/filter/page state in the URL and reset page to 1 when filters change. Preserve null values: a hidden or unavailable amount is not zero.

```json
{
  "error": {
    "code": "PERIOD_CLOSED",
    "message": "Diagnostic text",
    "details": {},
    "traceId": "support-reference"
  }
}
```

Translate `error.code`; `message` is diagnostic. `details` may be an object, validation strings, or path/message entries. Show field-level errors when mapping is possible and an accessible form summary otherwise. Retain trace IDs for support without logging credentials or sensitive child records.

| Code or condition | UI behavior |
|---|---|
| 401 on protected request | One shared refresh and one replay |
| `ACCOUNT_LOCKED`, `ACCOUNT_INACTIVE` | Explain account state; do not keep retrying |
| `FORBIDDEN`, `OUT_OF_SCOPE` | Permission-aware unavailable state; refresh permissions if appropriate |
| `NO_SCOPE_ASSIGNMENT` | Ask staff to contact an administrator for branch/group assignment; do not present an empty successful list |
| `VALIDATION_FAILED`, `INVALID_REFERENCE` | Keep form values; display actionable validation |
| `DUPLICATE_RECORD`, `CONCURRENT_MODIFICATION`, `CONCURRENT_PAYMENT` | Reload relevant records and reconcile before resubmission |
| `IDEMPOTENCY_CONFLICT` | Same key was used with different request data; reconcile the prior result before starting a new action |
| `PERIOD_CLOSED`, `BILLING_PREVIEW_STALE` | Explain the blocking state; rebuild stale preview rather than silently committing |
| `ALREADY_CHECKED_IN`, `NOT_CHECKED_IN` | Refetch attendance and reconcile actual state |
| `PICKUP_NOT_AUTHORIZED`, `PERMISSION_EXPIRED` | Block release and display the reason |
| `CAPACITY_EXCEEDED` | Keep assignment form open; choose another group/date |
| `LAST_OWNER`, `SELF_LOCKOUT`, `PRIVILEGE_ESCALATION`, `SENSITIVE_PERMISSION` | Explain the specific access-management restriction |
| 413 / 415 | Explain upload size/type restriction |
| 429 | Back off and show retry guidance |
| Unknown code / server or network failure | Safe generic message and retry where appropriate; retain trace ID |

This table is a UI mapping guide, not an exhaustive error registry.

### Idempotency and retry policy

`POST /payments`, `POST /billing-runs/{id}/commit`, and `POST /notifications/send` require `Idempotency-Key`. Create a UUID per intentional action; keep the same key and identical payload across retries. Disable duplicate submission while pending. A changed payment payload requires a new action/key after the previous outcome has been reconciled.

Manual notification sends persist the required request key and a payload hash, so the same key and identical payload reuse the same notifications even without `entityId`. A changed payload under that key returns 409. Domain-event sends can additionally use a stable `entityId`. New intentional sends require new keys.

Never blindly retry arbitrary POSTs after ambiguous network failures. Refetch state first. Checkout must remain visibly pending until the server confirms it; do not represent an offline queued request as permission to release a child.

## 4. Permissions and data handling

### RBAC

Permissions are a map of keys to effective scopes, for example `{ "child:read": "own_group" }`. Scopes include `all`, `branch`, `own_group`, `today`, and `self`; the allowed scopes depend on the permission. Build navigation, routes, tabs and controls from effective permissions, not role names. Seeded roles are editable templates and custom roles are supported.

Use `/permissions` and `/permissions/groups` for the catalog and allowed scopes, `/roles/matrix` for administration, and `/users/{id}/effective-permissions` to explain sources and overrides. Re-fetch bootstrap or `/auth/me` after access changes and on session revalidation. `permissionsVersion` is a comparison value; there is no automatic permission-change push feed.

Child-read access does not grant medical, financial or file access. Hide inaccessible tabs and avoid fetching their data. `hasDebt` and `hasMedicalAlert` can be null when the caller lacks access; render an unavailable/hidden badge rather than false. Corresponding filters also require permission. The server remains authoritative on every operation.

### Money, dates and names

- All financial amounts travel as integer **tiyin strings**. `"150000000"` means 1,500,000.00 UZS; 100 tiyin = 1 som.
- Keep exact integer/decimal arithmetic. Never convert money through JavaScript `Number`, `parseFloat`, or a floating-point sum. Convert a validated decimal input to a tiyin string; reject excess fractional precision instead of silently truncating. Account for signs when formatting reversal rows.
- Example: user input `15000.50` som becomes `"1500050"` tiyin. Currency formatting is a display adapter, never an API value.
- Date-only fields are `YYYY-MM-DD` inputs. Prisma DATE responses may be ISO timestamps: use the date portion without timezone conversion. Birthdays, attendance dates and tariff dates must not move with the browser timezone.
- Real timestamps include an offset or `Z`; display them using `Asia/Tashkent`. Billing months use `{year, month}` with month 1–12.
- Children have `firstName`, `lastName`, optional `middleName`; compose the display name. Do not assume child `fullName` exists. Guardians, pickup persons and staff have their own response shapes.
- Staff UI supports Russian and Uzbek; public content additionally supports English. Keep interface translations separate from server-rendered notification templates.

### Files

Upload `FormData` with field `file` to `POST /files`, optionally using documented `entityType`/`entityId` query parameters. Save the returned `fileId` on the owning record. Default generic limits are 20 MB and JPEG/PNG/WebP/PDF; deployment configuration may change them. XLSX imports use the dedicated import endpoint.

Private downloads need Bearer authentication plus file/resource permissions. Fetch bytes, create a Blob URL for an image/download, then revoke it when no longer needed. A plain `<img src=".../files/id">` or download anchor cannot attach the access-token header. Returned `/files/{id}` paths are API-relative: resolve them against the configured API base.

Public landing images use the published payload's `mediaBaseUrl`, without private credentials. Do not send tokens to arbitrary URLs in content or file metadata. Only published referenced media is exposed through that public endpoint.

## 5. Screens and workflows

The following route names describe UI areas; adapt them to the frontend's existing routing. API paths are listed separately in section 10.

| Area | Main screen and required behavior |
|---|---|
| Login and account | Login, session loading, generic reset request, reset token form, change password, logout |
| Dashboard | Permission-appropriate director/accountant/reception aggregate endpoint; actionable metric cards and drill-down links |
| Children | Searchable/filterable directory; create/edit; status history; profile tabs for authorized domains |
| Guardians | Search before create; edit contact data; link an existing guardian to multiple children; manage link-specific fields |
| Groups | Capacity, children, staff, assignment dates, transfers and history |
| Attendance | Today's complete roster, group filter, search, check-in, absence status, authorized checkout, history/calendar/corrections |
| Pickup | Standing persons, temporary permissions, verification card, revoke with reason, pickup history |
| Medical | Restricted record editor and separately authorized alert view; documents/consents use their own endpoints |
| Finance | Tariffs, child assignments/discounts, periods, billing preview/commit, active charges, full ledger, payments, receipts, debts, adjustments |
| Expenses | Period/type/status filters, expense form, attachment, full settlement and summary |
| Communication | Announcement draft/target/schedule/publish, bilingual templates, send confirmation, delivery history and retry |
| Reports | Report selection, endpoint-specific filters, inline results and XLSX/PDF export progress |
| Staff and roles | Users, activation, scoped role assignment, effective-permission explanation, permission matrix, overrides |
| Administration | Organization settings, branches, holidays, import wizard, read-only audit browser |
| Website | Block editor, translations, SEO, preview, publish, versions and restore |

### Child admission and profiles

Create child → find/create and link guardians → assign group with effective dates → change status to active → assign applicable tariff → complete permitted document/medical/consent records. These are separate API operations; a partially completed admission must remain recoverable.

New children start as `applicant`. Attendance eligibility requires the appropriate active status and current group assignment. Child statuses include `applicant`, `active`, `temporarily_absent`, `suspended`, `graduated`, `withdrawn`, `archived`; do not assume arbitrary transitions are allowed. Withdrawal ends assignments; reactivation starts a new enrollment window. Future group assignments must not appear as current before their effective date.

Profile tabs should include overview, guardians, group/status history, attendance, pickup, documents, consents, medical and finance where permitted. A medical warning includes allergies or nonempty emergency instructions. Full medical reads return `{record, allergies, medications}`; the limited alerts read returns `{allergies, emergencyInstructions}`. Medical alerts are a distinct limited view; never fetch full medical records just to render an alert icon. Document verification and consent revocation are explicit actions.

### Attendance and pickup: the daily workflow

Use `GET /attendance/board?groupId=...&branchId=...` for a complete daily roster. It returns `{date, data}` with `child`, nullable `attendance`, and `recorded` per item. Null attendance means **unrecorded**, not absent. `/attendance/today` only lists recorded entries and can legitimately be empty in the morning.

1. Reception selects a group or searches for a child.
2. Arrival calls `POST /attendance/check-in` with `{childId}` and optional documented observations. Refresh the row, board counts and relevant dashboard.
3. Absence/sick/vacation/excused is an explicit attendance status action. Changing an existing status may require correction permission and a reason.
4. Departure opens a pickup panel. Select an active standing person or temporary permission and call `/pickup/verify` with `childId` and `pickupPersonId` or `pickupPermissionId`.
5. Display the name, available photo, authorization result, reason and expiry. A blocked result cannot enable checkout.
6. Submit checkout with the same identifier. The backend re-verifies authorization; only successful checkout confirms departure.

Ad-hoc temporary permission can work without a standing pickup person. A guardian relationship alone is not the checkout authorization contract. Check-in/out are today's operational actions; use corrections for historical data. Corrections require a reason of at least ten characters and timestamps on the attendance date in Tashkent; empty `newValue` clears a timestamp.

Show correction `billingResolution` (`not_required`, `applied`, `manual_required`). Pending financial work needs an accountant follow-up. Do not conceal this behind a generic success toast.

Poll the board approximately every 20–30 seconds while visible and on focus; there is no attendance SSE/WebSocket endpoint. On a lost check-in response, refetch and reconcile an `ALREADY_CHECKED_IN` conflict before marking success. Keep connectivity and pending states visible.

### Billing, payments and debt

The backend owns calculation, allocation and ledger state. UI previews explain those results; they do not implement an independent billing engine.

**Tariffs and rules:** manage the tariff catalog, dated child assignments, date-bounded discounts and versioned billing rules. Replacement tariffs close applicable overlapping earlier assignments; end an assignment via its PATCH endpoint. Existing charges keep calculation snapshots. Backdated changes to billed periods need financial resolution. Rules support arrears billing; do not offer estimate/advance billing modes. Advance payments are supported.

**Monthly billing:** select/create a period → `POST /billing-runs` with `{year,month}` → show persisted preview, child lines, totals and warnings → drill into `explain/{childId}` → confirm → commit with an idempotency key. A preview stores a run but does not post charges. List runs to recover unfinished work. If commit returns `BILLING_PREVIEW_STALE`, rebuild and review the new preview; never silently substitute it.

**Ledger:** `/charges` is the active positive charge view with allocation/outstanding amounts. `/children/{childId}/charge-ledger` is the complete append-only history, including signed adjustments and reversals. Display offsetting entries linked to their originals. Never offer direct balance editing.

**Adjustments:** `/charges/adjustments` takes positive `amountTiyin`, `sign`, `childId`, `periodId`, a reason of at least ten characters and optional `dueDate`. Negative sign credits the family; positive sign adds debt. Requires both charge-generate and charge-reverse permissions. This operation is not a cash refund; a separate refund workflow is not implemented.

**Payment example** (replace the placeholder ID with a real child UUID):

```http
POST /api/v1/payments
Authorization: Bearer <access-token>
Content-Type: application/json
Idempotency-Key: <uuid-for-this-action>

{
  "childId": "<child-uuid>",
  "amountTiyin": "150000000",
  "method": "cash",
  "paidAt": "2026-09-18T10:00:00+05:00"
}
```

Optional fields include payer guardian, receipt number, bank reference, attachment, note and manual allocations. Omit allocations to allocate FIFO to oldest open charges; remaining money becomes advance credit. Show the actual allocation and credit after save. Supported method values are `cash`, `bank`, `card`, `online`, `other`. Let the backend generate receipt numbers when omitted. Download authenticated PDF/HTML receipts from the payment receipt endpoint.

Payment cancellation and charge reversal create ledger reversals, not deletion. Require the documented reason and show a confirmation with child, amount and action. Refresh debts, payments, charges and finance aggregates after a confirmed mutation.

**Periods and corrections:** closing prevents financial writes into that period. Gate reopening by `period:reopen`, not a hardcoded Owner role. Attendance recalculation can reverse/reissue open-period charges or create an adjustment in a following open period; manual policies produce pending work. The child recalculation endpoint accepts `{year,month}`.

**Debts:** display computed current debt, previous debt, paid amounts, advance credit, overdue amount and ageing buckets. Positive balance alone is not necessarily overdue; use server due-date results. **Expenses:** payment currently requires full settlement; do not offer partial settlement.

### Communication and Telegram

Announcements use create → select audience → schedule → publish. Audience types include all, group, children, guardians and staff. Display selected targets clearly; do not invent recipient totals if no authoritative count is available. Scheduled announcements enqueue when published. Attachment delivery is currently rejected; do not expose it as working.

Supported notification delivery channels are Telegram and internal. DTO enums also mention SMS/email, but service behavior rejects those channels. Template editing supports Russian/Uzbek and server-rendered preview. Delivery is asynchronous: queued is not delivered. Show attempts/failure and retry controls from notification endpoints. Send limit is 20/minute/tenant.

On a guardian profile, create a Telegram invite and show its returned deep link and 72-hour lifetime. Provide bound/unbound lists for authorized administrators. Browser code must never call the webhook receiver as a normal UI action or expose the bot token.

### Reports, imports and audit

Reports accept endpoint-specific filters and `format=json|xlsx|pdf`. Render JSON according to that report's schema. An export can return bytes immediately or `202` with a job ID; poll `/exports/{id}` until ready/failed/expired. Fetch its private download path through the authenticated file helper. Keep export progress recoverable across route changes.

Import flow: choose entity → download XLSX template → upload `file` to `/imports/validate?entity=...` → review row errors → commit `{importJobId,skipInvalid}` → show job results. Supported entities: children, guardians, groups, users, opening_balances, expenses. Make skipping invalid rows explicit with available counts. A runtime failure with `skipInvalid=false` rolls back the import; `true` can retain successful rows. Replaying a completed job returns its result. Opening-balance imports require a clear finance confirmation.

Audit is read-only. Filter by entity/user/action/date and render a readable before/after diff. Users/roles forms must handle last-owner, self-lockout, privilege and protected-role restrictions. Role-permission replacement is a full replacement; use explicit Save/Discard and preserve unedited grants.

### Public website and CMS

The public website reads `/public/landing/{tenantCode}?lang=uz|ru|en` anonymously. `/public/landing` only works when the deployment configures a default tenant. Never use the private draft endpoint as public content. Render published HTML on the server or at build time according to the frontend architecture; include SEO metadata and a useful unpublished/unavailable state.

Supported block types: hero, about, features, gallery, teachers, pricing, testimonials, FAQ, contacts, CTA and stats. The editor reads `/landing/block-types` for forms/schema, supports ordering, visibility, locale fields, media and SEO. The public renderer still needs a deliberate renderer for each supported type and a graceful fallback for unknown types; dynamic form generation does not automatically design new public sections.

Saving edits changes the draft. Publishing freezes a new public snapshot. Use `hasUnpublishedChanges` for publish state; distinguish unsaved local edits from saved-but-unpublished content. Restore republishes a previous snapshot as a new version. Gate editing by `landing:manage` and publish/restore by `landing:publish`.

Public translations fall back requested language → Russian → Uzbek → English. Marketing pricing is localized text, not a tiyin amount. Use `mediaBaseUrl` for public images; honor ETag/cache headers and avoid serving stale content indefinitely after publication. Render text safely and validate link/embed schemes. No public application/contact submission API is listed: contact CTAs should use supplied phone/link targets until a submission feature is implemented.

## 6. Visual design

Use a calm, clear staff interface with high readability and a warmer public website. The existing [design guide](frontend-design-guide.md) remains the detailed reference. The values below are proposed starting tokens where the frontend has no established system; reuse established brand tokens when available.

| Token | Suggested value / treatment |
|---|---|
| App background | `#F6F8FA` |
| Card/surface | `#FFFFFF` |
| Main text | `#172B3A` |
| Secondary text | `#526370` |
| Border | `#DCE3E8` |
| Brand/action | `#176B5B`, white text; verify contrast in each component state |
| Success | Green badge + icon + state label |
| Warning | Amber-tinted background + dark text + label |
| Danger | Red-tinted background + dark red text + reason |
| Information | Blue-tinted badge for preview, draft and queued states |
| Spacing | 4/8/12/16/24/32 px scale |
| Radius | 8–12 px controls/cards |
| Type | Existing font with full Cyrillic/Latin coverage; 14 px desk, 16 px reception/teacher |
| Numbers | Tabular digits, money right-aligned, currency in column heading |

### Staff shell

```text
+------------------+--------------------------------------------------+
| Organization     | Page title    Branch/group    Language   Account |
|                  +--------------------------------------------------+
| Dashboard        | Summary / period / status                        |
| Attendance       | Search                 Filters     Primary action |
| Children         +--------------------------------------------------+
| Groups           | Table, roster cards or workflow                  |
| Finance          |                                                  |
| Communication    | Selected-record drawer / detail when needed      |
| Reports          |                                                  |
| Administration   | Pagination / totals / last refreshed state       |
+------------------+--------------------------------------------------+
```

Hide unauthorized navigation entries and empty groups. Keep the current page, active branch/group and period visible. Use compact desktop tables for accounting; use spacious cards/rows with targets at least 44 px for reception and teachers. On narrow screens, collapse the sidebar and prioritize child name, state and primary action; complex financial tables can scroll horizontally with a clear cue.

### Screen composition

- **Attendance:** search and group filters at top; present/inside/unrecorded counts; child photo/name, group, recorded state and clear arrival/departure action. Show stale/offline/pending indicators. Do not color unrecorded children as confirmed absent.
- **Pickup verification:** large person photo or explicit unavailable placeholder, person and child names, unmistakable allowed/blocked label, expiry/reason, then confirm departure. Never use color alone for authorization.
- **Child profile:** identity/status header, current group and authorized alerts, then permission-aware tabs. Keep actions close to the data they change.
- **Billing preview:** visible “Preview — charges not posted” state, period, totals/warnings, child breakdown, explanation drawer and separate Commit confirmation.
- **Payment form:** child/debt context, amount/method/date, optional payer/attachments, allocation details and visible advance-credit explanation. Preserve values after validation failures.
- **Role matrix:** sticky role headers and permission column, grouped permissions, scope selector from allowed scopes, sensitive marker and explicit dirty/save state.
- **Dashboards:** a few readable metric cards with links to supporting lists; only chart data the API supplies. Missing/failed metrics must not become zero or fabricated trends.
- **Landing editor:** block list, selected-block form with locale controls, preview area and clear draft/published status. Publish stays separate from Save.

Every asynchronous surface needs loading, empty, no-filter-results, forbidden, failed and success states. Loading should preserve layout. Explain empty screens and provide a permitted next action. Confirm ledger reversals, period changes, sensitive access edits and publication with the concrete effect; request reasons only where the workflow requires them.

Support keyboard navigation, visible focus, labelled inputs, accessible dialogs/focus restoration, field error announcements, and text/icon status cues. Verify contrast and Russian/Uzbek label lengths at mobile/tablet/desktop sizes. Avoid putting sensitive details into global toasts or logs.

### Public-site appearance

Use welcoming kindergarten photography, generous spacing, warm neutral backgrounds, restrained brand accents, clear typography and a prominent contact/visit CTA. Recommended narrative: hero → trust/stats → about/features → teachers/gallery → pricing → testimonials/FAQ → contacts/CTA, following the published block order rather than forcing that order in code. Use actual supplied content; omit unavailable optional sections instead of inventing prices, staff or testimonials. Provide responsive images, descriptive alt text and stable aspect ratios.

## 7. Frontend implementation structure

Adapt this separation to the existing frontend:

```text
src/
  api/          generated schema, transport, domain endpoint functions
  auth/         session lifecycle, bootstrap, permission checks
  features/     children, attendance, pickup, finance, reports, admin, website
  components/   tables, forms, status badges, dialogs, empty/error states
  lib/          exact money, dates, private files, export polling
  locales/      Russian and Uzbek UI text, error-code translations
```

Keep server-state queries separate from form drafts and session state. Include resource, relevant scope, filters and period in cache keys; clear private caches on logout/user change. Invalidate dependent data after successful mutation: for example payment → payments, debt, charges and accountant totals; attendance → board/calendar/summary and affected financial data when recalculation occurs.

For SSR, do not keep user tokens in a shared module singleton or cache private responses globally. Public landing data may be cached by tenant/language/version; private data must stay isolated to its session. Browser in-memory authentication and server-rendered public content are compatible; choose authenticated SSR deliberately if the frontend requires it.

## 8. Deployment and troubleshooting

Repository deployment configuration targets UI `https://alishaxkids.uz` and API `https://api.alishaxkids.uz/api/v1`. These are configured destinations, not live availability claims. See [frontend environment example](../.env.frontend.example), [Docker recipe](../deploy/frontend/Dockerfile), [frontend deployment notes](frontend-deployment-2026-09-11.md) and [deployment runbook](../DEPLOYMENT.md).

The frontend image expects `npm run build` to produce `.output`, runs `.output/server/index.mjs` on port 3000, and checks `/kirish` for an HTML response. Preserve or intentionally update that deployment contract when changing routing/framework. Absolute API URLs are required by the existing SSR deployment configuration. Public build-variable changes require a rebuild.

| Symptom | First checks |
|---|---|
| CORS/network error | Exact UI origin in `CORS_ORIGINS`; restart backend; correct scheme/port; API reachable |
| Refresh fails after login/reload | Credentials included on login and refresh; cookie path/site/Secure constraints; consistent hostnames |
| API 404 | Avoid duplicated `/api/v1`; verify method/path in schema |
| Empty attendance | Use `/attendance/board`; child active and currently assigned; check scope error |
| Missing child name | Compose first/last/middle name; inspect nested versus flat response |
| File image/download gets 401 | Fetch with Bearer and use Blob URL; verify file/resource permission |
| Money off by 100 | Input/display is som; API is tiyin strings |
| Date shifts by one day | Stop timezone conversion for date-only fields |
| Payment retry conflicts | Preserve key/payload; reconcile original result before creating a new action |
| No public landing page | Correct tenant code/default tenant and published snapshot |
| Announcement not delivered | Published state, schedule, supported channel, binding, backend worker/provider status |

## 9. Build order and acceptance

Implement in usable slices: session/bootstrap and shared components → children/guardians/groups → attendance/pickup → tariffs/periods/billing/payments/debts → communication/reports → administration/imports/expenses → landing editor/public polish. Integrate permissions and translations in each slice.

Before handoff, verify against an isolated backend with demo data:

- [ ] Login, reload refresh, concurrent 401 recovery, invalid-session handling and logout work; one user's cached data never appears for another.
- [ ] Restricted users see only permitted routes/tabs/actions; no-scope errors and nullable badges are handled correctly.
- [ ] Admission can be resumed after a partial failure; active/current assignments appear on the daily board.
- [ ] Unrecorded attendance is distinct from absence; duplicate arrival reconciles; revoked/expired pickup is blocked; checkout waits for server confirmation.
- [ ] Historical corrections show reasons and financial resolution status.
- [ ] Large amounts, negative ledger entries and two-decimal input remain exact; dates remain correct with a browser outside Tashkent.
- [ ] Billing preview/commit/stale-preview flow works; closed periods block changes; payment retries do not duplicate entries; FIFO/advance credit and reversals display correctly.
- [ ] Uploads, authorized image previews, receipts, immediate exports and queued exports work.
- [ ] Notifications use supported channels and stable event identity; queued/delivered/failed states are distinct.
- [ ] Imports show validation and partial-failure outcomes; permission replacement preserves intended grants.
- [ ] Draft changes stay private until publish; media, translations, SEO and version restore work on the public site.
- [ ] Russian/Uzbek layouts, keyboard operation, focus, contrast, responsive layouts and loading/error/empty states have been checked.

Frontend validation should cover these workflows with focused unit/component tests for money/date/session helpers and browser integration tests for admission, pickup and finance. This documentation update itself does not certify that the separate frontend passes those checks.

## 10. Complete API inventory

The tables below are extracted from the checked-in `openapi.json`. Paths include `/api/v1`; `{id}` and similar segments are placeholders. Request schema names refer to `components.schemas` in that file. “Inline” means inspect the inline schema; “—” means no documented body. Tables list documented response status codes, not a complete list of possible runtime errors. Query parameters, field requirements, response types and permission enforcement must be read from the linked schema and current backend; this index is for navigation.

<!-- API_INVENTORY_START -->

**206 operations across 164 paths.**

### auth

| Method | Path | Purpose | Request body schema | Documented statuses |
|---|---|---|---|---|
| POST | `/api/v1/auth/login` | Log in | LoginDto | 200, 400, 401, 403, 404, 409, 422 |
| POST | `/api/v1/auth/refresh` | Refresh the access token | ? | 200, 400, 401, 403, 404, 409, 422 |
| POST | `/api/v1/auth/logout` | Log out | ? | 200, 400, 401, 403, 404, 409, 422 |
| POST | `/api/v1/auth/change-password` | Change your own password | ChangePasswordDto | 200, 400, 401, 403, 404, 409, 422 |
| POST | `/api/v1/auth/forgot-password` | Request a password reset | ForgotPasswordDto | 200, 400, 401, 403, 404, 409, 422 |
| POST | `/api/v1/auth/reset-password` | Reset a password with a token | ResetPasswordDto | 200, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/auth/me` | Get the current user | ? | 200, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/auth/bootstrap` | Frontend bootstrap: profile, organization and accessible lookup data | ? | 200, 400, 401, 403, 404, 409, 422 |

### telegram

| Method | Path | Purpose | Request body schema | Documented statuses |
|---|---|---|---|---|
| POST | `/api/v1/telegram/webhook` | Telegram webhook receiver | ? | 200, 400, 401, 403, 404, 409, 422 |
| POST | `/api/v1/guardians/{guardianId}/telegram-invite` | Create a Telegram invite for a guardian | ? | 201, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/telegram/bindings` | List Telegram bindings | ? | 200, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/telegram/unbound` | List guardians not yet bound to Telegram | ? | 200, 400, 401, 403, 404, 409, 422 |

### audit

| Method | Path | Purpose | Request body schema | Documented statuses |
|---|---|---|---|---|
| GET | `/api/v1/audit` | List audit log entries | ? | 200, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/audit/{id}` | Get an audit log entry by ID | ? | 200, 400, 401, 403, 404, 409, 422 |

### permissions

| Method | Path | Purpose | Request body schema | Documented statuses |
|---|---|---|---|---|
| GET | `/api/v1/permissions` | List all permissions | ? | 200, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/permissions/groups` | List permission groups | ? | 200, 400, 401, 403, 404, 409, 422 |

### health

| Method | Path | Purpose | Request body schema | Documented statuses |
|---|---|---|---|---|
| GET | `/api/v1/health` | Health check | ? | 200, 400, 401, 403, 404, 409, 422 |

### roles

| Method | Path | Purpose | Request body schema | Documented statuses |
|---|---|---|---|---|
| GET | `/api/v1/roles` | List roles | ? | 200, 400, 401, 403, 404, 409, 422 |
| POST | `/api/v1/roles` | Create a role | CreateRoleDto | 201, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/roles/matrix` | Get the full role/permission matrix | ? | 200, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/roles/{id}` | Get a role by ID | ? | 200, 400, 401, 403, 404, 409, 422 |
| PATCH | `/api/v1/roles/{id}` | Update a role | UpdateRoleDto | 200, 400, 401, 403, 404, 409, 422 |
| DELETE | `/api/v1/roles/{id}` | Delete a role | ? | 200, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/roles/{id}/users` | List a role's users | ? | 200, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/roles/{id}/diff` | Diff two roles | ? | 200, 400, 401, 403, 404, 409, 422 |
| POST | `/api/v1/roles/{id}/clone` | Clone a role | CloneRoleDto | 201, 400, 401, 403, 404, 409, 422 |
| PUT | `/api/v1/roles/{id}/permissions` | Replace a role's permissions | ReplacePermissionsDto | 200, 400, 401, 403, 404, 409, 422 |
| POST | `/api/v1/roles/{id}/permissions` | Grant one permission to a role | PermissionGrantDto | 201, 400, 401, 403, 404, 409, 422 |
| DELETE | `/api/v1/roles/{id}/permissions/{key}` | Revoke one permission from a role | ? | 200, 400, 401, 403, 404, 409, 422 |

### users

| Method | Path | Purpose | Request body schema | Documented statuses |
|---|---|---|---|---|
| GET | `/api/v1/users` | List staff users | ? | 200, 400, 401, 403, 404, 409, 422 |
| POST | `/api/v1/users` | Create a staff user | CreateUserDto | 201, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/users/{id}` | Get a user by ID | ? | 200, 400, 401, 403, 404, 409, 422 |
| PATCH | `/api/v1/users/{id}` | Update a user | UpdateUserDto | 200, 400, 401, 403, 404, 409, 422 |
| POST | `/api/v1/users/{id}/activate` | Activate a user | ? | 201, 400, 401, 403, 404, 409, 422 |
| POST | `/api/v1/users/{id}/deactivate` | Deactivate a user | ? | 201, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/users/{id}/login-history` | Get a user's login history | ? | 200, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/users/{id}/roles` | List a user's roles | ? | 200, 400, 401, 403, 404, 409, 422 |
| POST | `/api/v1/users/{id}/roles` | Assign a role to a user | AssignRoleDto | 201, 400, 401, 403, 404, 409, 422 |
| PUT | `/api/v1/users/{id}/roles` | Replace a user's roles | ReplaceRolesDto | 200, 400, 401, 403, 404, 409, 422 |
| DELETE | `/api/v1/users/{id}/roles/{roleId}` | Remove a role from a user | ? | 200, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/users/{id}/effective-permissions` | Get a user's effective permissions | ? | 200, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/users/{id}/permission-overrides` | List a user's permission overrides | ? | 200, 400, 401, 403, 404, 409, 422 |
| POST | `/api/v1/users/{id}/permission-overrides` | Set a permission override for a user | PermissionOverrideDto | 201, 400, 401, 403, 404, 409, 422 |
| DELETE | `/api/v1/users/{id}/permission-overrides/{key}` | Remove a permission override | ? | 200, 400, 401, 403, 404, 409, 422 |

### settings

| Method | Path | Purpose | Request body schema | Documented statuses |
|---|---|---|---|---|
| GET | `/api/v1/settings` | Get tenant settings | ? | 200, 400, 401, 403, 404, 409, 422 |
| PUT | `/api/v1/settings` | Update tenant settings | UpdateSettingsDto | 200, 400, 401, 403, 404, 409, 422 |

### holidays

| Method | Path | Purpose | Request body schema | Documented statuses |
|---|---|---|---|---|
| GET | `/api/v1/holidays` | List holidays | ? | 200, 400, 401, 403, 404, 409, 422 |
| POST | `/api/v1/holidays` | Create a holiday | CreateHolidayDto | 201, 400, 401, 403, 404, 409, 422 |
| DELETE | `/api/v1/holidays/{id}` | Delete a holiday | ? | 200, 400, 401, 403, 404, 409, 422 |

### branches

| Method | Path | Purpose | Request body schema | Documented statuses |
|---|---|---|---|---|
| GET | `/api/v1/branches` | List branches | ? | 200, 400, 401, 403, 404, 409, 422 |
| POST | `/api/v1/branches` | Create a branch | CreateBranchDto | 201, 400, 401, 403, 404, 409, 422 |
| PATCH | `/api/v1/branches/{id}` | Update a branch | UpdateBranchDto | 200, 400, 401, 403, 404, 409, 422 |

### children

| Method | Path | Purpose | Request body schema | Documented statuses |
|---|---|---|---|---|
| GET | `/api/v1/children` | List children | ? | 200, 400, 401, 403, 404, 409, 422 |
| POST | `/api/v1/children` | Create a child | CreateChildDto | 201, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/children/{id}` | Get a child by ID | ? | 200, 400, 401, 403, 404, 409, 422 |
| PATCH | `/api/v1/children/{id}` | Update a child | UpdateChildDto | 200, 400, 401, 403, 404, 409, 422 |
| DELETE | `/api/v1/children/{id}` | Delete a child | ? | 200, 400, 401, 403, 404, 409, 422 |
| POST | `/api/v1/children/{id}/status` | Change a child's status | ChildStatusDto | 201, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/children/{id}/history` | Get a child's status history | ? | 200, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/children/{id}/documents` | List a child's documents | ? | 200, 400, 401, 403, 404, 409, 422 |
| POST | `/api/v1/children/{id}/documents` | Add a document to a child's file | CreateChildDocumentDto | 201, 400, 401, 403, 404, 409, 422 |
| PATCH | `/api/v1/children/{id}/documents/{docId}` | Update a child's document metadata | UpdateChildDocumentDto | 200, 400, 401, 403, 404, 409, 422 |
| POST | `/api/v1/children/{id}/documents/{docId}/verify` | Verify a child's document | ? | 201, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/children/{id}/medical` | Get a child's medical record | ? | 200, 400, 401, 403, 404, 409, 422 |
| PUT | `/api/v1/children/{id}/medical` | Replace a child's medical record | UpdateMedicalDto | 200, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/children/{id}/medical/alerts` | Get a child's medical alerts | ? | 200, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/children/{id}/consents` | List a child's consents | ? | 200, 400, 401, 403, 404, 409, 422 |
| POST | `/api/v1/children/{id}/consents` | Record a consent | RecordConsentDto | 201, 400, 401, 403, 404, 409, 422 |
| POST | `/api/v1/children/{id}/consents/{consentId}/revoke` | Revoke a consent | ? | 201, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/documents/expiring` | List documents expiring soon | ? | 200, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/children/{childId}/guardians` | List a child's guardians | ? | 200, 400, 401, 403, 404, 409, 422 |
| POST | `/api/v1/children/{childId}/guardians` | Link a guardian to a child | LinkGuardianDto | 201, 400, 401, 403, 404, 409, 422 |
| PATCH | `/api/v1/children/{childId}/guardians/{guardianId}` | Update a guardian link | UpdateGuardianLinkDto | 200, 400, 401, 403, 404, 409, 422 |
| DELETE | `/api/v1/children/{childId}/guardians/{guardianId}` | Unlink a guardian from a child | ? | 200, 400, 401, 403, 404, 409, 422 |

### guardians

| Method | Path | Purpose | Request body schema | Documented statuses |
|---|---|---|---|---|
| GET | `/api/v1/guardians` | List guardians | ? | 200, 400, 401, 403, 404, 409, 422 |
| POST | `/api/v1/guardians` | Create a guardian | CreateGuardianDto | 201, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/guardians/{id}` | Get a guardian by ID | ? | 200, 400, 401, 403, 404, 409, 422 |
| PATCH | `/api/v1/guardians/{id}` | Update a guardian | UpdateGuardianDto | 200, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/guardians/{id}/children` | List a guardian's children | ? | 200, 400, 401, 403, 404, 409, 422 |

### groups

| Method | Path | Purpose | Request body schema | Documented statuses |
|---|---|---|---|---|
| GET | `/api/v1/groups` | List groups | ? | 200, 400, 401, 403, 404, 409, 422 |
| POST | `/api/v1/groups` | Create a group | CreateGroupDto | 201, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/groups/{id}` | Get a group by ID | ? | 200, 400, 401, 403, 404, 409, 422 |
| PATCH | `/api/v1/groups/{id}` | Update a group | UpdateGroupDto | 200, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/groups/{id}/children` | List a group's children | ? | 200, 400, 401, 403, 404, 409, 422 |
| POST | `/api/v1/groups/{id}/children` | Assign a child to a group | AssignChildDto | 201, 400, 401, 403, 404, 409, 422 |
| POST | `/api/v1/groups/{id}/transfer` | Transfer a child to another group | TransferChildDto | 201, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/groups/{id}/staff` | List a group's staff | ? | 200, 400, 401, 403, 404, 409, 422 |
| PUT | `/api/v1/groups/{id}/staff` | Set a group's staff | SetStaffDto | 200, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/groups/{id}/history` | Get a group's assignment history | ? | 200, 400, 401, 403, 404, 409, 422 |

### attendance

| Method | Path | Purpose | Request body schema | Documented statuses |
|---|---|---|---|---|
| GET | `/api/v1/attendance/board` | Today?s complete roster with nullable attendance for unrecorded children | ? | 200, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/attendance/today` | Get today's attendance | ? | 200, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/attendance/inside` | List children currently checked in | ? | 200, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/attendance/absent` | List absent children | ? | 200, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/attendance/not-picked-up` | List children not yet picked up | ? | 200, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/attendance/calendar` | Get a child's attendance calendar | ? | 200, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/attendance/summary` | Get attendance summary | ? | 200, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/attendance/corrections` | List attendance corrections | ? | 200, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/attendance` | List attendance records | ? | 200, 400, 401, 403, 404, 409, 422 |
| POST | `/api/v1/attendance/check-in` | Check in a child | CheckInDto | 201, 400, 401, 403, 404, 409, 422 |
| POST | `/api/v1/attendance/check-out` | Check out a child | CheckOutDto | 201, 400, 401, 403, 404, 409, 422 |
| POST | `/api/v1/attendance/status` | Set attendance status directly | SetAttendanceStatusDto | 201, 400, 401, 403, 404, 409, 422 |
| POST | `/api/v1/attendance/{id}/correct` | Correct an attendance record | CorrectAttendanceDto | 201, 400, 401, 403, 404, 409, 422 |

### notifications

| Method | Path | Purpose | Request body schema | Documented statuses |
|---|---|---|---|---|
| POST | `/api/v1/notifications/send` | Send a notification | SendNotificationDto | 201, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/notifications` | List notifications | ? | 200, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/notifications/{id}` | Get a notification by ID | ? | 200, 400, 401, 403, 404, 409, 422 |
| POST | `/api/v1/notifications/{id}/retry` | Retry a failed notification | ? | 201, 400, 401, 403, 404, 409, 422 |

### notification-templates

| Method | Path | Purpose | Request body schema | Documented statuses |
|---|---|---|---|---|
| GET | `/api/v1/notification-templates` | List notification templates | ? | 200, 400, 401, 403, 404, 409, 422 |
| PUT | `/api/v1/notification-templates/{key}` | Create or update a template | UpsertNotificationTemplateDto | 200, 400, 401, 403, 404, 409, 422 |
| POST | `/api/v1/notification-templates/{key}/preview` | Preview a template | PreviewNotificationTemplateDto | 201, 400, 401, 403, 404, 409, 422 |

### announcements

| Method | Path | Purpose | Request body schema | Documented statuses |
|---|---|---|---|---|
| GET | `/api/v1/announcements` | List announcements | ? | 200, 400, 401, 403, 404, 409, 422 |
| POST | `/api/v1/announcements` | Create an announcement | CreateAnnouncementDto | 201, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/announcements/{id}` | Get an announcement by ID | ? | 200, 400, 401, 403, 404, 409, 422 |
| DELETE | `/api/v1/announcements/{id}` | Delete an announcement | ? | 200, 400, 401, 403, 404, 409, 422 |
| POST | `/api/v1/announcements/{id}/publish` | Publish an announcement | ? | 201, 400, 401, 403, 404, 409, 422 |

### billing-rules

| Method | Path | Purpose | Request body schema | Documented statuses |
|---|---|---|---|---|
| GET | `/api/v1/billing-rules` | List billing rule versions | ? | 200, 400, 401, 403, 404, 409, 422 |
| POST | `/api/v1/billing-rules` | Publish a new billing rules version | CreateBillingRulesDto | 201, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/billing-rules/active` | Get the active billing rules | ? | 200, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/billing-rules/{id}` | Get a billing rules version by ID | ? | 200, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/billing-rules/{id}/diff` | Diff two billing rules versions | ? | 200, 400, 401, 403, 404, 409, 422 |
| POST | `/api/v1/billing-rules/simulate` | Simulate a child's charge | SimulateBillingDto | 201, 400, 401, 403, 404, 409, 422 |

### billing-runs

| Method | Path | Purpose | Request body schema | Documented statuses |
|---|---|---|---|---|
| GET | `/api/v1/billing-runs` | BillingRunsController_list | ? | 200, 400, 401, 403, 404, 409, 422 |
| POST | `/api/v1/billing-runs` | Preview a billing run | PreviewBillingRunDto | 201, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/billing-runs/{id}` | Get a billing run by ID | ? | 200, 400, 401, 403, 404, 409, 422 |
| DELETE | `/api/v1/billing-runs/{id}` | Discard a billing run | ? | 200, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/billing-runs/{id}/explain/{childId}` | Explain one child's charge within a billing run | ? | 200, 400, 401, 403, 404, 409, 422 |
| POST | `/api/v1/billing-runs/{id}/commit` | Commit a billing run | ? | 201, 400, 401, 403, 404, 409, 422 |

### charges

| Method | Path | Purpose | Request body schema | Documented statuses |
|---|---|---|---|---|
| POST | `/api/v1/charges/adjustments` | Post a debit or credit adjustment to an open period; does not refund cash | CreateAdjustmentDto | 201, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/children/{childId}/charge-ledger` | Full append-only charge history including credits and reversals | ? | 200, 400, 401, 403, 404, 409, 422 |
| POST | `/api/v1/children/{childId}/recalculate-billing` | ChargesController_recalculate | PreviewBillingRunDto | 201, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/charges` | List charges | ? | 200, 400, 401, 403, 404, 409, 422 |
| POST | `/api/v1/charges` | Create a manual charge | CreateManualChargeDto | 201, 400, 401, 403, 404, 409, 422 |
| POST | `/api/v1/charges/{id}/reverse` | Reverse a charge | ReverseChargeDto | 201, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/children/{childId}/charges` | List a child's charges | ? | 200, 400, 401, 403, 404, 409, 422 |

### tariffs

| Method | Path | Purpose | Request body schema | Documented statuses |
|---|---|---|---|---|
| GET | `/api/v1/tariffs` | List tariffs | ? | 200, 400, 401, 403, 404, 409, 422 |
| POST | `/api/v1/tariffs` | Create a tariff | CreateTariffDto | 201, 400, 401, 403, 404, 409, 422 |
| PATCH | `/api/v1/tariffs/{id}` | Update a tariff | UpdateTariffDto | 200, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/children/{childId}/tariffs` | List a child's assigned tariffs | ? | 200, 400, 401, 403, 404, 409, 422 |
| POST | `/api/v1/children/{childId}/tariffs` | Assign a tariff to a child | AssignChildTariffDto | 201, 400, 401, 403, 404, 409, 422 |
| PATCH | `/api/v1/children/{childId}/tariffs/{assignmentId}` | TariffsController_end | EndChildTariffDto | 200, 400, 401, 403, 404, 409, 422 |

### discounts

| Method | Path | Purpose | Request body schema | Documented statuses |
|---|---|---|---|---|
| GET | `/api/v1/children/{childId}/discounts` | List a child's discounts | ? | 200, 400, 401, 403, 404, 409, 422 |
| POST | `/api/v1/children/{childId}/discounts` | Grant a discount to a child | CreateDiscountDto | 201, 400, 401, 403, 404, 409, 422 |
| DELETE | `/api/v1/children/{childId}/discounts/{discountId}` | Revoke a discount | ? | 200, 400, 401, 403, 404, 409, 422 |

### periods

| Method | Path | Purpose | Request body schema | Documented statuses |
|---|---|---|---|---|
| GET | `/api/v1/periods` | List billing periods | ? | 200, 400, 401, 403, 404, 409, 422 |
| POST | `/api/v1/periods` | Create a billing period | CreatePeriodDto | 201, 400, 401, 403, 404, 409, 422 |
| POST | `/api/v1/periods/{id}/close` | Close a billing period | ? | 201, 400, 401, 403, 404, 409, 422 |
| POST | `/api/v1/periods/{id}/reopen` | Reopen a closed billing period | ReopenPeriodDto | 201, 400, 401, 403, 404, 409, 422 |

### pickup

| Method | Path | Purpose | Request body schema | Documented statuses |
|---|---|---|---|---|
| GET | `/api/v1/children/{childId}/pickup-persons` | List a child's authorized pickup persons | ? | 200, 400, 401, 403, 404, 409, 422 |
| POST | `/api/v1/children/{childId}/pickup-persons` | Add an authorized pickup person | CreatePickupPersonDto | 201, 400, 401, 403, 404, 409, 422 |
| PATCH | `/api/v1/pickup-persons/{id}` | Update a pickup person | UpdatePickupPersonDto | 200, 400, 401, 403, 404, 409, 422 |
| DELETE | `/api/v1/pickup-persons/{id}` | Remove a pickup person | ? | 200, 400, 401, 403, 404, 409, 422 |
| POST | `/api/v1/pickup-persons/{id}/revoke` | Revoke a pickup person | RevokePickupPersonDto | 201, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/pickup-permissions/active` | List active pickup permissions | ? | 200, 400, 401, 403, 404, 409, 422 |
| POST | `/api/v1/pickup-permissions/temporary` | Grant a temporary pickup permission | TemporaryPermissionDto | 201, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/children/{childId}/pickup-history` | Get a child's pickup history | ? | 200, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/pickup/verify` | Verify a pickup person at the door | ? | 200, 400, 401, 403, 404, 409, 422 |

### payments

| Method | Path | Purpose | Request body schema | Documented statuses |
|---|---|---|---|---|
| GET | `/api/v1/payments` | List payments | ? | 200, 400, 401, 403, 404, 409, 422 |
| POST | `/api/v1/payments` | Record a payment | CreatePaymentDto | 201, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/payments/{id}` | Get a payment by ID | ? | 200, 400, 401, 403, 404, 409, 422 |
| POST | `/api/v1/payments/{id}/cancel` | Cancel a payment | CancelPaymentDto | 201, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/payments/{id}/receipt` | Get a payment receipt | ? | 200, 400, 401, 403, 404, 409, 422 |

### debts

| Method | Path | Purpose | Request body schema | Documented statuses |
|---|---|---|---|---|
| GET | `/api/v1/debts/summary` | Get a debt summary | ? | 200, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/debts/{childId}` | Get a child's debt | ? | 200, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/debts` | List debts | ? | 200, 400, 401, 403, 404, 409, 422 |

### expenses

| Method | Path | Purpose | Request body schema | Documented statuses |
|---|---|---|---|---|
| GET | `/api/v1/expenses/summary` | Get an expense summary for a year | ? | 200, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/expenses` | List expenses | ? | 200, 400, 401, 403, 404, 409, 422 |
| POST | `/api/v1/expenses` | Record an expense | CreateExpenseDto | 201, 400, 401, 403, 404, 409, 422 |
| PATCH | `/api/v1/expenses/{id}` | Update an expense | UpdateExpenseDto | 200, 400, 401, 403, 404, 409, 422 |
| POST | `/api/v1/expenses/{id}/pay` | Mark an expense as paid | PayExpenseDto | 201, 400, 401, 403, 404, 409, 422 |

### files

| Method | Path | Purpose | Request body schema | Documented statuses |
|---|---|---|---|---|
| POST | `/api/v1/files` | Upload a file | Inline | 201, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/files/{id}` | Download a file | ? | 200, 400, 401, 403, 404, 409, 422 |
| DELETE | `/api/v1/files/{id}` | Delete a file | ? | 200, 400, 401, 403, 404, 409, 422 |

### reports

| Method | Path | Purpose | Request body schema | Documented statuses |
|---|---|---|---|---|
| GET | `/api/v1/reports/attendance/daily` | Daily attendance report | ? | 200, 202, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/reports/attendance/monthly` | Monthly attendance report | ? | 200, 202, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/reports/attendance/corrections` | Attendance corrections report | ? | 200, 202, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/reports/children/active` | Active children report | ? | 200, 202, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/reports/children/enrollments` | Enrollments report | ? | 200, 202, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/reports/children/documents-expiring` | Documents-expiring report | ? | 200, 202, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/reports/children/medical-alerts` | Medical alerts report | ? | 200, 202, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/reports/finance/charges` | Charges report | ? | 200, 202, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/reports/finance/payments` | Payments report | ? | 200, 202, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/reports/finance/debts` | Debts report | ? | 200, 202, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/reports/finance/discounts` | Discounts report | ? | 200, 202, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/reports/finance/cancellations` | Cancellations report | ? | 200, 202, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/reports/expenses/monthly` | Monthly expenses report | ? | 200, 202, 400, 401, 403, 404, 409, 422 |

### exports

| Method | Path | Purpose | Request body schema | Documented statuses |
|---|---|---|---|---|
| GET | `/api/v1/exports/{id}` | Get an export job by ID | ? | 200, 400, 401, 403, 404, 409, 422 |

### dashboard

| Method | Path | Purpose | Request body schema | Documented statuses |
|---|---|---|---|---|
| GET | `/api/v1/dashboard/director` | Director's dashboard | ? | 200, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/dashboard/accountant` | Accountant's dashboard | ? | 200, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/dashboard/reception` | Reception's dashboard | ? | 200, 400, 401, 403, 404, 409, 422 |

### imports

| Method | Path | Purpose | Request body schema | Documented statuses |
|---|---|---|---|---|
| GET | `/api/v1/imports/templates/{entity}` | Download an import template | ? | 200, 400, 401, 403, 404, 409, 422 |
| POST | `/api/v1/imports/validate` | Validate an import file | Inline | 201, 400, 401, 403, 404, 409, 422 |
| POST | `/api/v1/imports/commit` | Commit a validated import | CommitImportDto | 201, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/imports/{id}` | Get an import job by ID | ? | 200, 400, 401, 403, 404, 409, 422 |

### landing

| Method | Path | Purpose | Request body schema | Documented statuses |
|---|---|---|---|---|
| GET | `/api/v1/landing` | Get the landing page draft | ? | 200, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/landing/block-types` | List the available block types and their content schemas | ? | 200, 400, 401, 403, 404, 409, 422 |
| POST | `/api/v1/landing/blocks` | Add a block to the landing page | CreateBlockDto | 201, 400, 401, 403, 404, 409, 422 |
| PUT | `/api/v1/landing/blocks/reorder` | Reorder blocks | ReorderBlocksDto | 200, 400, 401, 403, 404, 409, 422 |
| PUT | `/api/v1/landing/blocks/{id}` | Update a block | UpdateBlockDto | 200, 400, 401, 403, 404, 409, 422 |
| DELETE | `/api/v1/landing/blocks/{id}` | Delete a block | ? | 200, 400, 401, 403, 404, 409, 422 |
| PUT | `/api/v1/landing/seo` | Update page SEO / social preview metadata | UpdateSeoDto | 200, 400, 401, 403, 404, 409, 422 |
| POST | `/api/v1/landing/publish` | Publish the draft | PublishDto | 201, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/landing/versions` | List published versions | ? | 200, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/landing/versions/{version}` | Get one published version, including its full snapshot | ? | 200, 400, 401, 403, 404, 409, 422 |
| POST | `/api/v1/landing/versions/{version}/restore` | Restore a previous version | ? | 201, 400, 401, 403, 404, 409, 422 |

### public

| Method | Path | Purpose | Request body schema | Documented statuses |
|---|---|---|---|---|
| GET | `/api/v1/public/landing` | Get the published landing page for the default tenant (public, no auth) | ? | 200, 304, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/public/landing/{tenantCode}` | Get the published landing page (public, no auth) | ? | 200, 304, 400, 401, 403, 404, 409, 422 |
| GET | `/api/v1/public/landing/{tenantCode}/media/{fileId}` | Get an image used by the published landing page (public, no auth) | ? | 200, 400, 401, 403, 404, 409, 422 |

<!-- API_INVENTORY_END -->
