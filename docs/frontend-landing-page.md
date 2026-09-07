# Landing Page CMS — Frontend Spec

> Companion to `frontend-functional-spec.md` (§B23) and `frontend-integration-guide.md`. Those two
> still govern auth, the error envelope, permission gating and the typed client — this document only
> covers what is specific to the landing page module.
>
> **Field names are authoritative in `openapi.json`, not here.** Where this doc and the schema
> disagree, the schema wins. All paths below are relative to the base prefix
> `http://localhost:3010/api/v1`.

---

## 1. What you are building

Two separate consumers, one backend module:

| Consumer | Who uses it | Auth | What it reads |
|---|---|---|---|
| **Landing editor** | Staff, inside the existing admin app | JWT + permissions | the **draft** |
| **Marketing site** | Anonymous visitors | none | the **published snapshot** |

The mental model in one line: **a landing page is an ordered list of typed blocks; editors change
the draft; publishing freezes the draft into what visitors see.**

Three consequences that shape the UI:

1. **Nothing an editor does is live until they press Publish.** There is no "save and it's out
   there" path. Draft and live are different reads of different data.
2. **Blocks are typed.** A block's `content` shape is decided by its `type`, and the server
   validates it. The editor renders a different form per type.
3. **Every text field is multilingual** — `{uz, ru, en}`, each individually optional.

---

## 2. Permissions

| Permission | Grants |
|---|---|
| `landing:manage` | read the draft, add/edit/delete/reorder blocks, edit SEO, read version history |
| `landing:publish` | **Publish** and **Restore** |

