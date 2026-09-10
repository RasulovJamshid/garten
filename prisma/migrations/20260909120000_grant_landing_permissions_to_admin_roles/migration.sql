-- Backfill the landing CMS permissions onto existing tenants.
--
-- PermissionCatalogSyncService creates new catalog keys granted to nobody
-- (fail-closed, by design). That is correct for a genuinely new capability,
-- but it meant every tenant seeded before the landing CMS shipped had NO
-- role holding landing:manage / landing:publish — including Owner — so
-- every /landing admin endpoint answered 403 with no way to self-serve
-- except hand-editing role_permission. prisma/seed.ts grants them, but seed
-- is a bootstrap for a fresh database, not something you re-run in prod.
--
-- This grants them to exactly the roles seed.ts would have: the system
-- owner/director/administrator roles. Any tenant-defined role (e.g. a
-- content editor) is left alone — that is a decision for the tenant's
-- admin, made through the roles API.
--
-- Runs before the app boots, so the catalog rows the FK needs may not
-- exist yet; upsert them here with the same values the catalog carries.

INSERT INTO "permission" ("key", "perm_group", "description_uz", "description_ru", "allowed_scopes", "sensitive", "deprecated")
VALUES
  ('landing:manage', 'admin', 'Saytning bosh sahifasi kontentini tahrirlash', 'Редактирование контента главной страницы сайта', ARRAY['all'], false, false),
  ('landing:publish', 'admin', 'Bosh sahifa o‘zgarishlarini nashr qilish', 'Публикация изменений главной страницы', ARRAY['all'], true, false)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permission" ("role_id", "permission_key", "scope")
SELECT r."id", p."key", 'all'
FROM "role" r
CROSS JOIN (VALUES ('landing:manage'), ('landing:publish')) AS p("key")
WHERE r."is_system" = true
  AND r."code" IN ('owner', 'director', 'administrator')
ON CONFLICT ("role_id", "permission_key") DO NOTHING;

-- Grants are cached per (user, tenant permissions_version); without this
-- bump the new rows stay invisible until the 60s LRU entry expires.
UPDATE "tenant" SET "permissions_version" = "permissions_version" + 1;
