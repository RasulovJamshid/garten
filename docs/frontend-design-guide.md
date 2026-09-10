# Frontend Design Guide — Kindergarten Management System

**How the app should look, feel and flow.** The other two docs answer *what* and *with which
endpoint*; this one answers *what the user sees, in what order, and why*.

| Doc | Owns |
|---|---|
| [`frontend-integration-guide.md`](frontend-integration-guide.md) | the wire contract — auth, errors, money, dates, pagination, idempotency, RBAC mechanics |
| [`frontend-functional-spec.md`](frontend-functional-spec.md) | per-module endpoints, business rules, permissions |
| **this doc** | personas, design foundations, navigation, cross-cutting flows, screen-by-screen design |
| [`frontend-landing-page.md`](frontend-landing-page.md) | the public website module in full depth |

Nothing here overrides the contract. Where a design idea and the API disagree, the API wins and the
design changes.

**Contents**

1. [Who uses this, and where they are standing](#1-who-uses-this-and-where-they-are-standing)
2. [Design foundations](#2-design-foundations)
3. [App shell & navigation](#3-app-shell--navigation)
4. [Cross-cutting patterns](#4-cross-cutting-patterns)
5. [Screens — daily operations](#5-screens--daily-operations)
6. [Screens — records](#6-screens--records)
7. [Screens — finance](#7-screens--finance)
8. [Screens — communication](#8-screens--communication)
9. [Screens — insight](#9-screens--insight)
10. [Screens — administration](#10-screens--administration)
11. [Build order](#11-build-order)
12. [Acceptance checklist](#12-acceptance-checklist)

---

## 1. Who uses this, and where they are standing

Most UI mistakes in this product will come from designing every screen for the same imaginary user
at a desk. The seven roles work in genuinely different physical situations, and that — more than
taste — should drive layout, density and touch-target size.

| Role | Where they are | Device | Session shape | What kills them |
|---|---|---|---|---|
| **Reception** | standing at the front door, 07:30–09:00 and 17:00–19:00 | tablet or desktop, often one-handed | 40 children in 90 min, a parent waiting at every action | anything needing typing, scrolling to find a child, a modal that steals focus |
| **Teacher** | in the classroom with children | phone or tablet | seconds at a time, interrupted | small targets, deep navigation, dense tables |
| **Nurse** | office, sometimes urgent | desktop | short, precise | medical data buried under tabs |
| **Accountant** | desk, door closed | desktop, keyboard-heavy | hours, focused | anything irreversible without confirmation; losing form state; ambiguous numbers |
| **Administrator** | office | desktop | long data-entry sessions | duplicate-entry traps, forms that lose work |
| **Director** | walking, meetings | phone + desktop | glances, then drill-downs | dashboards that need interpretation |
| **Owner** | anywhere, rarely | anything | occasional, high-stakes | not being able to find the audit trail |

Three consequences worth stating up front:

1. **Two densities, not one.** Reception and teacher screens are *floor* density: ≥44px targets,
   large type, few columns, thumb-reachable actions. Accountant and admin screens are *desk*
   density: compact rows, many columns, keyboard-first. Same design system, one density token.
2. **The rush hour is the real performance test.** The attendance board is used by one person for
   90 minutes straight while people wait. Every interaction there should be one tap and optimistic.
3. **Finance is the opposite.** Nothing there should be fast. Confirmations, previews, and visible
   reversibility beat speed every time.

**Never gate UI on role names.** Gate on permission keys from `/auth/me`; operators create custom
roles and the seven above are just seeded defaults (functional spec §A1).

---

## 2. Design foundations

Use shadcn/ui or MUI as the component base (integration guide §0). This section is about the
decisions that base doesn't make for you.

### 2.1 Color and semantics

Pick one neutral ramp and one brand accent, then define **semantic tokens** and never use a raw
color in a feature:

| Token | Meaning | Used by |
|---|---|---|
| `success` | present, paid, active, allowed, delivered | attendance, payments, pickup verify |
| `warning` | due soon, expiring, partially paid, pending | documents, debts, notifications |
| `danger` | overdue, blocked, revoked, failed, reversed | debts, pickup, notifications, cancellations |
| `info` | scheduled, queued, preview, draft | billing preview, announcements, imports |
| `muted` | inactive, archived, withdrawn, closed | children, periods, users |

**The same state must look the same everywhere.** A child who is `active`, a payment that is
`completed`, and a pickup that is `allowed` all use `success`. Build the badge component once, feed
it a status, and never restyle it per screen.

Do **not** rely on color alone — an icon or a word accompanies every status (colorblindness, and
also glare on a tablet at the front door).

### 2.2 Status vocabulary

Every status in the API, mapped once. Put this in one `statusMeta` map and import it everywhere.

| Domain | Values | Treatment |
|---|---|---|
| Child | `applicant` · `active` · `temporarily_absent` · `suspended` · `graduated` · `withdrawn` · `archived` | info · success · warning · danger · muted · muted · muted |
| Attendance | present / checked-in · absent · sick · vacation · excused · not picked up | success · muted · warning · info · info · danger |
| Payment | recorded · cancelled (reversal) | success · danger (struck-through) |
| Charge | unpaid · partially paid · paid · reversed | warning · warning · success · muted+struck |
| Period | open · closed | success · muted (lock icon) |
| Debt ageing | not overdue · 1–7 d · 8–30 d · 30+ d | muted · warning · warning-strong · danger |
| Notification | queued · sent · failed | info · success · danger |
| Expense | unpaid · paid · overdue | warning · success · danger |
| Import job | validating · valid · committing · done · failed | info · success · info · success · danger |
| Billing run | preview · committed · discarded | info · success · muted |
| User | active · deactivated | success · muted |

### 2.3 Typography and numbers

- One family with **complete Cyrillic and Latin** coverage — Inter, Manrope, Golos Text, Noto Sans.
  Many otherwise-good faces silently fall back for Cyrillic and the app looks broken in Russian.
- Base 14px for desk density, 16px for floor density. Never below 12px, including table captions.
- **Money and any tabular number uses `font-variant-numeric: tabular-nums`,** right-aligned, in a
  monospaced-digit style. Columns of som that don't line up are unreadable and look untrustworthy.
- Test every label in **ru and uz**. Uzbek Latin runs noticeably longer; buttons and table headers
  that fit in Russian will wrap. Design with the longer string.

### 2.4 Money display

The single most important formatting rule in the product (integration guide §5):

- Always through `formatMoney(tiyin)`. Never a raw number, never a float, never `parseInt`.
- **Right-align** in tables. Show the currency once in the column header, not on every row.
- Negative/reversal amounts: parentheses or a leading minus **and** `danger` color **and**
  strike-through on the original row. Reversals are common in this system — make them unmistakable.
- Inputs take **som**, convert with `toTiyin` on submit. Show the currency suffix inside the field.
  Never let a user type tiyin.
- Totals in a footer row, visually separated, same alignment.

### 2.5 Dates and time

- Calendar dates (`YYYY-MM-DD`) are **Asia/Tashkent local** — never pass them through the browser's
  timezone or the day shifts (integration guide §6).
- Display dates as `dd.MM.yyyy` (ru convention), times as `HH:mm` 24-hour.
- Relative time ("2 hours ago") only for recency-sensitive surfaces: audit, notification log,
  version history. Everywhere else, absolute.
- Billing periods are `{year, month}` with **1-based month**. Display as `Июль 2026`.

### 2.6 Density, spacing, shape

| Token | Desk | Floor |
|---|---|---|
| Row height | 40px | 64px |
| Control height | 32px | 48px |
| Min touch target | 32px | **44px** |
| Base spacing unit | 4px | 8px |
| Font size base | 14px | 16px |

Radii 8px (controls) / 12px (cards). One elevation for cards, one for popovers, one for modals —
three total. Resist more.

### 2.7 Forms

- **Labels above fields**, always. Placeholder text is not a label.
- Required marked with `*`; optional fields are the ones that need no marking.
- **Validate on blur, re-validate on change once a field has errored.** Never validate on every
  keystroke of a pristine field.
- Mirror server rules with Zod so the common cases never round-trip, but **always** map server
  `422 details[].path` back onto fields — the server is the authority.
- Submit disabled only while in flight, never because the form is "incomplete" — show the errors
  instead, so the user learns what is missing.
- **Long forms autosave or warn.** The children profile and the billing rules editor are long
  enough that losing them is a real support ticket.
- One column. Two columns only for genuinely paired fields (from/to dates, first/last name).

### 2.8 Tables

One reusable table component driven by `meta` (integration guide §7). It owns:

- server-side pagination, sort (`field:asc`), free-text `q`, and entity filters in the URL query
  string — **filters must survive a refresh and be shareable as a link**;
- sticky header, sticky first column on narrow screens;
- row actions in a trailing menu; the single most common action promoted to a visible button;
- empty state distinguishing "no data yet" from "no results for these filters" (the second one
  needs a **Clear filters** button — this is a real usability trap on the children directory);
- loading as skeleton rows, not a spinner that collapses the layout;
- `limit` default 50, max 200.

### 2.9 Feedback: toast vs inline vs dialog

| Situation | Treatment |
|---|---|
| Field-level validation | inline, under the field |
| Failed save the user can retry | inline, next to the action, with the retry |
| Succeeded background action (notification queued, export started) | toast |
| Succeeded routine save | **no toast** — show state change instead (the row updates, the chip flips) |
| Destructive or irreversible | confirmation dialog, typed below |
| Server error 5xx | error panel with `traceId` in small text — support will ask for it |

Routine-success toasts are the most common noise in admin apps. Reserve them for things that
happen *elsewhere* (a queue, a background job) where there is nothing on screen to change.

### 2.10 Confirmation tiers

The API marks certain permissions `sensitive: true`. Mirror that in three tiers:

| Tier | When | UI |
|---|---|---|
| **1 — Routine** | reversible, low blast radius (hide a section, edit a note) | no confirmation |
| **2 — Destructive** | data disappears from a view but is recoverable (soft-delete a child, discard a billing preview, delete a role) | dialog naming the object and the consequence |
| **3 — Sensitive** | `sensitive: true` permissions: cancel a payment, reverse a charge, reopen a period, grant a role permission, override a permission, force past capacity | dialog **+ a required reason** (stored in the audit log) **+ a summary of exactly what will change**. Consider requiring the user to type the object's name for period reopen. |

Tier 3 dialogs should state that the action is audited. That is not a threat, it is a reassurance:
in a kindergarten's finances, the audit trail is what makes reversals safe.

### 2.11 Accessibility baseline

Contrast ≥ 4.5:1; visible focus ring on every interactive element; full keyboard operation of tables
and dialogs (this app will be driven by keyboard by the accountant); `aria-live` on the attendance
board so screen readers announce check-ins; forms with real `<label for>`; no information conveyed
by color alone; works at 200% zoom.

---

## 3. App shell & navigation

### 3.1 Structure

Group navigation **by job, not by API module**. Nobody thinks "I need the attendance module"; they
think "who is here today".

```
┌──────────────────┬──────────────────────────────────────────────────────────┐
│  🏫 Sunshine     │  [🔍 Search children, guardians, payments…]   RU ▾  👤  │
│  Main branch  ▾  ├──────────────────────────────────────────────────────────┤
│                  │                                                          │
│  ▸ Today         │                                                          │
│    Attendance    │                                                          │
│    Pickup        │                      page content                        │
│                  │                                                          │
│  ▸ People        │                                                          │
│    Children      │                                                          │
│    Guardians     │                                                          │
│    Groups        │                                                          │
│                  │                                                          │
│  ▸ Finance       │                                                          │
│    Payments      │                                                          │
│    Charges       │                                                          │
│    Debts         │                                                          │
│    Billing       │                                                          │
│    Periods       │                                                          │
│    Tariffs       │                                                          │
│    Expenses      │                                                          │
│                  │                                                          │
│  ▸ Communication │                                                          │
│    Announcements │                                                          │
│    Notifications │                                                          │
│                  │                                                          │
│  ▸ Insight       │                                                          │
│    Dashboard     │                                                          │
│    Reports       │                                                          │
│                  │                                                          │
│  ▸ Admin         │                                                          │
│    Users · Roles │                                                          │
│    Settings      │                                                          │
│    Website       │                                                          │
│    Imports       │                                                          │
│    Audit         │                                                          │
└──────────────────┴──────────────────────────────────────────────────────────┘
```

- **Build the nav from `/auth/me` permissions.** A group with no visible items disappears entirely —
  a teacher should see "Today" and "People", and nothing else. An empty "Finance" heading is worse
  than no heading.
- **Land the user on their own dashboard.** Route by their primary permission set to
  `/dashboard/director|accountant|reception`; if they hold several, remember the last choice and
  offer a switcher. A teacher with no dashboard permission lands on their group's attendance.
- **Branch switcher** in the header when `branchIds.length > 1`. Stage 1 is usually single-branch,
  but the model is multi-branch — don't hard-code one, and make the current branch always visible so
  nobody records a payment against the wrong site.
- **Language switcher** (ru default, uz) in the header. This is the *interface* language. Content
  locales in the website editor are a separate, differently-labelled control.
- **Global search** in the header: children, guardians, payments by receipt number. This is the
  fastest path for reception and should be reachable with `/` from anywhere.

### 3.2 Responsive

- ≥1280px: sidebar expanded.
- 768–1280px: sidebar collapsed to icons, expands on hover.
- <768px: sidebar becomes a drawer; **bottom tab bar** with the four items that role actually uses
  (a teacher: Attendance, Children, Announcements, Me).
- Tables below 768px become **cards**, not horizontally scrolling grids — except finance tables,
  which should scroll horizontally with a sticky first column, because an accountant on a phone is
  reading, not editing.

---

## 4. Cross-cutting patterns

Build each of these once. Every feature consumes them.

### 4.1 Session & permissions

```
app load → refresh (cookie) → access token in memory
         → GET /auth/me → { permissions, permissionsVersion, branchIds, roles }
         → build nav, gate controls
```

- `usePermission('payment:cancel')` → boolean; `useScope('child:read')` → `all|branch|own_group|…`.
- **After any role/grant change, `permissionsVersion` bumps — refetch `/auth/me`** and rebuild the
  nav in place. Don't force a reload.
- **A hidden button is UX, not security.** Every mutation must still handle `403 FORBIDDEN` and
  `403 OUT_OF_SCOPE` — show "You don't have permission for this", not a generic error.
- Scopes are applied server-side. A teacher's `/children` already contains only their group. Never
  try to widen a scoped list, and don't build UI implying data is missing.

### 4.2 The list → detail → action pattern

Used by children, guardians, groups, users, payments, expenses, notifications, audit. One shape:

```
List (filters in URL) ──► Detail (tabs, read-first) ──► Action (dialog or inline edit)
      ▲                                                          │
      └──────────────── invalidate query on success ◄────────────┘
```

Detail pages open **read-only** with an explicit Edit — this app is used by people who click
around while a parent is talking to them, and an always-editable form invites accidents.

### 4.3 Idempotent financial writes

`POST /payments`, `POST /billing-runs/:id/commit`, `POST /notifications/send` **require**
`Idempotency-Key` (integration guide §8).

> **Mint the key when the form opens, not when it submits.** Reuse the same key for every retry of
> that form. Mint a fresh one only when the user starts a genuinely new record. This is what makes
> a double-click, a flaky connection, or an impatient second click safe.

Disable the submit button while in flight, but never rely on that alone.

### 4.4 File access — read this before building any upload or download

**There are no signed URLs.** `GET /files/:id` streams bytes and checks permission on every request,
with `Content-Disposition: attachment`. Therefore:

- `<img src="/api/v1/files/{id}">` → **401**. The browser sends no Authorization header.
- `<a href="…">` / `window.open(…)` → **401**, for the same reason.

Build two helpers and use them everywhere:

```ts
// Display: authenticated fetch → object URL. Revoke on unmount.
async function fetchFileObjectUrl(fileId: string): Promise<string> {
  const res = await apiFetch(`/files/${fileId}`);      // adds Bearer + refresh loop
  return URL.createObjectURL(await res.blob());
}

// Download: same fetch, then a synthetic anchor click.
async function downloadFile(fileId: string, filename: string) { /* blob → <a download> → revoke */ }
```

An `<AuthImage fileId>` component wrapping the first one covers child photos, pickup-person photos,
the settings logo, and editor image previews. Cache object URLs per `fileId` and revoke them on
unmount or you will leak memory on a long-lived table.

Upload: `POST /files` (multipart, field `file`) → `{ fileId }` → attach the id to the parent record.
Enforce `MAX_UPLOAD_MB` (20) and the MIME allow-list client-side; expect `413`/`415` anyway.

The **one exception** is the public landing page's media route, which is deliberately anonymous —
see `frontend-landing-page.md` §8.3.

### 4.5 Async exports

Reports can return either the file directly or a job:

```
GET /reports/... ?format=xlsx
  ├─ 200 + file  → download it (§4.4)
  └─ 202 {jobId} → poll GET /exports/:id every ~2s
                     status processing → keep a progress toast alive
                     downloadUrl != null → download it (§4.4 — it is /files/{id}, still authenticated)
                     status failed → show `error`, offer retry
```

Build this once as `useExport()`. Keep polling in the background so the user can navigate away, and
land the finished file as a toast with a Download action.

### 4.6 Nothing is deleted — the reversal language

This system almost never destroys data, and the UI should teach that rather than hide it:

| Domain | "Delete" really means |
|---|---|
| Child | soft delete (Owner/Director) |
| User | deactivate — login blocked, audit trail intact |
| Charge | reverse — inserts an offsetting `sign=-1` row |
| Payment | cancel — inserts an offsetting reversal |
| Billing preview | discard — nothing was written anyway |
| Landing block | removed from draft; live until republished |
| Audit log | never |

Design one **reversal presentation** and use it everywhere: the original row stays, struck through
and muted, with the offsetting row directly beneath it in `danger`, carrying the reason and the
actor. Never let a reversal look like an edit, and never hide the original.

Label buttons for what they do: **Reverse charge**, **Cancel payment**, **Deactivate user** — not
a generic "Delete".

### 4.7 The closed-period wall

Once an accounting period is closed, financial writes into it fail with `409 PERIOD_CLOSED`.

Don't let the user find out at submit time. When a form's date lands in a closed period, show the
lock **on the date field** as they pick it, disable submit, and explain: *"July 2026 is closed. An
Owner can reopen it."* Handle the 409 anyway — the period can close while a form is open.

### 4.8 Duplicate detection (guardians)

`POST /guardians` with an existing phone returns `409 DUPLICATE` **and the existing record**. This
is a feature, not an error. The form must:

```
type phone → (on blur) create attempt or lookup
           → 409 DUPLICATE + existing guardian
           → show a card: "Aziza Karimova is already registered, linked to 2 children"
           → primary action: [ Link to this child ]     secondary: [ Edit details ]
```

Never show a red "phone already exists" and leave the user stuck — that is exactly how duplicate
guardian records get created with a typo'd phone number.

### 4.9 Offline-ish resilience at the front door

The attendance board is used during the rush on possibly-flaky wifi. The API's
`UNIQUE(tenant, child, date)` constraint makes check-in **safe to blindly retry**, and
`409 ALREADY_CHECKED_IN` on a replay should be treated as **success**, not an error.

Queue check-ins locally, apply optimistically, retry with backoff, and show a small "3 pending"
indicator rather than blocking the operator. Never make reception wait on a network round-trip with
a parent standing there.

---

## 5. Screens — daily operations

### 5.1 Attendance board (the highest-traffic screen in the building)

Floor density. Optimized for one person, 90 minutes, people waiting.

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Today · 8 сентября          [ All groups ▾ ]         Inside: 34 / 46    │
├─────────────────────────────────────────────────────────────────────────┤
│  ⚠ 2 children not picked up                                  [ View ]   │
├─────────────────────────────────────────────────────────────────────────┤
│  Sunflowers (12)                                                        │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐            │
│  │ [photo]    │ │ [photo]    │ │ [photo] 🔴 │ │ [photo]    │            │
│  │ Alisher K. │ │ Madina T.  │ │ Jasur R.   │ │ Nilufar S. │            │
│  │ in 07:52   │ │            │ │ in 08:10   │ │  sick      │            │
│  │[ Check out]│ │[ Check in ]│ │[ Check out]│ │            │            │
│  └────────────┘ └────────────┘ └────────────┘ └────────────┘            │
└─────────────────────────────────────────────────────────────────────────┘
```

- **Cards, not a table.** Photo-first: reception recognises faces, not names, and the photo is the
  fastest disambiguation between two children with the same first name.
- **One tap to check in.** No dialog, no time picker — the server timestamps it. Optimistic, queued
  (§4.9).
- **Check-out is two steps**, deliberately: tap Check out → the pickup verification card (§5.2)
  → confirm. Never allow a one-tap check-out; that is the safety-critical moment of the whole day.
- 🔴 **Medical alert flag** on the card, visible without opening anything, showing only the alert
  (allergy + instruction) — never full medical data (functional spec §B6).
- Group sections collapsible; a group filter for teachers whose scope is `own_group`.
- **Poll every 20–30 s and on window focus.** There is no SSE feed.
- Counters (`inside`, `absent`, `not picked up`) live in the header and are tappable filters.
- Marking absent/sick/vacation/excused is a small menu on the card, not a separate screen.
- **Corrections** need a reason of ≥10 characters and are audited. Put them behind an explicit
  "Correct this record" on the child's day detail, never inline on the board.

### 5.2 Pickup verification — the safety screen

This is the screen that decides whether a child leaves with the right adult. Design it to be read
in two seconds, across a desk, by someone under pressure.

```
┌──────────────────────────────────────┐   ┌──────────────────────────────────────┐
│                                      │   │                                      │
│         ┌──────────────┐             │   │         ┌──────────────┐             │
│         │              │             │   │         │              │             │
│         │    PHOTO     │             │   │         │    PHOTO     │             │
│         │              │             │   │         │              │             │
│         └──────────────┘             │   │         └──────────────┘             │
│                                      │   │                                      │
│      ✅  ALLOWED                     │   │      ⛔  NOT ALLOWED                  │
│                                      │   │                                      │
│      Karimova Aziza                  │   │      Rustamov Bobur                  │
│      Mother · +998 90 123 45 67      │   │      Uncle                           │
│      Permanent permission            │   │      Permission expired 05.09.2026   │
│                                      │   │                                      │
│      [ Confirm check-out ]           │   │      [ Back ]   [ Call guardian ]    │
└──────────────────────────────────────┘   └──────────────────────────────────────┘
```

- **Photo above everything**, large — at least 200px. The photo *is* the verification.
- The verdict is a full-width band in `success`/`danger` with an icon and a word. Never a small
  badge, never color alone.
- **When blocked, show the reason** ("permission expired", "not authorized for this child", "child
  is not checked in") and offer the next step — calling the primary guardian — rather than a dead
  end.
- Confirm is the only path from here to `POST /attendance/check-out`; a lapsed permission surfaces
  as `403 PERMISSION_EXPIRED` at that point too, so handle it on both.
- Temporary permissions are date-bounded and granted by a specific guardian; show who granted it and
  until when.

### 5.3 Not-picked-up follow-up

End of day, `/attendance/not-picked-up`. A short list with the child, group, check-in time, how long
past closing, and the primary guardian's phone as a tap-to-call link. This screen exists for a
stressful moment — keep it to one screen, no pagination, largest useful type.

---

## 6. Screens — records

### 6.1 Children directory

Desk density, but this is also the app's most-used lookup, so search must be instant.

- Search `q` debounced 300 ms, filters for group / status / `hasDebt` / `hasMedicalAlert`, all in
  the URL.
- Row: photo, full name, age (derived from birth date), group, status badge, debt badge, medical
  flag. **Badges over columns** — a table of eight columns is unreadable at a glance.
- Row click → profile. Keep the list scroll position on back.
- Empty-with-filters state offers **Clear filters**.

### 6.2 Child profile

```
┌──────────────────────────────────────────────────────────────────────┐
│ [photo]  Alisher Karimov            🔴 Allergy    💰 Debt 450 000    │
│          6 years · Sunflowers · Active            [ Actions ▾ ]      │
├──────────────────────────────────────────────────────────────────────┤
│ Overview │ Guardians │ Group & tariff │ Documents │ Medical │ History │ Consents │
└──────────────────────────────────────────────────────────────────────┘
```

- **The header is the summary**: photo, name, age, group, status, and the two flags that change
  behaviour — medical alert and debt. Everything else is in a tab.
- **Status changes are not a form field.** `POST /children/:id/status` needs an effective date and a
  reason, so it is an action with a dialog, and the result is a timeline entry in History. Never put
  status in the edit form.
- **Medical tab renders one of two entirely different UIs** by permission: the full record
  (`medical:read` — nurse/director) or the alerts-only banner (`medical:alerts` — teacher,
  reception). Build them as separate components; do not build one component that hides fields, or
  full medical data will eventually leak into a prop.
- Documents tab: type, number, issue/expiry, verified badge, attachment. **Expiring soon** is a
  warning chip on the tab itself — expiry is the thing people forget.
- Consents: what was granted, by whom, when, and a Revoke action. Photo/media consent shown here is
  what the website editor depends on (`frontend-landing-page.md` §8.3).

### 6.3 Guardians

- List with phone search — phone is the identity here.
- Create form is really a **find-or-create** (§4.8).
- Detail shows linked children with the relationship and the `isPayer` / `isEmergencyContact` /
  `isPrimaryContact` flags. Make **payer** visually prominent; that is who receives billing
  notifications.
- Telegram binding status per guardian, with an Invite action. Show bound/unbound plainly — unbound
  guardians silently miss every notification, and that is worth surfacing as a count on the list.

### 6.4 Groups

- Card grid: name, age range, `currentCount / capacity`, a capacity bar, main teacher.
- Capacity bar turns `warning` at ≥90%, `danger` at 100%.
- Assign/transfer are dialogs with an effective date and reason; the result appears in History.
- **Capacity override**: assignment past capacity returns `409 CAPACITY_EXCEEDED`. Only users who
  can force see a second step offering `?force=true`, and that step is a tier-3 dialog (§2.10) —
  it is audited. Everyone else sees the plain error and a suggestion to pick another group.

---

## 7. Screens — finance

Desk density throughout. Keyboard-navigable. Nothing here should feel fast.

### 7.1 Billing run — the highest-stakes flow in the app

Two-phase by design: a preview that writes nothing, then one committing transaction.

```
[ New billing run ]  year/month
        │
        ▼
  POST /billing-runs ──────────► PREVIEW (nothing written)
        │                        ┌───────────────────────────────────────────┐
        │                        │ July 2026 · 46 children · 12 450 000 сум  │
        │                        │ ⚠ 3 warnings                              │
        │                        ├───────────────────────────────────────────┤
        │                        │ Child        Tariff      Days   Amount    │
        │                        │ Alisher K.   Full day    22     450 000 ⓘ │← explain
        │                        │ Madina T.    Half day    18     280 000   │
        │                        └───────────────────────────────────────────┘
        │                          [ Discard ]            [ Commit run ]
        ▼
  POST /billing-runs/:id/commit  (Idempotency-Key)  → committed, immutable
```

- **The preview must be visibly a preview.** Persistent `info` banner: *"Nothing has been charged
  yet. Review the lines below, then commit."* This is the single most important sentence on the
  screen.
- **Warnings first, above the table** — a child with no tariff, an unusual proration — with a link
  that filters the table to those rows.
- **`ⓘ` on every amount opens `explain/:childId`**: which tariff, which days, which discounts, how
  it was prorated. Accountants will not trust a number they cannot take apart, and this is the
  feature that makes them trust it.
- **Commit** is a tier-3 confirmation stating the totals and that it cannot be undone as a batch
  (individual charges can only be reversed one by one). Idempotency-Key minted when the preview
  opened. `409 BILLING_ALREADY_COMMITTED` → refetch and show the committed state; it is not an
  error the user caused.
- **Discard** is tier 2 — nothing was written.
- Billing rules editor: versioned, with a **Simulate** step. Never allow save-without-simulate; show
  the simulated result against a chosen month side-by-side with the active rules' result (`diff`).

### 7.2 Record a payment

The form reception and the accountant use most.

- Fields: child (searchable), payer guardian (defaults to the `isPayer` guardian), amount in **som**,
  method, date, optional receipt no / bank ref / attachment / note.
- **Idempotency-Key minted on open** (§4.3).
- **Allocation is the subtle part.** Default: leave `allocations` empty and let the server allocate
  FIFO oldest-first. The form should say so in one line: *"Will be applied to the oldest unpaid
  charges first."* Offer **Allocate manually** as a disclosure that reveals per-charge inputs with a
  running remainder, and show clearly when a remainder becomes **advance credit** ("18 000 сум will
  remain as credit and apply to the next billing run"). Advance credit surprises people; name it.
- After save: the payment detail shows the resulting allocations, and a **Receipt** action opening
  `?format=pdf` (server-rendered and localized — do not build a client-side receipt).
- **Cancel** is tier 3 with a reason, and renders as a reversal (§4.6), never a removal.

### 7.3 Debts

Read-only reporting, always computed from the ledger — **there is no editable balance anywhere**,
and the UI must not imply otherwise.

- Debtors list: child, group, current debt, overdue amount, ageing bucket, days overdue. Filters for
  overdue-only, minimum amount, ageing bucket, group.
- Per-child card: current charge, previous debt, total paid, advance balance, current debt, and the
  ageing breakdown as a small stacked bar (`notOverdue / 1–7 / 8–30 / 30+`) using the ageing colors
  from §2.2.
- **Send reminder** action wired to `POST /notifications/send` with the `debt_reminder` template —
  from both the list (bulk, with a count confirmation) and the child card.
- Summary view by group and ageing bucket for the director.

### 7.4 Charges ledger

Append-only. Show it as a ledger, not a CRUD table: date, kind, description, amount, status, and
reversals as offsetting rows beneath their original (§4.6). Filters: child, period, kind,
unpaid-only. **Reverse** is tier 3 with a reason.

### 7.5 Periods

A year view of twelve month cards, each `open` (success) or `closed` (muted, lock icon).

- **Close** (accountant+) is tier 2 with a summary of what the period contains.
- **Reopen** is Owner-only, tier 3, requires a reason, is audited, and should be the most
  friction-heavy action in the entire product — consider requiring the period name to be typed.
- The current period is visually anchored. Closed periods link to their reports.

### 7.6 Tariffs, discounts, expenses

- **Tariffs**: catalog CRUD, amounts in som→tiyin. State plainly on the edit form that *"changes
  apply to future periods only — existing charges keep the tariff they were created with."* That
  snapshot behaviour is invisible and will otherwise generate support tickets.
- **Discounts** are per child, date-bounded, reason mandatory, `sensitive` → tier 3.
- **Expenses**: simple list by year/month/type/status, create with due date and attachment, a
  **Mark paid** action, and a yearly summary chart. The one genuinely simple finance screen.

---

## 8. Screens — communication

### 8.1 Announcements

Compose → target → schedule → **publish** (an explicit step, like the website editor).

- Audience picker with a **live recipient count** — "all", a group, specific children, guardians, or
  staff. Sending to the wrong audience is the main risk; the count is the safeguard.
- Priority (`low|normal|high|emergency`) changes the visual weight in lists; `emergency` should look
  alarming in composition too, so nobody picks it casually.
- Attachments via §4.4, schedule with `publishAt`/`expiresAt`.

### 8.2 Notification templates

- Edit **uz and ru side by side** — this is the one place a two-column layout beats tabs, because the
  translations must match in meaning and in variables.
- List the available `variables[]` as insertable chips; validate that both languages use the same
  variable set before saving.
- **Preview with sample data** before saving, rendered server-side.
- Make it clear that this text is rendered **by the server** — the client never localizes
  notification bodies.

### 8.3 Delivery log

Table of sends: recipient, channel, template, status, attempts, timestamp, error. Filter by status
and date. A **Retry** action on failures. Show the 20/min/tenant rate limit as a friendly ceiling
when bulk-sending, not as a surprise 429.

---

## 9. Screens — insight

### 9.1 Dashboards

One aggregate call per role — `/dashboard/director|accountant|reception`. **Do not fan out** to a
dozen endpoints to rebuild these.

- Tiles are **big numbers with a one-line label and a trend**, each linking to the filtered list
  behind it. A number nobody can drill into is decoration.
- Director: enrollment, attendance rate, revenue vs expected, debt total.
- Accountant: charges this period, payments received, outstanding debt, period status.
- Reception: present today, absent, currently inside, not picked up, pickup queue.
- Charts: two at most per dashboard. Prefer a sparkline in a tile over a chart that needs a legend.
- Every tile needs loading, empty ("no data for this period") and error states — a dashboard that
  half-loads and shows `0` is actively misleading in a finance context.

### 9.2 Reports

One reusable report screen: filter panel on the left, results on the right, format switcher
(`json` inline / `xlsx` / `pdf`) with the async export handler (§4.5). Keep the filter state in the
URL so a director can send a colleague a link to exactly what they were looking at.

### 9.3 Audit

Owner/Director only. Filters by entity, entity id, user, action, date range. Detail shows the
before/after diff — render it as a **field-by-field two-column diff**, not raw JSON, with changed
fields highlighted. This screen is what people reach for when something went wrong; it should be
readable by a director, not only by a developer.

---

## 10. Screens — administration

### 10.1 Users

List with role/status/branch filters; create/edit; **Deactivate**, never delete. Roles are assigned
per user, optionally scoped to a branch, and a user can hold several.

**Effective permissions** (`GET /users/:id/effective-permissions`) deserves a real screen: for each
permission, the granted scope and **which role granted it**. This answers "why can this person do
that?" — the question every operator eventually asks. Group by permission group, and mark
per-user overrides distinctly from role-derived grants.

### 10.2 Roles & the permission matrix

The hardest screen in the app. `GET /roles/matrix` + `GET /permissions/groups` build it in two calls.

```
                        │ Owner │ Director │ Admin │ Accountant │ Teacher │
  ── children ──────────┼───────┼──────────┼───────┼────────────┼─────────┤
  child:read            │  all  │   all    │ branch│   branch   │own_group│
  child:create          │  all  │   all    │ branch│     —      │    —    │
  child:delete      ⚠   │  all  │    —     │   —   │     —      │    —    │
```

- Rows grouped by permission group, groups collapsible; roles as columns with a sticky header and
  sticky first column.
- A cell is a small select of **that permission's `allowedScopes`** plus "—". Never offer a scope the
  permission doesn't allow.
- ⚠ marks `sensitive` permissions; deprecated ones are hidden by default behind a toggle.
- **Save is a full replacement** (`PUT /roles/:id/permissions`) — so batch edits per role and show a
  clear dirty state with **Save / Discard**, never autosave.
- **Clone** is the fastest route to a custom role; put it next to every role column header.
- **Diff** two roles side by side.
- The safety rails all have their own error codes — map each to a specific, human message rather
  than a generic failure:
  `ROLE_PROTECTED` · `ROLE_IN_USE` · `LAST_OWNER` · `SELF_LOCKOUT` · `PRIVILEGE_ESCALATION` ·
  `SENSITIVE_PERMISSION`. Better still, prevent the obvious ones client-side (grey out permissions
  the current user doesn't hold — you cannot grant what you don't have) while still handling the
  error.
- Any change bumps `permissionsVersion` → refetch `/auth/me` (§4.1).

### 10.3 Settings, branches, holidays

Straight forms. Logo upload via §4.4. Working days/hours and the holiday calendar feed attendance
and billing, so say so on the screen — editing a holiday is not a cosmetic act.

`receiptNumberFormat` needs a live preview of the resulting number; a format string with no preview
is a guessing game.

### 10.4 Imports

A four-step wizard, and the progress indicator matters because step 3 can fail partially:

```
 1 Choose entity  →  2 Download template  →  3 Upload & validate  →  4 Commit
                                                    │
                                         row-level errors table
                                         [ Fix and re-upload ]  or  [ Skip invalid rows ]
```

- The validation result is the heart of it: a table of failed rows with the row number, the field,
  and the message. Make it **exportable**, because people fix these in Excel.
- `skipInvalid` must be an explicit, clearly-labelled choice with the counts spelled out:
  *"Import 142 valid rows and skip 8 invalid?"*
- Poll `/imports/:id` for progress; commit is not instant on large files.
- **`opening_balances` gets an extra warning.** It seeds real debt at go-live and is the one import
  that is genuinely hard to walk back.

### 10.5 Website (landing page)

See [`frontend-landing-page.md`](frontend-landing-page.md) — it has its own full design guide,
including the editor layout, the draft/live model, and the public site's art direction.

---

## 11. Build order

Each slice should leave a usable app.

1. **Shell** — auth, refresh loop, `/auth/me`, permission gating, nav, the reusable table, the
   error map, money/date helpers, the file-access helpers (§4.4). Nothing user-facing ships without
   these, and every later slice assumes them.
2. **Children · Guardians · Groups** — the records everything else references. Includes the
   find-or-create guardian flow (§4.8) and the medical split (§6.2).
3. **Attendance + Pickup** — the daily driver, and the first screen real staff will judge you on.
4. **Finance**, strictly in order: Tariffs → Periods → Billing runs → Charges → Payments → Debts.
   Each depends on the last; building payments before charges exist has nothing to allocate against.
5. **Notifications + Announcements**, then **Dashboards + Reports**.
6. **Admin** — Users, the permission matrix, Settings, Audit.
7. **Expenses, Imports, Website.**

---

## 12. Acceptance checklist

**Cross-cutting**

- [ ] Nav contains only what the user's permissions allow; empty groups disappear entirely.
- [ ] Every mutation handles `403` and `403 OUT_OF_SCOPE` with a human message.
- [ ] `permissionsVersion` change refetches `/auth/me` and updates the nav without a reload.
- [ ] No money value anywhere passes through a JS `number`.
- [ ] Money is right-aligned with tabular figures; currency appears once per column.
- [ ] Calendar dates never shift by a day in a non-Tashkent browser timezone.
- [ ] Images and downloads work — no `<img src="/files/…">`, no bare `<a href>` (§4.4).
- [ ] Async exports keep working when the user navigates away.
- [ ] `Idempotency-Key` is minted on form open and reused across retries.
- [ ] Every list keeps filters in the URL and survives a refresh.
- [ ] Every table distinguishes "no data" from "no results" and offers Clear filters.
- [ ] Tier-3 actions require a reason and say that they are audited.
- [ ] Reversals render as offsetting rows, never as edits or removals.
- [ ] The whole app is usable in `uz` — no clipped labels, no untranslated strings.
- [ ] Keyboard-only operation of every finance table and dialog.

**Screen-specific**

- [ ] Attendance check-in is one tap, optimistic, and survives a dropped connection.
- [ ] `409 ALREADY_CHECKED_IN` on a retry is treated as success.
- [ ] Check-out cannot happen without passing through pickup verification.
- [ ] The pickup verify card is legible across a desk; blocked shows a reason and a next step.
- [ ] The medical alerts surface cannot render a full medical field, structurally.
- [ ] A billing preview is unmistakably not yet charged; every amount can be explained.
- [ ] A payment with no manual allocation explains FIFO and names any advance credit.
- [ ] A date in a closed period is blocked at pick time, not at submit.
- [ ] The permission matrix cannot offer a scope a permission doesn't allow.
- [ ] `opening_balances` import carries an explicit extra warning.
