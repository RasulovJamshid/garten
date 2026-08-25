# Frontend Integration Guide — Kindergarten Management System

Everything a frontend developer (or the `frontend-developer` agent) needs to build a UI
against the Stage 1 backend API. The backend is the single source of truth; this guide
summarizes the parts of it that the client must honor exactly.

> **This guide covers the cross-cutting contract** (auth, errors, money, dates, pagination,
> idempotency, RBAC mechanics). For **per-module endpoints, response structures, business rules,
> and screen requirements**, see the companion [Functional & API Spec](frontend-functional-spec.md).

> **This guide is self-contained.** You do not need access to the backend source (`src/`,
> `prisma/`) — everything the client must honor is written out here. Your only external input is
> **`openapi.json`** (the API schema at the backend repo root, also served live at `/docs`). Copy
> that file into the frontend project and generate types from it (§3). The backend spec docs
> (`kindergarten-docs/`) are the authoritative origin behind this guide but are **optional
> reference** — if you don't have the backend repo, this guide plus `openapi.json` is enough.

---

## 0. Recommended stack

| Concern | Choice | Why |
|---|---|---|
| Framework | **React 18 + TypeScript** | Matches the TS backend; sharable types. |
| Build/dev | **Vite** | Fast HMR, simple env handling. |
| Server state | **TanStack Query** (`@tanstack/react-query`) | Caching, retries, invalidation — a REST API's natural fit. |
| Typed client | **`openapi-typescript`** (types) + a thin `fetch` wrapper, or **`orval`** for full hooks | Generated from `openapi.json`; never hand-write request/response types. |
| Routing | **React Router** | |
| Forms/validation | **React Hook Form** + **Zod** | Zod already used server-side; mirror rules client-side. |
| UI components | **shadcn/ui** (Radix + Tailwind) or **MUI** | Pick one and stay consistent. |
| i18n | **react-i18next** | Required — see §5, errors and labels localize on the client (`ru` default, `uz`). |

These are recommendations, not hard requirements — but the **contract rules in §2–§9 are not
negotiable** regardless of stack.

---

## 1. Base URL, environment, CORS

- Local API: `http://localhost:3010/api/v1` (`PORT` + `API_PREFIX` from the backend `.env`).
- Every path in this guide is **relative to that prefix** — e.g. "`POST /auth/login`" means
  `POST http://localhost:3010/api/v1/auth/login`.
- Swagger UI: `http://localhost:3010/docs`. Regenerated on every backend boot.

**CORS is an explicit allow-list with credentials.** The backend sets
`Access-Control-Allow-Credentials: true` and only echoes origins listed in `CORS_ORIGINS`
(defaults to `APP_URL`). So:

- Your dev origin (e.g. `http://localhost:5173`) **must be added to `CORS_ORIGINS`** in the
  backend `.env`, or the browser blocks authenticated requests.
- Every request that relies on the refresh cookie must send `credentials: 'include'`
  (`fetch`) / `withCredentials: true` (axios). Wildcard origins will never work with
  credentials — that's intentional.

```ts
// src/api/client.ts
const BASE_URL = import.meta.env.VITE_API_BASE_URL; // http://localhost:3010/api/v1
```

---

## 2. Auth flow

Two tokens, two lifetimes:

| Token | Where it lives | TTL | Client responsibility |
|---|---|---|---|
| **Access token** (JWT) | In memory (JS variable / React state) | 15 min | Send as `Authorization: Bearer <token>` on every request. |
| **Refresh token** (opaque, rotating) | **httpOnly cookie `kg_refresh`**, set by the server | 30 days | Nothing — the browser sends it automatically. Never readable from JS. |

Do **not** store the access token in `localStorage` if you can avoid it — keep it in memory and
re-acquire via refresh on load. The refresh cookie is `httpOnly`, `sameSite=lax`, `secure` in
production, and **path-scoped to `/api/v1/auth`**, so it is only sent to auth endpoints.

### Endpoints

