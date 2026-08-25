-- =====================================================================
-- Configurability Layer — TRIMMED
-- Only what earns money or prevents a fork. Apply after kindergarten-schema.sql
--
-- KEPT:    lookup values, feature flags, document templates   (~5 dev-days)
-- CUT:     custom fields, report registry, saved filters, dashboard layout
--          (~11 dev-days of permanent complexity, no near-term revenue)
-- =====================================================================

-- =====================================================================
-- 1. LOOKUP VALUES  — the one that directly makes money
--
-- Rule: an enum stays in code if code BRANCHES on it.
--       It becomes data only if the client's wording varies AND the
--       behaviour can be expressed as a fixed system_kind + config.
--
-- Categories deliberately limited to five. Everything else stays an enum:
--   payment_method  -> reconciliation logic branches on it
--   child_status    -> lifecycle logic branches on it
--   tariff kind     -> billing logic branches on it
--   incident type   -> free text is enough, nobody reports on it
-- =====================================================================

CREATE TABLE lookup_value (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    category     TEXT NOT NULL,
    code         TEXT NOT NULL,
    name_uz      TEXT NOT NULL,
    name_ru      TEXT NOT NULL,
    system_kind  TEXT NOT NULL,                  -- code branches on THIS, not on code
    config       JSONB NOT NULL DEFAULT '{}',
    sort_order   SMALLINT NOT NULL DEFAULT 0,
    is_system    BOOLEAN NOT NULL DEFAULT FALSE, -- renameable, not deletable
    active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_by   UUID,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, category, code),
    CHECK (category IN (
        'attendance_status',  -- system_kind: present|absent|excused   <- the money one
        'document_type',      -- system_kind: identity|medical|contract|consent|other
        'expense_type',       -- system_kind: utility|rent|service|other
        'relationship',       -- system_kind: parent|relative|other
        'discount_reason'     -- system_kind: informational
    ))
);
CREATE INDEX idx_lookup ON lookup_value(tenant_id, category, sort_order) WHERE active;

-- Why attendance_status pays for itself:
--   Client A charges per full day.
--   Client B wants half-day at 50%, and a "short day" at 75%.
--   With billing_weight in config, that is a data entry, not a release.
--   This is a sellable feature, not internal tidiness.

ALTER TABLE attendance_day ADD COLUMN status_id UUID REFERENCES lookup_value(id);
ALTER TABLE attendance_day ADD COLUMN status_kind TEXT;
ALTER TABLE attendance_day ADD COLUMN billing_weight NUMERIC(4,3) NOT NULL DEFAULT 1.000;

-- denormalise system_kind + weight onto the row so billing never joins
CREATE OR REPLACE FUNCTION sync_attendance_status_kind() RETURNS trigger AS $$
DECLARE lv RECORD;
BEGIN
    IF NEW.status_id IS NOT NULL THEN
        SELECT system_kind, config INTO lv FROM lookup_value WHERE id = NEW.status_id;
        NEW.status_kind    := lv.system_kind;
        NEW.billable       := COALESCE((lv.config->>'billable')::boolean, TRUE);
        NEW.billing_weight := COALESCE((lv.config->>'billing_weight')::numeric, 1.000);
    END IF;
    RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_att_status_kind
    BEFORE INSERT OR UPDATE OF status_id ON attendance_day
    FOR EACH ROW EXECUTE FUNCTION sync_attendance_status_kind();

CREATE INDEX idx_attendance_kind
    ON attendance_day(tenant_id, attendance_date, status_kind);

-- Billing reads SUM(billing_weight) WHERE billable, never a status name.

-- =====================================================================
-- 2. FEATURE FLAGS — cheapest item on the list, biggest commercial lever
--    One codebase, tiered packages. Prevents the branch-per-client death.
-- =====================================================================

CREATE TABLE feature_flag (
    tenant_id  UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    flag_key   TEXT NOT NULL,  -- expenses|telegram|imports|multi_branch|medical|pickup
    enabled    BOOLEAN NOT NULL DEFAULT TRUE,
    config     JSONB NOT NULL DEFAULT '{}',
    updated_by UUID,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, flag_key)
);

-- One guard, one table, half a day of work. Lets you sell "Basic" without
-- expenses/Telegram and "Full" with everything, from the same deployment.

-- =====================================================================
-- 3. DOCUMENT TEMPLATES — receipt and debt notice only
--    You must build a PDF pipeline anyway. Making it template-driven
--    instead of hardcoded costs almost nothing extra and removes the
--    single most common change request: "our logo and layout".
-- =====================================================================

CREATE TABLE document_template (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    template_key TEXT NOT NULL CHECK (template_key IN ('receipt','debt_notice')),
    version      INT NOT NULL DEFAULT 1,
    body_uz      TEXT NOT NULL,   -- Handlebars -> HTML -> PDF
    body_ru      TEXT NOT NULL,
    variables    TEXT[],          -- validated on save
    active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_by   UUID,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, template_key, version)
);
CREATE UNIQUE INDEX uq_doc_template_active
    ON document_template(tenant_id, template_key) WHERE active;

-- Versioned for the same reason billing rules are: a receipt reprinted in
-- 2028 must match the one issued in 2026.

-- =====================================================================
-- NOT BUILT — and the reason, so this decision is not silently reversed
--
-- custom fields (JSONB + field_definition)
--   ~4 days, and with no frontend they deliver nothing today: the API
--   just returns opaque JSONB. They then leak into validation, imports,
--   exports and reports forever. Revisit after client #1 is live, when
--   you know the three fields actually requested -- three real columns
--   will be cheaper and better than a framework.
--
-- report registry + saved filters
--   ~4 days. Break-even is around 15 custom reports; you will have ~20,
--   so the payoff is marginal and arrives late. Hardcode reports for
--   client #1 -- you need them fast anyway -- and build the registry only
--   if client #2 wants a materially different report set.
--
-- dashboard layout
--   ~2 days, pure cosmetics, zero revenue. A fixed per-role dashboard is
--   fine. Cut.
--
-- workflow engine / form builder / dynamic entities
--   Never. Each is a product in itself and turns the codebase into a
--   badly-implemented database. Decline these as new features with a
--   price attached, per the scope-control rules.
-- =====================================================================
