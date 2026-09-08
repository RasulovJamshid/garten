# Landing Page CMS — Frontend Spec & Design Guide

> Companion to `frontend-functional-spec.md` (§B23) and `frontend-integration-guide.md`. Those two
> govern auth, the error envelope, permission gating, the typed client and the recommended stack —
> none of that is repeated here. This document covers the landing page module: its contract, the
> editor's design and flows, and the public site's design.
>
> **Field names are authoritative in `openapi.json`.** Where this doc and the schema disagree, the
> schema wins. Paths are relative to the base prefix, locally `http://localhost:3010/api/v1`.

**Contents**

1. [What you are building](#1-what-you-are-building)
2. [Domain model & states](#2-domain-model--states)
3. [Permissions](#3-permissions)
4. [Block catalog](#4-block-catalog)
5. [API reference](#5-api-reference)
6. [Data fetching & caching](#6-data-fetching--caching)
7. [Editor — design](#7-editor--design)
8. [Editor — flows](#8-editor--flows)
9. [Public site — design](#9-public-site--design)
10. [Public site — integration](#10-public-site--integration)
11. [Localization rules](#11-localization-rules)
12. [Errors](#12-errors)
13. [Known gaps & gotchas](#13-known-gaps--gotchas)
14. [Build order & acceptance](#14-build-order--acceptance)

---

## 1. What you are building

Two products against one backend module.

| | **Landing editor** | **Marketing site** |
|---|---|---|
| Lives in | the existing admin app | its own project |
| Users | kindergarten staff | anonymous visitors (parents) |
| Auth | JWT + permissions | none |
| Reads | the **draft** | the **published snapshot** |
| Priorities | clarity, safety, "am I live?" | trust, speed, mobile, SEO |

**Build the marketing site as its own project, not a route in the admin SPA.** The admin app is a
Vite SPA (integration guide §0), which is right for an authenticated tool and wrong for a page whose
whole job is to be found on Google and to load fast on a mid-range Android over mobile data. Use a
framework that renders HTML on the server or at build time — Next.js or Astro — and fetch the public
payload there. See §10.

The mental model, in one line:

> **A landing page is an ordered list of typed blocks. Editors change the draft. Publishing freezes
> the draft into what visitors see.**

Everything in the editor's design follows from that sentence, especially the parts that surprise
people: saving is not publishing, deleting is not taking down, and the live site is a *snapshot*,
not a live view of the database.

---

## 2. Domain model & states

```
LandingPage ──< LandingBlock          (the DRAFT: what the editor reads and writes)
     │
     ├── publishedSnapshot            (the LIVE page: frozen copy, what visitors read)
     └──< LandingPageVersion          (every publish, append-only, restorable)
```

Page-level state machine:

```
   ┌──────────────┐   add/edit block, edit SEO   ┌──────────────┐
   │  NEVER       │ ───────────────────────────► │  DRAFT       │
   │  PUBLISHED   │                              │  DIRTY       │
   │              │                              │              │
   │ public: 404  │                              │ public: 404  │
   └──────────────┘                              └──────┬───────┘
                                                        │ POST /landing/publish
                                                        ▼
   ┌──────────────┐   any draft edit             ┌──────────────┐
   │  PUBLISHED   │ ◄─────────────────────────── │  PUBLISHED   │
   │  + DIRTY     │ ───────────────────────────► │  CLEAN       │
   │              │      publish                 │              │
   │ public: last │                              │ public: this │
   │   snapshot   │                              │   snapshot   │
   └──────────────┘                              └──────────────┘
```

Two consequences to design around:

- **A page that has never been published is a 404 to the public.** Not an empty page — a 404. The
  marketing site must have its own fallback (see §10).
- **In `PUBLISHED + DIRTY`, the live site keeps serving the old snapshot.** Deleting a block, hiding
  it, or fixing a typo changes nothing publicly until Publish. This is the single most important
  thing the editor UI has to communicate.

`hasUnpublishedChanges` on `GET /landing` tells you which of the two published states you are in.

---

## 3. Permissions

| Permission | Grants |
|---|---|
| `landing:manage` | read the draft, add/edit/delete/reorder blocks, edit SEO, read version history |
| `landing:publish` | **Publish** and **Restore** |

Separate on purpose: a content editor can prepare the whole page and still not be able to push it to
the public internet. **Hide — don't merely disable — Publish and Restore for a user holding only
`landing:manage`** (integration guide §9). Owner, Director and Administrator hold both by default.

An editor without `landing:publish` still needs to know where their work stands, so keep the status
chip and the version history visible for them; only the two actions disappear.

Public endpoints take no token. Never send `Authorization` or `credentials: 'include'` to `/public/*`.

---

## 4. Block catalog

**Do not hardcode this table.** `GET /landing/block-types` returns the live catalog; a section type
added on the server must appear in the editor without a frontend release. The table is here so you
know what to design forms for today.

`i18n` = `{ uz?: string, ru?: string, en?: string }`, each locale ≤ 5000 chars. `fileId` = a uuid
from `POST /files`. `?` = optional.

| `type` | `content` | Limits |
|---|---|---|
| `hero` | `title: i18n`, `subtitle?: i18n`, `imageFileId?: fileId`, `ctaLabel?: i18n`, `ctaHref?: string` | `ctaHref` ≤ 500 |
| `about` | `title?: i18n`, `body: i18n`, `imageFileId?: fileId` | |
| `features` | `title?: i18n`, `items: { title: i18n, description?: i18n, icon?: string, imageFileId?: fileId }[]` | ≤ 24 items; `icon` ≤ 64 |
| `gallery` | `title?: i18n`, `images: { fileId, caption?: i18n }[]` | ≤ 60 images |
| `teachers` | `title?: i18n`, `people: { name: string, role?: i18n, bio?: i18n, photoFileId?: fileId }[]` | ≤ 60 people; `name` ≤ 200 |
| `pricing` | `title?: i18n`, `note?: i18n`, `plans: { name: i18n, price: i18n, description?: i18n, highlighted?: boolean }[]` | ≤ 12 plans |
| `testimonials` | `title?: i18n`, `items: { quote: i18n, author: string, role?: i18n, photoFileId?: fileId }[]` | ≤ 30 items; `author` ≤ 200 |
| `faq` | `title?: i18n`, `items: { question: i18n, answer: i18n }[]` | ≤ 50 items |
| `contacts` | `title?: i18n`, `address?: i18n`, `phones?: string[]`, `email?: string`, `workingHours?: i18n`, `mapEmbedUrl?: url`, `social?: { platform: string, url: url }[]` | ≤ 10 phones (≤ 40 each); ≤ 12 socials |
| `cta` | `title: i18n`, `subtitle?: i18n`, `buttonLabel: i18n`, `buttonHref: string` | `buttonHref` ≤ 500, required |
| `stats` | `title?: i18n`, `items: { value: string, label: i18n }[]` | ≤ 12 items; `value` ≤ 40 |

Field-level notes that will save you a bug:

- **`pricing.price` is marketing copy, not money.** It is `i18n` — `{ru: "от 1 500 000 сум / месяц"}`.
  Never run it through the tiyin helpers (integration guide §5); real tariffs are a different module.
- **`stats.value` is a plain string** — `"12"`, `"7+"`, `"98%"` — deliberately not a number.
- **`teachers.people[].name` and `testimonials[].author` are plain strings, not `i18n`.** People's
  names are not translated. Their `role` and `bio` are.
- **`features.icon` is an opaque key.** The server stores whatever string you send. Agree on an icon
  set with the designer, ship a fixed picker in the editor, and document the keys — otherwise an
  editor types "sun" and the site renders nothing.
- **Content objects are strict.** An unknown key is a **422**, not a silently dropped field.
- **`type` is immutable.** To change a section's type, delete the block and add a new one.
- **A required `i18n` field accepts `{}`.** The key must be present; no individual locale is
  required. This is deliberate — it lets an editor save a half-finished draft — but it means the
  server will happily publish a hero with no title in any language. **If you want "at least one
  language" enforced, the editor has to enforce it** (see the pre-publish check in §8.4).

---

## 5. API reference

### Editor endpoints (all require `Authorization: Bearer …`)

#### `GET /landing` — the draft

The single read the editor screen is built on. Every locale intact.

```jsonc
{
  "id": "0f3c…",
  "slug": "home",
  "seo": { "title": {"ru":"…"}, "description": {"ru":"…"}, "ogImageFileId": "…", "canonicalUrl": "…" },
  "blocks": [
    {
      "id": "8a21…",
      "tenantId": "…",
      "pageId": "0f3c…",
      "type": "hero",
      "position": 0,
      "isVisible": true,
      "content": { "title": { "ru": "Детский сад «Солнышко»", "uz": "…" } },
      "fileIds": ["…"],        // server-derived, read-only
      "createdAt": "2026-09-04T09:10:00.000Z",
      "updatedAt": "2026-09-04T09:12:00.000Z",
      "updatedBy": "…"
    }
  ],
  "version": 3,                 // latest published version (0 before the first publish)
  "publishedAt": "2026-09-03T…", // null if never published
  "publishedVersion": 3,        // null if never published
  "hasUnpublishedChanges": true
}
```

- Blocks arrive **sorted by `position`** — render in array order, don't re-sort.
- A tenant that has never opened the editor gets a valid empty page, not a 404. There is no "create
  page" step to build.
- **This is also your preview source**, and it is exactly what publishing would make live.

#### `GET /landing/block-types` — the form catalog

```jsonc
{
  "locales": ["uz", "ru", "en"],
  "types": [
    { "type": "hero", "fields": ["title", "subtitle", "imageFileId", "ctaLabel", "ctaHref"] }
  ]
}
```

Fetch once per session. Drives the "Add section" menu and the per-type form.

#### `POST /landing/blocks` → `201` (returns the block)

```jsonc
{ "type": "hero", "content": { … }, "position": 0, "isVisible": true }
```

`position` and `isVisible` are optional (end of page, visible).

> **Omit `position`.** Creating with an explicit position does **not** shift the other blocks, and
> `position` is not unique — two blocks can share one, and their relative order is then undefined.
> Always append, then send a reorder if the user dropped the new section somewhere specific.

#### `PUT /landing/blocks/:id` → `200`

```jsonc
{ "content": { … }, "isVisible": false }
```

Both optional. `content` is validated against the block's **existing** type and **replaces**
wholesale — no deep merge, so send the complete object.

Only those two keys are accepted. Echoing a fetched block back (with `id`, `type`, `fileIds`, …) is a
**400** under the global `forbidNonWhitelisted` validation. Pick the fields out; don't spread.

#### `DELETE /landing/blocks/:id` → `200`

Draft only. The live page keeps the block until the next publish — this is **not** an emergency
takedown button.

#### `PUT /landing/blocks/reorder` → `200` (returns the reordered list)

```jsonc
{ "blocks": [ { "id": "8a21…", "position": 0 }, { "id": "b7f0…", "position": 1 } ] }
```

Send **every** block (≤ 200). One transaction. An id not on this page fails the whole call with a
404 and applies nothing.

#### `PUT /landing/seo` → `200`

```jsonc
{ "title": {…}, "description": {…}, "ogImageFileId": "…", "canonicalUrl": "https://sunshine.uz" }
```

`canonicalUrl` ≤ 500. The OG image is included in the published snapshot's public file allow-list,
so it is fetchable from `mediaBaseUrl` like any other landing image.

#### `POST /landing/publish` → `201` · requires `landing:publish`

```jsonc
// request — note optional, ≤ 500 chars
{ "note": "Added the teachers section" }
// response
{ "version": 4, "publishedAt": "2026-09-04T09:20:00.000Z", "blocks": 6 }
```

Freezes every **visible** block. Hidden blocks are excluded — that is how you stage a section.

Can return **409 `CONFLICT`** (`CONCURRENT_PUBLISH`) if someone else published in the same instant.
Handle it: refetch and let the user retry.

#### `GET /landing/versions` → `200`

```jsonc
[ { "id": "…", "version": 4, "note": "…", "publishedAt": "…", "publishedBy": "…" } ]
```

Newest first. Snapshots omitted (they are large) — `GET /landing/versions/:version` returns one row
including its full `snapshot`, in the same shape the public endpoint serves but with all locales.

#### `POST /landing/versions/:version/restore` → `201` · requires `landing:publish`

```jsonc
{ "version": 5, "restoredFrom": 2, "publishedAt": "…" }
```

Replays that snapshot over the draft **and publishes it as a new version**. History is append-only,
so a restore is itself undoable. **Every block gets a new `id`** — any id in component state is
stale; refetch immediately.

### Public endpoints (no auth)

#### `GET /public/landing/:tenantCode?lang=uz|ru|en` → `200`

```jsonc
{
  "slug": "home",
  "locale": "ru",
  "version": 4,
  "publishedAt": "2026-09-04T09:20:00.000Z",
  "seo": { "title": "…", "description": "…", "ogImageFileId": "…", "canonicalUrl": "…" },
  "blocks": [
    { "id": "8a21…", "type": "hero", "content": { "title": "Детский сад «Солнышко»", "subtitle": null } }
  ],
  "mediaBaseUrl": "/api/v1/public/landing/demo/media"
}
```

Differences from the editor payload, all deliberate:

- **Text is flattened to strings**, not `{uz, ru, en}` objects. Untranslated → `null`.
- **Only visible blocks**, only `{id, type, content}`. Array order is display order.
- `mediaBaseUrl` carries the API prefix — append a file id and use it against the API origin.

`lang` defaults to `ru`. `GET /public/landing` (no code) serves `LANDING_DEFAULT_TENANT_CODE`, for
single-kindergarten deployments; 404 if that variable isn't set.

**404 means "no published page"** — unpublished, unknown tenant code, or suspended tenant, all
deliberately indistinguishable.

#### `GET /public/landing/:tenantCode/media/:fileId`

Serves the image inline, `Cache-Control: public, max-age=86400, immutable`. Use directly as `<img src>`.

### Limits

| | Limit |
|---|---|
| Public page read | 60/min/IP |
| Public media read | 300/min/IP |
| Everything else | 300/min/user |
| Upload size | `MAX_UPLOAD_MB` (default 20) |
| Upload types | jpeg, png, webp, pdf — **but landing blocks accept images only** |

---

## 6. Data fetching & caching

TanStack Query keys and invalidation:

```ts
['landing']                       // GET /landing            — the draft
['landing', 'block-types']        // GET /landing/block-types — staleTime: Infinity
['landing', 'versions']           // GET /landing/versions
['landing', 'versions', version]  // GET /landing/versions/:v — staleTime: Infinity (immutable)
```

| After | Invalidate |
|---|---|
| create / update / delete / reorder block, update SEO | `['landing']` |
| **publish** | `['landing']` **and** `['landing','versions']` |
| **restore** | `['landing']` **and** `['landing','versions']` — and drop any selected-block state |

- `block-types` and a specific version snapshot never change; cache them forever.
- **Optimistic updates**: worth it for reorder and the visibility toggle (instant feedback, trivial
  rollback). Not worth it for content edits — the server returns the canonical row and the 422 path
  needs real field errors anyway.
- **Refetch `['landing']` on window focus.** It is the cheapest possible defence against two staff
  editing at once (§8.6).

---

## 7. Editor — design

### 7.1 Where it lives

A single top-level nav item in the admin app — **"Website"** (ru: «Сайт», uz: "Sayt") — visible only
with `landing:manage`. One route, `/website`, with the version history as a drawer rather than a
second page.

Inherit the admin app's existing design tokens wholesale: colors, radii, spacing, typography, form
controls, toasts. This screen should look like the rest of the app, not like a marketing tool
bolted on. The only new visual vocabulary it introduces is the **draft/live status**, below.

### 7.2 Layout

Two panes plus a full-width preview mode. Not three panes: at 1366×768 — a very common laptop in
this deployment — a third column leaves a preview too narrow to judge anything, and the preview
matters most as a deliberate check before publishing, not continuously.

```
┌────────────────────────────────────────────────────────────────────────────┐
│  Website                          ● Draft · 3 changes    [ Preview ] [Publish] │  ← status bar
├───────────────────────┬────────────────────────────────────────────────────┤
│  SECTIONS             │  Hero                              [uz] [RU] [en]  │
│                       │  ─────────────────────────────────────────────────  │
│  ⠿ ▦ Hero          👁 │                                                    │
│  ⠿ ▦ About us      👁 │   Title *                                          │
│  ⠿ ▦ Our teachers  👁 │   ┌──────────────────────────────────────────────┐ │
│  ⠿ ▦ Gallery       🚫 │   │ Детский сад «Солнышко»                       │ │
│  ⠿ ▦ FAQ           👁 │   └──────────────────────────────────────────────┘ │
│  ⠿ ▦ Contacts      👁 │                                                    │
│                       │   Subtitle                                         │
│  ＋ Add section       │   ┌──────────────────────────────────────────────┐ │
│                       │   │ Забота и развитие с 2 лет                    │ │
│  ─────────────────    │   └──────────────────────────────────────────────┘ │
│  ⚙ SEO & sharing      │                                                    │
│  🕘 Version history   │   Image                                            │
│                       │   ┌────────────┐                                   │
│                       │   │  [ photo ] │  hero.jpg · 1920×1080             │
│                       │   └────────────┘  [ Replace ]  [ Remove ]          │
│                       │                                                    │
│                       │                              ✓ Saved  [Delete section] │
└───────────────────────┴────────────────────────────────────────────────────┘
```

- **Left rail (≈280px)**: the section outline. Drag handle, type icon, a human label, visibility
  state. This is the page's table of contents and its reorder surface.
- **Right pane**: the form for the selected section, with locale tabs at the top.
- **Status bar**: page-level state and the two page-level actions.
- **Below 1024px**: collapse to one column — outline, tap a section to push the form in as a full
  screen with a back button. Editing on a phone will be rare but must not be broken.

### 7.3 The section label problem

Blocks have a `type`, not a name. `"Block 3"` is useless in the outline. Derive a label:

> **`content.title` in the current locale → falling back to any locale → falling back to the
> translated type name.**

So a hero titled «Солнышко» shows as **Hero · Солнышко**; an untitled FAQ shows as **FAQ**. Truncate
to one line. Same rule everywhere a section is named.

### 7.4 Draft/live status — the one thing to get right

Staff will not read documentation. The UI has to make "this is not live yet" impossible to miss.

Three states, one component in the status bar:

| State | Chip | Publish button |
|---|---|---|
| never published | ⚪ **Not published** — "This page is not on the website yet" | enabled, primary |
| published, clean | 🟢 **Live** — "Published v4 · 2 days ago" + link to the live page | disabled, with tooltip "No changes to publish" |
| published, dirty | 🟡 **Draft changes** — "Live: v4 · 2 days ago. Your changes are not on the website yet." | enabled, primary |

Rules:

- **Do not use a blocking navigate-away dialog.** With autosave (§7.5) nothing is *lost* by leaving
  — the changes are saved, just unpublished. A confirm dialog on every navigation would fire
  constantly and train people to dismiss it. The persistent chip does the job honestly.
- The chip is the anchor for the whole mental model. Keep it visible while scrolling.
- After a successful publish, the chip animates to 🟢 **Live** — that transition is the reward, so
  don't hide it behind a modal that has to be dismissed first.

### 7.5 Saving

**Autosave the draft; publish explicitly.** A `Save` button is redundant when a publish gate exists,
and its absence removes an entire class of "I lost my work" support calls.

- Debounce **~1000 ms** after the last keystroke, and flush immediately on blur, on section switch,
  and before Publish.
- One `PUT /landing/blocks/:id` per save with the block's complete `content`.
- Indicator next to the form: `Saving…` → `✓ Saved` → fades. On failure: `⚠ Not saved — retry`, with
  the retry inline. Never a toast for a successful save; toasts for routine success become noise.
- Serialize saves per block — never let a debounced save overtake an earlier in-flight one.

### 7.6 Forms

React Hook Form + Zod, mirroring the server rules (integration guide §0). Build a **field renderer
keyed by field name from `GET /landing/block-types`**, not eleven bespoke forms:

| Field shape | Control |
|---|---|
| `i18n` short (`title`, `name`, `label`, `question`, `price`) | single-line input with locale tabs |
| `i18n` long (`body`, `bio`, `answer`, `description`) | textarea, auto-growing, 5000-char counter past 4000 |
| `fileId` | image picker (§8.3) |
| array of objects | repeatable list: drag to reorder, per-item collapse, `+ Add`, delete with confirm, item count vs limit |
| `boolean` (`highlighted`) | switch |
| `url` / `href` | input with inline URL validation and a scheme hint |
| `icon` | picker from the agreed set, never a free-text field |

Repeatable lists are the bulk of the work — `features`, `gallery`, `teachers`, `pricing`,
`testimonials`, `faq`, `stats` all use one. Build it once, well: collapsed rows showing the item's
title, expand to edit, drag handle on the left, delete on the right, disabled `+ Add` at the limit
with the limit named.

### 7.7 Empty, loading, error states

| Where | State |
|---|---|
| Page, first ever visit | Illustration + "Your website page is empty. Add your first section." + a prominent **Add section** and a one-line explainer that nothing goes live until Publish |
| Page, loading | Skeleton outline (4 rows) + skeleton form; never a full-screen spinner |
| Section list, loading a section | Keep the outline interactive; skeleton only the form pane |
| Save failed | Inline `⚠ Not saved` by the indicator + retry; keep the user's input, never revert the field |
| 422 on save | Field-level errors mapped from `details[].path`, focus the first, scroll it into view |
| Load failed | Full-pane error with a Retry, and the `traceId` in small text for support |
| No `landing:publish` | Publish and Restore absent; chip still shows state; a quiet line: "Ask a director to publish" |

---

## 8. Editor — flows

### 8.1 First run

```
open /website
  └─ GET /landing → empty blocks, publishedVersion: null
     └─ empty state: "Add your first section"
        └─ Add section → type picker (from block-types, with a one-line description + thumbnail each)
           └─ POST /landing/blocks (no position → appended)
              └─ select it, focus the first field
                 └─ autosave as they type
                    └─ status chip: ⚪ Not published
```

The type picker deserves care: it is the only place a non-technical user meets the words "hero" and
"CTA". Show a **thumbnail of the layout** and a plain-language name per type — «Главный экран»
(Hero), «О нас» (About), «Педагоги» (Teachers) — with the technical type only as a subtitle.

### 8.2 Everyday edit

```
select section → edit field → (1s) autosave → ✓ Saved → chip flips to 🟡 Draft changes
                                                          └─ … → Preview → Publish
```

Reorder: drag in the outline → optimistic local reorder → `PUT /landing/blocks/reorder` with **all**
blocks renumbered `0..n-1` → on failure revert and toast.

Hide: toggle in the outline → `PUT /landing/blocks/:id {isVisible:false}` → row dims, badge
**"Hidden"** → tooltip: "Will be removed from the website on next publish."

Delete: confirm dialog. Copy matters —

> **Delete "Our teachers"?**
> This removes the section from your draft. It stays on the website until you publish.

### 8.3 Images

```
pick image → POST /files (multipart, field "file")
           → { fileId }
           → set into content (imageFileId / photoFileId / images[].fileId)
           → PUT /landing/blocks/:id
           → preview via GET /files/:id  (authenticated — editor only)
           → …later… Publish → now fetchable at mediaBaseUrl/{fileId}
```

- In the **editor**, preview with the authenticated `GET /files/:id`, exactly as elsewhere in the app.
- On the **public site**, always `${mediaBaseUrl}/${fileId}`. Never `/files/:id` — it needs a token.
- A file is publicly readable **only while a published block references it**. A just-uploaded image
  is not public until the next publish. That is intended, not a bug.
- The server rejects a non-image at edit time with a 422 — surface it on the field, don't swallow it.
- Enforce `MAX_UPLOAD_MB` and the MIME allow-list client-side too; expect `413`/`415` otherwise.
- **Show pixel dimensions and file size after upload**, and warn above ~500 KB. Staff will upload
  4 MB phone photos into a hero, and these images are served by the API, not a CDN.
- **Recommended source sizes**: hero 1920×1080, about/feature 1200×900, gallery 1600×1200, portraits
  800×1000, OG image 1200×630.

> **Photos of children need parental consent.** The system already records photo/media-release
> consents per child (`GET /children/:id/consents`), but **the landing module does not check them** —
> nothing stops an editor publishing any photo. Put a one-line reminder next to the image picker in
> gallery and teachers blocks: *"Only publish photos of children whose guardians have given media
> consent."* Treat it as a process, not a feature.

### 8.4 Publish

```
[ Publish ] → flush pending autosaves
            → pre-publish review modal
            → POST /landing/publish { note? }
            → 201 → invalidate ['landing'], ['landing','versions']
            → chip → 🟢 Live · v5 · just now
            → toast: "Published. [ View website ↗ ]"
```

The review modal is where the editor earns its keep. It should state, plainly:

```
┌──────────────────────────────────────────────────────┐
│  Publish to the website?                             │
│                                                      │
│  6 sections will be live                             │
│  1 section is hidden and will not appear             │
│                                                      │
│  ⚠  3 fields have no Uzbek text                      │
│  ⚠  "Our teachers" has no title in any language      │
│                                                      │
│  Note (optional)  [ Added the teachers section     ] │
│                                                      │
│                        [ Cancel ]  [ Publish now ]   │
└──────────────────────────────────────────────────────┘
```

- Warnings **never block** publishing — a half-translated page is a legitimate state (§11).
- The "no text in any language" warning is the client-side backstop for the `{}` laxness noted in §4.
- The note is optional but genuinely useful in the version list; prefill nothing, don't nag.
- On **409 `CONCURRENT_PUBLISH`**: don't retry silently. Refetch, then show *"Someone else published
  while you were publishing. Reload to see their changes, then publish again."*

### 8.5 Version history & restore

Drawer from the status bar:

```
🕘 Version history
  v5  just now      Owner        "Added the teachers section"   ● live
  v4  2 days ago    Director     "Autumn photos"                [ View ] [ Restore ]
  v3  1 week ago    Owner        —                              [ View ] [ Restore ]
```

**View** renders that version's snapshot with the public block components, read-only, labelled
*"Version 4 — not live"*. **Restore** confirms with copy that says exactly what happens:

> **Restore version 4?**
> This replaces your current draft with version 4 **and publishes it immediately**. Your current
> draft will still be available as version 5 in this history.

Then: `POST …/restore` → invalidate both queries → **clear selected-block state** (ids changed) →
reselect by position → toast *"Restored version 4 as version 6."*

### 8.6 Two editors at once

There is **no locking and no optimistic concurrency on blocks** — last write wins. For a small staff
editing a rarely-changed page that is an acceptable trade, but the UI should not pretend otherwise:

- Refetch `['landing']` on window focus.
- If a block's `updatedAt` moved and it isn't your own write, show a non-blocking banner:
  *"Someone else changed this page. [Reload]"*
- The 409 on publish (§8.4) is the one place the server does protect you. Handle it explicitly.

---

## 9. Public site — design

### 9.1 Who this is for

Parents in Uzbekistan choosing a kindergarten for a 2–6 year old. Predominantly **mobile, on mobile
data**, often Android mid-range. They are deciding whether to trust strangers with their child. They
want, in this order: is it safe and warm, where is it, what does it cost, how do I visit.

Design for that, not for a design award:

- **Mobile-first, genuinely.** Design the 360px layout first; the desktop layout is the adaptation.
- **Photographs of the real place and real staff** beat stock imagery and illustration by a wide
  margin. Trust is the product.
- **A visible phone number and a single clear CTA** — "Записаться на экскурсию" / "Ekskursiyaga
  yozilish". One primary action, repeated down the page (hero, after teachers, in the CTA band).
- **Warm, not corporate.** Soft neutrals plus one warm accent; generous whitespace; radii 16–24px;
  large friendly type. Avoid the sharp blue-grey of the admin app — this is a different product.
- **Accessibility is not optional**: body text ≥ 16px, contrast ≥ 4.5:1, focus rings intact, hit
  targets ≥ 44px, and a page that works at 200% zoom.

**Typography**: pick a face with complete **Cyrillic and Latin** coverage — Inter, Manrope, Golos
Text or Noto Sans all qualify. Many display fonts silently fall back for Cyrillic and the page will
look broken in Russian. Test every heading in ru **and** uz before signing off: Uzbek Latin runs
noticeably longer than Russian, and headline layouts that fit in one language wrap awkwardly in the
other.

### 9.2 Page rhythm

Editors choose the order, so every block must look right anywhere. Design each as a **self-contained
band** — full-bleed width, its own vertical padding (≈96px desktop / 56px mobile), no dependence on
what precedes it. Alternate background tone (default / tinted) automatically by index so consecutive
sections separate visually without the editor thinking about it.

### 9.3 Per-block layout

| Block | Desktop | Mobile | Images |
|---|---|---|---|
| `hero` | full-bleed image, overlay text left, CTA button; or 50/50 split | image on top 4:5, text below, full-width CTA | 16:9, focal point centre; **preload**, never lazy |
| `about` | 50/50 text + image | stacked, image first | 4:3 |
| `features` | 3-up grid (2-up at 12 items+) | 1-up stacked cards | icon 1:1 or image 3:2 |
| `gallery` | 3–4 col grid, lightbox | 2 col, swipe lightbox | 4:3 thumbs, lazy |
| `teachers` | 3–4 up cards, name + role | horizontal scroll or 2-up | portrait 3:4 |
| `pricing` | 3 cards, `highlighted` raised + accent border | stacked, highlighted first | — |
| `testimonials` | 2–3 col quotes, or a slider | slider, one at a time | avatar 1:1, 64px |
| `faq` | accordion, max width 720px, one open at a time | same | — |
| `contacts` | 50/50 details + map | details, map below, min 240px tall | — |
| `cta` | full-width accent band, centred | same, full-width button | — |
| `stats` | 3–4 up, big number + label | 2×2 grid | — |

Guardrails:

- **Every block must render with its optional fields missing.** No title, no image, one FAQ item,
  twelve pricing plans — all legal. Never assume an array is non-empty.
- **Every text can be `null`** (untranslated). Render nothing, not "null", and collapse the space.
- `pricing.highlighted` may be true on several plans or none. Don't assume exactly one.
- `hero.ctaHref` / `cta.buttonHref` are free strings: could be `/apply`, `https://…`, `tel:…`, or
  `#contacts`. Detect and handle all four; open external links in a new tab.

### 9.4 The map embed is untrusted input

`contacts.mapEmbedUrl` is a URL an editor typed, rendered in an `<iframe>`. **Allow-list the host**
(Google Maps, Yandex Maps) and refuse to render anything else; add `sandbox` and
`referrerpolicy="no-referrer"`. Never interpolate it into anything but an `iframe src`.

### 9.5 Performance

Images come from the API, not a CDN, and their route is rate-limited — so restraint is a
requirement, not a nicety:

- Explicit `width`/`height` (or `aspect-ratio`) on every image to eliminate CLS.
- `loading="lazy"` + `decoding="async"` everywhere **except** the hero, which should be preloaded.
- Lazy-load galleries in particular: a 60-image gallery is 60 requests against a 300/min/IP budget.
- Cache the page payload at the edge/server for ~60 s, matching `Cache-Control`, and forward
  `If-None-Match` so most reads are 304s.
- Budget: LCP < 2.5 s on a throttled 4G profile. The hero image is your LCP element — size it
  properly and there is nothing else heavy on the page.

---

## 10. Public site — integration

### 10.1 Rendering strategy

Render on the server or at build time. Fetch once per render, pass the payload down:

```
request → GET /public/landing/{code}?lang={locale}   (60s cache, If-None-Match)
        → 200 → render <head> from seo + blocks in array order
        → 404 → render the static fallback page (see below)
```

With Next.js, a static render revalidated every 60 s matches the API's own cache headers. With
Astro, SSG plus a scheduled rebuild works equally well. Either way **the block markup must exist in
the HTML** — a client-side fetch means an empty page for crawlers.

### 10.2 The 404 fallback is not optional

The public endpoint 404s when the page was never published, the tenant code is wrong, or the tenant
is suspended. Ship a **static fallback**: logo, address, phone, one line of copy. A kindergarten's
website going blank because someone hasn't pressed Publish is a worse failure than a plain page.
Log the 404 loudly on your side — it is almost always a misconfiguration.

### 10.3 `<head>`

```
<title>            seo.title            (fallback: kindergarten name)
<meta description> seo.description
<link canonical>   seo.canonicalUrl
og:title/description  same as above
og:image           `${API_ORIGIN}${mediaBaseUrl}/${seo.ogImageFileId}`   ← must be ABSOLUTE
og:locale          from `locale`
<html lang>        from `locale`
hreflang           one <link> per locale you serve
```

`mediaBaseUrl` is a **path**, not a URL. `og:image` must be absolute, so join it with the API origin
explicitly — a relative OG image silently fails in every social preview.

Add JSON-LD `LocalBusiness`/`ChildCare` built from the `contacts` block (address, phones, opening
hours) — cheap, and it is what surfaces the kindergarten in local search.

### 10.4 Language switching

`lang` is a query parameter on the API but should be a **path segment on your site** (`/ru`, `/uz`,
`/en`) so each language is separately indexable and shareable. Map route → `lang` → API call. Persist
the visitor's choice, default from `Accept-Language`, fall back to `ru`.

### 10.5 Unknown block types

The catalog can grow server-side before your site ships a renderer. **Skip unknown `type` values
silently** — never crash, never render a placeholder in production. Log it so someone notices.

---

## 11. Localization rules

- Authoring locales come from `GET /landing/block-types` → `locales`. Today `uz`, `ru`, `en`. Read
  them, don't hardcode — the set can grow.
- **Every locale on every field is optional.** A half-translated page is valid and publishable. Warn
  before publish (§8.4); never block.
- Public fallback order: **requested → ru → uz → en**. An empty string counts as missing. A field
  with nothing anywhere comes back as `null`, with the key retained so the shape is stable.
- The editor's own chrome is localized separately via `react-i18next` (ru/uz) — don't confuse the
  *editor UI* language with the *content* locale being edited. Two independent switches; label them
  differently.
- Per-locale completeness: show a dot on each locale tab — filled if every visible field in that
  section has text, hollow if partial, empty if none.

---

## 12. Errors

Standard envelope: `{ error: { code, message, details, traceId } }`.

| Status | `code` | When | Handling |
|---|---|---|---|
| 400 | `VALIDATION_FAILED` | request shape rejected by the DTO — unknown `type`, stray keys | a client bug; log with `traceId` |
| **422** | `VALIDATION_FAILED` | **block content rejected by its type's schema** | `details` = `[{path, message}]` — map onto fields |
| 403 | `FORBIDDEN` | publish/restore without `landing:publish` | the button shouldn't have been shown |
| 404 | `NOT_FOUND` | unknown block/version; public: nothing published | — |
| **409** | `CONFLICT` (`CONCURRENT_PUBLISH`) | two publishes raced | refetch, explain, let the user retry |
| 413/415 | `FILE_TOO_LARGE` / `UNSUPPORTED_MEDIA_TYPE` | upload | enforce client-side first |
| 429 | `RATE_LIMITED` | public endpoint hammered | back off; cache properly |

The 422 `details` array is the one to wire properly. `path` is dot/index notation matching the
content object — `items.2.question`, `plans.0.name.ru` — so it maps straight onto a repeatable-field
form. Focus the first error and scroll it into view.

---

## 13. Known gaps & gotchas

**Gaps in the current API** — design around them, and raise them if they start to hurt:

1. **No `alt` text field on images.** `gallery` has `caption` (usable as alt); `hero`, `about`,
   `features`, `teachers` and `testimonials` images have nothing. For now derive alt from the
   nearest title/name, and never leave `alt` absent. Adding `alt?: i18n` to the image-bearing blocks
   is a code-only change (no migration) — worth requesting early rather than retrofitting.
2. **No concurrency control on block edits.** Last write wins (§8.6).
3. **Required `i18n` fields accept `{}`** — "required" means the key exists, not that any language
   was filled (§4).
4. **Only one page** (`slug: "home"`). The column exists for "About us", "Admissions" etc., but no
   endpoint exposes other slugs yet. Don't build a page switcher.
5. **No scheduled publishing** and no expiry. Publish is immediate.

**Gotchas, collected:**

6. Publishing is the only thing that changes the live site. Saving is not.
7. Deleting a block does not take it off the live site until the next publish.
8. Restore replaces every block id — refetch and drop selection state.
9. `type` cannot be changed after creation.
10. `content` is replaced, not merged, on `PUT`.
11. Don't send `position` on create; append and reorder.
12. A newly uploaded image is not publicly fetchable until the publish that references it.
13. `pricing.price` is not money.
14. Never send `Authorization` or `credentials: 'include'` to `/public/*`.
15. `fileIds` is server-derived; echoing a whole block row into a `PUT` is a 400.
16. `mediaBaseUrl` is a path — make it absolute for `og:image`.
17. The marketing site's origin must be in the API's `CORS_ORIGINS`, or every browser call fails
    preflight.

---

## 14. Build order & acceptance

**Editor**

1. Route, permission gate, `GET /landing`, outline + status chip (read-only) — proves the contract.
2. Field renderer + locale tabs + autosave, for `hero` and `about` only.
3. The repeatable-list control → unlocks `features`, `faq`, `stats`, `pricing`.
4. Image picker → unlocks `gallery`, `teachers`, `testimonials`, and the SEO panel.
5. Reorder, hide, delete.
6. Preview mode (reuses the public block components — build the public site's components first if
   the two are in one repo).
7. Publish + pre-publish review.
8. Version history + restore.

**Marketing site**

1. Fetch + render pipeline, `<head>`, the 404 fallback.
2. `hero`, `about`, `contacts`, `cta` — a complete small site.
3. `features`, `faq`, `stats`.
4. `gallery` + lightbox, `teachers`, `testimonials`, `pricing`.
5. Language routes, hreflang, JSON-LD.
6. Performance pass against the budget in §9.5.

**Acceptance checklist**

- [ ] An editor with only `landing:manage` sees no Publish or Restore button anywhere.
- [ ] A draft edit is visibly saved without any Save button, and the status chip turns 🟡.
- [ ] The live site is unchanged until Publish — verified by editing, reloading the public URL, then
      publishing and reloading again.
- [ ] After publishing, the chip turns 🟢 and Publish is disabled until the next edit.
- [ ] Deleting a section warns that it stays live until publish.
- [ ] A 422 from a bad field lands on that field, not in a toast.
- [ ] Restoring a version updates the page and nothing in the UI is holding a stale block id.
- [ ] Every block renders correctly with all optional fields empty and all arrays empty.
- [ ] Every block renders correctly in `uz`, `ru` and `en`, including untranslated (`null`) fields.
- [ ] The public site renders fully with JavaScript disabled.
- [ ] The public site renders a sensible fallback when the API returns 404.
- [ ] Hero image preloaded; every other image lazy; no layout shift.
- [ ] Lighthouse on mobile: LCP < 2.5 s, CLS < 0.1, accessibility ≥ 95.