```
POST /auth/login            { login, password }        login = phone | email | username
  -> 200 { accessToken, user }   + Set-Cookie: kg_refresh
POST /auth/refresh          (sends kg_refresh cookie, no body)
  -> 200 { accessToken }         + rotated Set-Cookie: kg_refresh
POST /auth/logout           (sends kg_refresh cookie)
  -> 200 { success: true }       + clears cookie
GET  /auth/me               (Bearer)
  -> 200 { user, branchIds, roles[], permissions, permissionsVersion }
POST /auth/change-password  (Bearer) { currentPassword, newPassword }
POST /auth/forgot-password  { login }
POST /auth/reset-password   { token, newPassword }
```

- `POST /auth/login` is rate-limited to **5/min/IP** (so are forgot/reset). Surface a friendly
  "too many attempts" message on `429`.
- Repeated bad passwords lock the account: `423 ACCOUNT_LOCKED` after
  `LOGIN_MAX_ATTEMPTS` (default 5) for `LOGIN_LOCKOUT_MINUTES` (default 15).

### The refresh loop

Wrap `fetch` so that a `401` with code `TOKEN_EXPIRED` triggers exactly one
`POST /auth/refresh`, then replays the original request with the new access token. If refresh
itself fails, clear in-memory auth and route to `/login`.

```ts
async function authedFetch(path: string, init: RequestInit = {}) {
  let res = await rawFetch(path, init);
  if (res.status === 401 && (await peekCode(res)) === 'TOKEN_EXPIRED') {
    const ok = await refreshAccessToken();      // POST /auth/refresh, credentials: 'include'
    if (ok) res = await rawFetch(path, init);   // replay once with new Bearer
    else redirectToLogin();
  }
  return res;
}
```

Guard against refresh stampedes: if several requests 401 at once, share a single in-flight
refresh promise rather than firing N refreshes.

### On app load

Call `POST /auth/refresh` once at startup. If it returns an access token, you're logged in;
fetch `GET /auth/me` to hydrate the user, roles, and permissions. If it fails, show the login
screen.

---

## 3. The typed client — generate, don't hand-write

`openapi.json` is committed and **CI fails if it drifts from the code**, so it is always
current. **Copy it into the frontend project** (e.g. `src/api/openapi.json`, refreshed whenever the
backend changes) and generate types from it — it is your only required backend artifact:

```bash
npx openapi-typescript ./src/api/openapi.json -o src/api/schema.d.ts
# add an npm script: "gen:api": "openapi-typescript ./src/api/openapi.json -o src/api/schema.d.ts"
```

Re-run `gen:api` whenever you refresh `openapi.json`. Never edit `schema.d.ts` by hand and never
duplicate DTO shapes in your own types — import them from the generated file.

---

## 4. Error contract

Every error — from any endpoint — has this envelope:

```json
{
  "error": {
    "code": "PERIOD_CLOSED",
    "message": "Accounting period 2026-06 is closed",
    "details": { "year": 2026, "month": 6 },
    "traceId": "01J8..."
  }
}
```

- **`code` is the contract. Localize from `code`.** `message` is English debug text only — do
  **not** show it to end users; map `code` → a translated string in your i18n catalog.
- `details` is optional structured context (which field, which period, etc.) — use it to enrich
  the message or highlight a form field.
- `traceId` is for support/debugging — log it, optionally show it in a "report a problem" affordance.

### Full error-code registry

Build your `code → i18n key` map from this complete list so no code ever renders as a raw string.
Group the client action by category.

**Auth & session**

| Code | HTTP | Client action |
|---|---|---|
| `UNAUTHENTICATED` | 401 | Route to login. |
| `TOKEN_EXPIRED` | 401 | Trigger the refresh loop (§2), then replay. |
| `ACCOUNT_LOCKED` | 423 | Show lockout message with retry time (default 15 min). |
| `ACCOUNT_INACTIVE` | 403 | Account deactivated — force logout. |

**Permissions & RBAC**