They are separate on purpose: a content editor can prepare the whole page and still not be able to
push it to the public internet. **Hide (don't just disable) Publish and Restore for a user who
holds only `landing:manage`** — same rule as everywhere else in the app (`frontend-functional-spec.md`
§A2). Out of the box Owner, Director and Administrator hold both.

The public endpoints require no token at all. Do not send an `Authorization` header to them.

---

## 3. Block type catalog

**Do not hardcode this table.** `GET /landing/block-types` returns the live catalog, and adding a
section type server-side must not require a frontend release. The table is here so you know what to
design forms for today.

`i18n` below means the object `{ uz?: string, ru?: string, en?: string }`. `fileId` is a uuid from
`POST /files`. `?` marks optional.

| `type` | `content` shape |
|---|---|
| `hero` | `title: i18n`, `subtitle?: i18n`, `imageFileId?: fileId`, `ctaLabel?: i18n`, `ctaHref?: string` |
| `about` | `title?: i18n`, `body: i18n`, `imageFileId?: fileId` |
| `features` | `title?: i18n`, `items: { title: i18n, description?: i18n, icon?: string, imageFileId?: fileId }[]` (max 24) |
| `gallery` | `title?: i18n`, `images: { fileId: fileId, caption?: i18n }[]` (max 60) |
| `teachers` | `title?: i18n`, `people: { name: string, role?: i18n, bio?: i18n, photoFileId?: fileId }[]` (max 60) |
| `pricing` | `title?: i18n`, `note?: i18n`, `plans: { name: i18n, price: i18n, description?: i18n, highlighted?: boolean }[]` (max 12) |
| `testimonials` | `title?: i18n`, `items: { quote: i18n, author: string, role?: i18n, photoFileId?: fileId }[]` (max 30) |
| `faq` | `title?: i18n`, `items: { question: i18n, answer: i18n }[]` (max 50) |
| `contacts` | `title?: i18n`, `address?: i18n`, `phones?: string[]`, `email?: string`, `workingHours?: i18n`, `mapEmbedUrl?: url`, `social?: { platform: string, url: url }[]` |
| `cta` | `title: i18n`, `subtitle?: i18n`, `buttonLabel: i18n`, `buttonHref: string` |
| `stats` | `title?: i18n`, `items: { value: string, label: i18n }[]` (max 12) |

Notes that will save you a bug:

- **`pricing.price` is free marketing text, not money.** It is `i18n`, e.g.
  `{ru: "от 1 500 000 сум / месяц"}`. Do **not** run it through the tiyin money helpers — real
  tariffs are a different module entirely (§B11).
- **`stats.value` is a plain string** (`"12"`, `"7+"`, `"98%"`), deliberately not a number.
- Content objects are **strict**: an unknown key is a 422, not a silently ignored field. Send
  exactly the shape above.
- `type` is **immutable after creation**. To change a section's type, delete the block and add a
  new one.

---

## 4. Editor endpoints

All require `Authorization: Bearer <accessToken>`.

### `GET /landing` — the draft

The single read the editor screen is built on. Returns every locale intact (unlike the public
endpoint, which flattens to one).

```jsonc
{
  "id": "0f3c…",
  "slug": "home",
  "seo": { "title": {"ru": "…"}, "description": {"ru": "…"}, "ogImageFileId": "…" },
  "blocks": [
    {
      "id": "8a21…",
      "tenantId": "…",
      "pageId": "0f3c…",
      "type": "hero",
      "position": 0,
      "isVisible": true,
      "content": { "title": {"ru": "Детский сад «Солнышко»", "uz": "…"} },
      "fileIds": ["…"],          // derived server-side; read-only, never send it back
      "createdAt": "2026-09-04T09:10:00.000Z",
      "updatedAt": "2026-09-04T09:12:00.000Z",
      "updatedBy": "…"
    }
  ],
  "version": 3,                   // latest published version number
  "publishedAt": "2026-09-03T…",  // null if never published
  "publishedVersion": 3,          // null if never published
  "hasUnpublishedChanges": true
}
```

- Blocks come back **already sorted by `position`**. Render in array order.
- `hasUnpublishedChanges` drives the Publish button's enabled state and the navigate-away warning.
- A tenant that has never opened the editor gets a valid empty page here, not a 404 — no
  "create page" step to build.
- **This is also your preview source.** It is exactly what publishing would make live, so a
  "Preview" mode can render the draft with the same block components the marketing site uses.

### `GET /landing/block-types` — the form catalog

```jsonc
{
  "locales": ["uz", "ru", "en"],
  "types": [
    { "type": "hero", "fields": ["title", "subtitle", "imageFileId", "ctaLabel", "ctaHref"] },
    { "type": "about", "fields": ["title", "body", "imageFileId"] }
    // …
  ]
}
```

Use it to populate the "Add block" menu and to drive form rendering. Fetch it once per session.

### `POST /landing/blocks` → `201`

```jsonc
{
  "type": "hero",
  "content": { "title": { "ru": "Детский сад «Солнышко»" } },
  "position": 0,        // optional — defaults to the end of the page
  "isVisible": true     // optional — defaults to true
}
```

Returns the created block row (same shape as an entry in `GET /landing` → `blocks`).

### `PUT /landing/blocks/:id` → `200`

```jsonc
{ "content": { … }, "isVisible": false }
```

Both fields optional; send only what changed. `content` is validated against the block's **existing**
type. Sending `content` replaces it wholesale — there is no deep merge, so send the complete object.

Only these two keys are accepted. Echoing a whole block row back (with `id`, `type`, `fileIds`, …)
is rejected with a 400 by the global `forbidNonWhitelisted` validation, so pick the fields out
rather than spreading the object you fetched.

### `DELETE /landing/blocks/:id` → `200`

Removes it from the draft only. The live page keeps the block until the next publish, so this is
**not** an emergency "take it down" button — that is a delete followed by a publish.

### `PUT /landing/blocks/reorder` → `200`

```jsonc
{ "blocks": [ { "id": "8a21…", "position": 0 }, { "id": "b7f0…", "position": 1 } ] }
```

Send **every** block with its new position; applied in one transaction. Returns the reordered list.
A block id that is not on this page is a 404 for the whole call — nothing is applied.

### `PUT /landing/seo` → `200`

```jsonc
{
  "title": { "ru": "…", "uz": "…" },
  "description": { "ru": "…" },
  "ogImageFileId": "…",
  "canonicalUrl": "https://sunshine.uz"
}
```

### `POST /landing/publish` → `201`

```jsonc
// request (note optional)
{ "note": "Added the new teachers section" }
// response
{ "version": 4, "publishedAt": "2026-09-04T09:20:00.000Z", "blocks": 6 }
```

Freezes every **visible** block into the snapshot visitors read. Hidden blocks (`isVisible: false`)
are excluded — that is how you stage a section without showing it.

Requires `landing:publish`.

### `GET /landing/versions` → `200`

```jsonc
[ { "id": "…", "version": 4, "note": "…", "publishedAt": "…", "publishedBy": "…" } ]
```

Newest first. Snapshots are omitted here because they are large — fetch one with
`GET /landing/versions/:version`, which returns the row including its full `snapshot`.

### `POST /landing/versions/:version/restore` → `201`

```jsonc
{ "version": 5, "restoredFrom": 2, "publishedAt": "…" }
```

Replays that snapshot over the draft **and publishes it as a new version**. History is append-only,
so a restore is itself undoable.

**Two things to get right in the UI:**

1. Label it **"Restore"**, never "Roll back" — nothing is lost, and version numbers go up, not down.
2. **Restoring replaces the draft and gives every block a new `id`.** Any block id you were holding
   in component state is stale afterwards. Refetch `GET /landing` immediately.

Requires `landing:publish`.

---

## 5. Images

Landing images use the normal file upload (§B20) plus a **separate public read path**. The regular
`GET /files/:id` requires a token and is useless to an anonymous visitor — never point a public
`<img>` at it.

**Editor flow:**

1. `POST /files` (multipart, field name `file`) → `{ fileId, url, size, mime }`
2. Put `fileId` into the block's content field (`imageFileId`, `photoFileId`, or `images[].fileId`)
3. `PUT /landing/blocks/:id`
4. Publish

The server validates at step 3 that the file exists, belongs to the tenant, **and is an image** —
so a PDF in a gallery is a 422 at edit time, not a broken image on the live site.

**In the editor**, render previews with the authenticated `GET /files/:id` as you do elsewhere.
**On the marketing site**, use `mediaBaseUrl` from the public payload: `` `${mediaBaseUrl}/${fileId}` ``.

A file becomes publicly readable **only while a published block references it**. Uploading it does
not; putting it in a draft does not. Republish without it and it stops being readable. That means a
just-uploaded image is *not* fetchable from the public path until the next publish — expected, not a
bug.

---

## 6. Public endpoints (marketing site)

### `GET /public/landing/:tenantCode?lang=uz|ru|en` → `200`

No auth. `lang` defaults to `ru`.

```jsonc
{
  "slug": "home",
  "locale": "ru",
  "version": 4,
  "publishedAt": "2026-09-04T09:20:00.000Z",
  "seo": { "title": "…", "description": "…", "ogImageFileId": "…" },
  "blocks": [
    { "id": "8a21…", "type": "hero", "content": { "title": "Детский сад «Солнышко»", "subtitle": … } }
  ],
  "mediaBaseUrl": "/api/v1/public/landing/demo/media"
}
```

Differences from the editor payload, all deliberate:

- **Text is flattened to strings**, not `{uz, ru, en}` objects. One locale, resolved server-side.
- **Only visible blocks** appear, and only as `{id, type, content}` — no positions, timestamps or
  ids you don't need. Array order is display order.
- `mediaBaseUrl` already carries the API prefix; append a file id and use it against the API origin.

`GET /public/landing` (no code) serves the tenant named by `LANDING_DEFAULT_TENANT_CODE`, for
single-kindergarten deployments where the site shouldn't have to know a tenant code. It 404s if that
variable isn't set.

**404 means "no published page"** — for an unpublished page, an unknown tenant code, or a suspended
tenant, deliberately indistinguishable. Have the marketing site fall back to static content rather
than render a blank hero.

### `GET /public/landing/:tenantCode/media/:fileId`

No auth. Serves the image inline with a long `Cache-Control`. Use it directly as an `<img src>`.

### Caching and limits

- Both page routes return an **ETag** and `Cache-Control: public, max-age=60,
  stale-while-revalidate=600`. Send `If-None-Match` and handle `304`. The payload changes only when
  someone publishes, so a warm client should almost always get a 304.
- The page route is rate-limited to **60/min/IP** (media: 300/min/IP). Fetch once per page load and
  cache; don't refetch per component.
- `Content-Language` is set on the response.

### CORS

The marketing site is a different origin from the admin app, and the public landing routes are
**not** exempt from the allow-list. Its origin must be in the API's `CORS_ORIGINS` or every browser
call fails preflight. These responses carry no cookies — do **not** send `credentials: 'include'`
to the public endpoints (unlike `/auth/refresh`, which requires it).

---

## 7. Locales

- Authoring locales are `uz`, `ru`, `en` — read them from `GET /landing/block-types` → `locales`
  rather than hardcoding, since the set can grow.
- **Every locale on every field is optional.** A half-translated page is a valid, publishable state.
  Do not block Publish on missing translations; a soft "3 fields have no Uzbek text" hint is the
  right level of pressure.
- The public endpoint falls back **requested → ru → uz → en**, so a visitor sees the section in
  another language rather than an empty box. An empty string counts as missing.
- A field with no translation at all comes back as `null` in the public payload (the key stays, so
  the shape is stable). Handle `null` in every public block component.
- Editor UI: **locale tabs per field group**, not a single page-level language switch — editors
  work field by field, and a page-level switch makes them lose their place. Mark tabs that have
  missing values.

---

## 8. Errors

Standard envelope (`frontend-integration-guide.md` §5): `{ error: { code, message, details, traceId } }`.

| Status | `code` | When | What to do |
|---|---|---|---|
| 400 | `VALIDATION_FAILED` | request shape rejected by the DTO (e.g. unknown `type`) | shouldn't happen with a correct client — log it |
| 422 | `VALIDATION_FAILED` | **block content rejected by its type's schema** | `details` is `[{path, message}]` — map each `path` onto the offending form field |
| 403 | `FORBIDDEN` | publish/restore without `landing:publish` | you shouldn't have shown the button |
| 404 | `NOT_FOUND` | unknown block/version; public: no published page | — |
| 429 | `RATE_LIMITED` | public endpoint hammered | back off, cache |

The 422 `details` array is the one worth wiring properly — `path` is dot/index notation matching the
content object, e.g. `items.2.question`, so it maps straight onto a repeatable-field form.

---

## 9. Editor screen — requirements checklist

- [ ] Block list in display order, drag-to-reorder, saving via `PUT /landing/blocks/reorder`
- [ ] Per-block: show/hide toggle (`isVisible`), edit, delete, with hidden blocks visually distinct
      and labelled "not published"
- [ ] "Add block" menu built from `GET /landing/block-types`
- [ ] Per-type form, with repeatable sub-item lists (add/remove/reorder) for `features`, `gallery`,
      `teachers`, `pricing`, `testimonials`, `faq`, `stats`
- [ ] Locale tabs per text field; missing-translation indicators
- [ ] Image picker reusing the existing upload component; store `fileId`, preview via `/files/:id`
- [ ] SEO panel (`PUT /landing/seo`) with an OG-image preview
- [ ] Preview mode rendering the draft with the public block components
- [ ] Publish button gated on `landing:publish`, enabled by `hasUnpublishedChanges`, with an
      optional note field, and a confirmation that says this goes live to the public
- [ ] Version history drawer: list, view a snapshot, Restore (gated on `landing:publish`), with a
      refetch of `GET /landing` after restoring
- [ ] Navigate-away warning while `hasUnpublishedChanges` is true
- [ ] 422 `details` mapped back onto form fields

---

## 10. Gotchas, collected

1. **Publishing is the only thing that changes the live site.** Saving a block does not.
2. **Deleting a block does not take it off the live site** until the next publish.
3. **Restore replaces every block id.** Refetch after it.
4. **`type` cannot be changed** after a block is created.
5. **`content` is replaced, not merged**, on `PUT /landing/blocks/:id`.
6. **A newly uploaded image is not publicly fetchable until the publish that references it.**
7. **`pricing.price` is not money.** Don't format it with the tiyin helpers.
8. **Don't send `credentials: 'include'` or an `Authorization` header to `/public/*`.**
9. **`fileIds` on a block is server-derived.** It is read-only, and the global ValidationPipe runs
   with `forbidNonWhitelisted`, so echoing a fetched block straight back into a `PUT` is a **400**,
   not a no-op. Send only `content` and `isVisible`.