| Code | HTTP | Client action |
|---|---|---|
| `FORBIDDEN` | 403 | Lacks permission — hide/disable the action (§9) and show a "not allowed" toast. |
| `OUT_OF_SCOPE` | 403 | Record outside the user's branch/group scope. Treat like not-found in the UI. |
| `ROLE_PROTECTED` | 403 | Owner role can't be modified/deleted — block the action. |
| `ROLE_IN_USE` | 409 | Users still hold this role; prompt to reassign first. |
| `LAST_OWNER` | 409 | Can't remove the final active Owner — block. |
| `SELF_LOCKOUT` | 403 | Can't revoke `role:manage`/`user:manage` from yourself — block. |
| `PRIVILEGE_ESCALATION` | 403 | Can't grant a permission you don't hold — hide those options. |
| `SENSITIVE_PERMISSION` | 403 | Requires `role:manage:sensitive` — gate the control. |
| `UNKNOWN_PERMISSION` | 400 | Bug — you sent a permission key not in the catalog. Log `traceId`. |
| `INVALID_SCOPE` | 400 | Bug — scope not allowed for that permission. Log `traceId`. |

**Validation & resource state**

| Code | HTTP | Client action |
|---|---|---|
| `VALIDATION_FAILED` | 422 (or 400) | Map `details` to field-level form errors. |
| `NOT_FOUND` | 404 | Empty/not-found state. |
| `DUPLICATE` | 409 | Record/field already exists — flag the conflicting field from `details`. |
| `CONFLICT` | 409 | Refetch and let the user retry. |

**Financial / domain (appear as modules land)**

| Code | HTTP | Client action |
|---|---|---|
| `PERIOD_CLOSED` | 409 | Accounting period closed — block the financial mutation. |
| `BILLING_ALREADY_COMMITTED` | 409 | Billing run already committed — refresh state. |
| `ALREADY_CHECKED_IN` | 409 | Child already checked in — refresh attendance. |
| `NOT_CHECKED_IN` | 409 | No open check-in to check out — refresh attendance. |
| `CAPACITY_EXCEEDED` | 409 | Group at capacity — block enrollment/transfer. |
| `PERMISSION_EXPIRED` | 403 | Temporary pickup permission expired — reverify. |
| `INSUFFICIENT_ALLOCATION` | 409 | Payment exceeds outstanding charges — adjust amount. |

**Transport / infrastructure (fallbacks by HTTP status)**

| Code | HTTP | Client action |
|---|---|---|
| `FILE_TOO_LARGE` | 413 | Upload exceeds `MAX_UPLOAD_MB` (default 20) — reject before/after. |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | MIME not in the allow-list (jpeg/png/webp/pdf) — reject. |
| `RATE_LIMITED` | 429 | Back off; show "try again shortly". |
| `INTERNAL_ERROR` | 500 | Generic error toast + `traceId`. |

> **Unknown codes:** new domain modules may introduce codes not listed here. Handle any
> unrecognized `code` by falling back to a generic message keyed off the HTTP status, and always
> log the `traceId`. Keep the map data-driven so adding a new code is a one-line i18n change.

---

## 5. Money — integer tiyin, serialized as strings

**This is the single most important rule in the API. Getting it wrong loses money.**

- All amounts are **integer tiyin** (1 som = 100 tiyin), sent over JSON as **strings** because
  JSON has no int64: `{ "amountTiyin": "150000000", "currency": "UZS" }` → 1,500,000.00 som.
- **Never** parse money into a JS `number` and never use floats for arithmetic — use `BigInt`
  (or a decimal library) for any math, and only convert to a formatted string for display.
- **Never** send formatted strings or floats back — send integer tiyin as a string.

```ts
// display: tiyin string -> localized som
export function formatMoney(amountTiyin: string, currency = 'UZS', locale = 'ru-UZ') {
  const tiyin = BigInt(amountTiyin);
  const som = Number(tiyin / 100n);
  const frac = Number(tiyin % 100n);
  return new Intl.NumberFormat(locale, {
    style: 'currency', currency, minimumFractionDigits: 2,
  }).format(som + frac / 100);
}

// input: user types "15000.50" som -> tiyin string for the API
export function toTiyin(somInput: string): string {
  const [whole, frac = ''] = somInput.replace(/\s/g, '').split('.');
  const tiyin = BigInt(whole || '0') * 100n + BigInt((frac + '00').slice(0, 2));
  return tiyin.toString();
}
```

For large sums the `Number` conversion above can lose precision — prefer a small decimal
formatter over `BigInt` directly if you display totals above ~90 billion tiyin.

---

## 6. Dates & timezone

- **Timestamps:** ISO 8601 **with offset** — `2026-07-29T08:14:00+05:00`. Parse as-is.
- **Calendar dates:** `YYYY-MM-DD`, always **Asia/Tashkent** local (attendance days, etc.).
  Do not convert these through the browser's timezone — treat them as plain local dates or the
  day can shift.
- **Billing periods:** `{ "year": 2026, "month": 7 }` (month is 1-based).
- The system default timezone is `Asia/Tashkent` and default language is `ru`.

---

## 7. Lists — pagination, sorting, search, filters

All list endpoints share one shape:

```
GET /children?page=1&limit=50&sort=lastName:asc&q=alisher&status=active

{
  "data": [ ... ],
  "meta": { "page": 1, "limit": 50, "total": 342, "pages": 7 }
}
```

- `page` is 1-based. `limit` default **50**, max **200**.
- `sort` is `field:asc|desc`.
- `q` is free-text search where supported; other query params are entity-specific filters
  (e.g. `groupId`, `status`, `hasDebt`, `hasMedicalAlert` on `/children`).
- Drive tables from `meta` (`total`, `pages`) rather than counting `data.length`.

Pair this with TanStack Query using `[resource, params]` query keys so filters/pagination cache
and invalidate cleanly.

---

## 8. Idempotency (financial mutations)

These endpoints **require** an `Idempotency-Key: <uuid>` header:

- `POST /payments`
- `POST /billing-runs/:id/commit`
- `POST /notifications/send`

Generate a fresh UUID (`crypto.randomUUID()`) when the user opens the form / initiates the
action, reuse it across retries, and only mint a new one for a genuinely new action. Replays of
the same key return the original response instead of creating a duplicate — this is what makes a
double-click or a network retry safe. Do not reuse a key across different payloads.

---

## 9. RBAC — gate the UI on permissions, but never trust the UI

`GET /auth/me` returns:

```jsonc
{
  "user": { "id": "...", "fullName": "...", "phone": "...", "email": "...", "username": "...", "language": "ru" },
  "branchIds": ["..."],
  "roles": [ { "id": "...", "code": "owner", "nameUz": "...", "nameRu": "..." } ],
  "permissions": { /* granted permission keys + scopes for this user */ },
  "permissionsVersion": 7
}
```

- Use `permissions` to **show/hide/disable** actions (buttons, menu items, routes). Permission
  keys look like `child:read`, `payment:create`, `role:manage`, etc.
- The server enforces every permission independently (§2 "5 checks"). The UI gate is UX only —
  a hidden button is not security. Always expect and handle `403 FORBIDDEN` / `403 OUT_OF_SCOPE`
  even for actions you rendered.
- **Scopes matter:** a permission may be granted with a scope of `all` / `branch` / `own_group`
  / `today` / `self`. The server applies the scope filter automatically; your list just receives
  the already-scoped rows. Don't try to widen a query the user isn't scoped for.
- **`permissionsVersion`** is a cache-buster: an admin can change a role's grants and it takes
  effect on the user's next request with no re-login. Re-fetch `/auth/me` (and consider
  invalidating permission-dependent UI) when you observe the version has advanced — e.g. compare
  it periodically, or refetch `/auth/me` after any role/permission mutation.

---

## 10. Suggested project structure

```
src/
  api/
    client.ts        # fetch wrapper: base URL, Bearer, refresh loop, error envelope parsing
    schema.d.ts      # generated from openapi.json — do not edit
    endpoints/       # thin per-resource functions returning typed data
  auth/
    AuthProvider.tsx # in-memory access token, me(), refresh-on-load
    usePermission.ts # (key) => boolean, from /auth/me permissions
  lib/
    money.ts         # formatMoney / toTiyin (§5)
    dates.ts         # Tashkent-safe date helpers (§6)
    errors.ts        # code -> i18n key map (§4)
  features/          # one folder per domain: children, guardians, groups, attendance,
                     # payments, billing, debts, notifications, reports, expenses, ...
  i18n/              # ru (default) + uz catalogs, including error-code strings
```

**Cross-cutting rules to encode once and reuse everywhere:** the refresh loop, the error-code →
message map, money formatting, Tashkent date handling, permission gating, and idempotency-key
generation. Every feature should consume those helpers rather than re-implementing them.
