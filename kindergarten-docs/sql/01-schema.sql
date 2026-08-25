-- =====================================================================
-- Kindergarten Management System — Complete DDL
-- PostgreSQL 16
-- Conventions:
--   * every domain table carries tenant_id (multi-tenant seam)
--   * money is BIGINT tiyin (1 som = 100 tiyin), never float
--   * all timestamps TIMESTAMPTZ; calendar dates DATE in Asia/Tashkent
--   * financial tables are append-only: no deleted_at, corrections are
--     reversing rows (sign = -1)
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "btree_gist";

-- =====================================================================
-- 1. TENANT / ORGANIZATION
-- =====================================================================

CREATE TABLE tenant (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code                TEXT NOT NULL UNIQUE,
    name                TEXT NOT NULL,
    permissions_version INT  NOT NULL DEFAULT 1,
    status              TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','suspended','archived')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE branch (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
    code          TEXT NOT NULL,
    name          TEXT NOT NULL,
    address       TEXT,
    phone         TEXT,
    timezone      TEXT NOT NULL DEFAULT 'Asia/Tashkent',
    status        TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','closed')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at    TIMESTAMPTZ,
    UNIQUE (tenant_id, code)
);
CREATE INDEX idx_branch_tenant ON branch(tenant_id) WHERE deleted_at IS NULL;

CREATE TABLE setting (
    tenant_id            UUID PRIMARY KEY REFERENCES tenant(id) ON DELETE CASCADE,
    display_name         TEXT NOT NULL,
    logo_file_id         UUID,
    address              TEXT,
    phones               TEXT[],
    bank_details         JSONB,
    tax_info             JSONB,
    working_days         SMALLINT[] NOT NULL DEFAULT '{1,2,3,4,5}', -- ISO 1=Mon
    working_hours        JSONB,        -- { "open": "07:00", "close": "19:00" }
    default_language     TEXT NOT NULL DEFAULT 'ru' CHECK (default_language IN ('uz','ru')),
    currency             TEXT NOT NULL DEFAULT 'UZS',
    timezone             TEXT NOT NULL DEFAULT 'Asia/Tashkent',
    receipt_number_format TEXT NOT NULL DEFAULT 'R-{YYYY}-{SEQ:6}',
    payment_due_day      SMALLINT NOT NULL DEFAULT 5
                         CHECK (payment_due_day BETWEEN 1 AND 28),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by           UUID
);

CREATE TABLE holiday (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    branch_id   UUID REFERENCES branch(id) ON DELETE CASCADE,  -- NULL = all branches
    holiday_date DATE NOT NULL,
    name        TEXT NOT NULL,
    is_working  BOOLEAN NOT NULL DEFAULT FALSE, -- TRUE = working Saturday override
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_holiday ON holiday(tenant_id, COALESCE(branch_id,'00000000-0000-0000-0000-000000000000'::uuid), holiday_date);

-- =====================================================================
-- 2. RBAC
-- =====================================================================

-- synced from the code catalog on boot; users never write here
CREATE TABLE permission (
    key             TEXT PRIMARY KEY,
    perm_group      TEXT NOT NULL,
    description_uz  TEXT,
    description_ru  TEXT,
    allowed_scopes  TEXT[] NOT NULL DEFAULT '{all}',
    sensitive       BOOLEAN NOT NULL DEFAULT FALSE,
    deprecated      BOOLEAN NOT NULL DEFAULT FALSE,
    synced_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE role (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    code          TEXT NOT NULL,
    name_uz       TEXT NOT NULL,
    name_ru       TEXT NOT NULL,
    description   TEXT,
    is_system     BOOLEAN NOT NULL DEFAULT FALSE,
    is_protected  BOOLEAN NOT NULL DEFAULT FALSE,
    created_by    UUID,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, code)
);

CREATE TABLE role_permission (
    role_id        UUID NOT NULL REFERENCES role(id) ON DELETE CASCADE,
    permission_key TEXT NOT NULL REFERENCES permission(key) ON DELETE RESTRICT,
    scope          TEXT NOT NULL DEFAULT 'all'
                   CHECK (scope IN ('all','branch','own_group','today','self')),
    granted_by     UUID,
    granted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (role_id, permission_key)
);

CREATE TABLE app_user (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
    full_name      TEXT NOT NULL,
    username       TEXT,
    email          TEXT,
    phone          TEXT NOT NULL,
    password_hash  TEXT NOT NULL,
    language       TEXT NOT NULL DEFAULT 'ru' CHECK (language IN ('uz','ru')),
    status         TEXT NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active','inactive','locked')),
    failed_attempts SMALLINT NOT NULL DEFAULT 0,
    locked_until   TIMESTAMPTZ,
    last_login_at  TIMESTAMPTZ,
    created_by     UUID,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at     TIMESTAMPTZ,
    -- tenant-scoped uniqueness: keeps shared-infrastructure multi-tenancy possible
    UNIQUE (tenant_id, phone),
    UNIQUE (tenant_id, email),
    UNIQUE (tenant_id, username)
);

CREATE TABLE user_branch (
    user_id   UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    branch_id UUID NOT NULL REFERENCES branch(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, branch_id)
);

CREATE TABLE user_role (
    user_id    UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    role_id    UUID NOT NULL REFERENCES role(id) ON DELETE RESTRICT,
    branch_id  UUID REFERENCES branch(id) ON DELETE CASCADE, -- NULL = all
    granted_by UUID,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, role_id, branch_id)
);
-- PK with nullable branch_id needs a partial unique index for the NULL case
CREATE UNIQUE INDEX uq_user_role_allbranch
    ON user_role(user_id, role_id) WHERE branch_id IS NULL;

CREATE TABLE user_permission_override (
    user_id        UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    permission_key TEXT NOT NULL REFERENCES permission(key),
    scope          TEXT NOT NULL DEFAULT 'all',
    effect         TEXT NOT NULL CHECK (effect IN ('grant','deny')),
    reason         TEXT NOT NULL,
    valid_until    TIMESTAMPTZ,
    granted_by     UUID NOT NULL,
    granted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, permission_key)
);

CREATE TABLE user_session (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    user_id           UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    refresh_token_hash TEXT NOT NULL,
    user_agent        TEXT,
    ip_address        INET,
    expires_at        TIMESTAMPTZ NOT NULL,
    revoked_at        TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_session_user ON user_session(user_id) WHERE revoked_at IS NULL;

CREATE TABLE login_attempt (
    id         BIGSERIAL PRIMARY KEY,
    tenant_id  UUID,
    login      TEXT NOT NULL,
    success    BOOLEAN NOT NULL,
    ip_address INET,
    user_agent TEXT,
    attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_login_attempt_time ON login_attempt(attempted_at DESC);

-- =====================================================================
-- 3. CHILDREN, GUARDIANS
-- =====================================================================

CREATE TABLE child (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
    branch_id         UUID NOT NULL REFERENCES branch(id) ON DELETE RESTRICT,
    first_name        TEXT NOT NULL,
    last_name         TEXT NOT NULL,
    middle_name       TEXT,
    photo_file_id     UUID,
    birth_date        DATE NOT NULL,
    gender            TEXT CHECK (gender IN ('male','female')),
    address           TEXT,
    enrollment_date   DATE,
    withdrawal_date   DATE,
    contract_number   TEXT,
    registration_number TEXT,
    status            TEXT NOT NULL DEFAULT 'applicant'
                      CHECK (status IN ('applicant','active','temporarily_absent',
                                        'suspended','graduated','withdrawn','archived')),
    note              TEXT,
    created_by        UUID,
    updated_by        UUID,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at        TIMESTAMPTZ,
    UNIQUE (tenant_id, registration_number)
);
CREATE INDEX idx_child_tenant_status ON child(tenant_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_child_branch ON child(branch_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_child_name_trgm ON child(tenant_id, last_name, first_name);

CREATE TABLE child_status_history (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    child_id       UUID NOT NULL REFERENCES child(id) ON DELETE CASCADE,
    old_status     TEXT,
    new_status     TEXT NOT NULL,
    effective_date DATE NOT NULL,
    reason         TEXT,
    changed_by     UUID NOT NULL,
    changed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_child_status_hist ON child_status_history(child_id, effective_date DESC);

CREATE TABLE guardian (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id          UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
    full_name          TEXT NOT NULL,
    phone              TEXT NOT NULL,        -- normalized +998XXXXXXXXX
    phone_alt          TEXT,
    telegram_phone     TEXT,
    email              TEXT,
    address            TEXT,
    workplace          TEXT,
    passport_number    TEXT,
    preferred_language TEXT NOT NULL DEFAULT 'ru' CHECK (preferred_language IN ('uz','ru')),
    created_by         UUID,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at         TIMESTAMPTZ,
    UNIQUE (tenant_id, phone)   -- prevents duplicate-parent-per-child
);

CREATE TABLE child_guardian (
    tenant_id            UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    child_id             UUID NOT NULL REFERENCES child(id) ON DELETE CASCADE,
    guardian_id          UUID NOT NULL REFERENCES guardian(id) ON DELETE RESTRICT,
    relationship         TEXT NOT NULL,   -- mother/father/grandmother/...
    is_payer             BOOLEAN NOT NULL DEFAULT FALSE,
    is_emergency_contact BOOLEAN NOT NULL DEFAULT FALSE,
    is_primary_contact   BOOLEAN NOT NULL DEFAULT FALSE,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (child_id, guardian_id)
);
CREATE INDEX idx_child_guardian_g ON child_guardian(guardian_id);
-- at most one primary contact per child
CREATE UNIQUE INDEX uq_primary_contact ON child_guardian(child_id)
    WHERE is_primary_contact;

CREATE TABLE child_document (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    child_id      UUID NOT NULL REFERENCES child(id) ON DELETE CASCADE,
    doc_type      TEXT NOT NULL
                  CHECK (doc_type IN ('birth_certificate','parent_passport',
                        'medical_certificate','contract','consent','other')),
    number        TEXT,
    issue_date    DATE,
    expiry_date   DATE,
    file_id       UUID,
    verified      BOOLEAN NOT NULL DEFAULT FALSE,
    verified_by   UUID,
    verified_at   TIMESTAMPTZ,
    note          TEXT,
    created_by    UUID,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at    TIMESTAMPTZ
);
CREATE INDEX idx_doc_expiry ON child_document(tenant_id, expiry_date)
    WHERE deleted_at IS NULL AND expiry_date IS NOT NULL;

CREATE TABLE consent (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    child_id      UUID NOT NULL REFERENCES child(id) ON DELETE CASCADE,
    guardian_id   UUID NOT NULL REFERENCES guardian(id) ON DELETE RESTRICT,
    consent_type  TEXT NOT NULL
                  CHECK (consent_type IN ('personal_data','photography',
                        'medical_storage','notifications','mobile_access')),
    granted       BOOLEAN NOT NULL,
    granted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at    TIMESTAMPTZ,
    evidence_file_id UUID
);
CREATE UNIQUE INDEX uq_consent ON consent(child_id, guardian_id, consent_type)
    WHERE revoked_at IS NULL;

-- =====================================================================
-- 4. MEDICAL
-- =====================================================================

CREATE TABLE medical_record (
    child_id              UUID PRIMARY KEY REFERENCES child(id) ON DELETE CASCADE,
    tenant_id             UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    blood_type            TEXT,
    chronic_conditions    TEXT,
    emergency_instructions TEXT,
    doctor_name           TEXT,
    doctor_phone          TEXT,
    clinic                TEXT,
    note                  TEXT,
    updated_by            UUID,
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE allergy (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    child_id    UUID NOT NULL REFERENCES child(id) ON DELETE CASCADE,
    allergen    TEXT NOT NULL,
    severity    TEXT NOT NULL DEFAULT 'moderate'
                CHECK (severity IN ('mild','moderate','severe','anaphylactic')),
    reaction    TEXT,
    instruction TEXT,          -- shown as the reception/teacher alert
    created_by  UUID,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at  TIMESTAMPTZ
);
CREATE INDEX idx_allergy_child ON allergy(child_id) WHERE deleted_at IS NULL;

CREATE TABLE medication (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    child_id     UUID NOT NULL REFERENCES child(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    dosage       TEXT,
    schedule     TEXT,
    valid_from   DATE,
    valid_to     DATE,
    prescribed_by TEXT,
    created_by   UUID,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at   TIMESTAMPTZ
);

CREATE TABLE health_incident (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    child_id     UUID NOT NULL REFERENCES child(id) ON DELETE CASCADE,
    occurred_at  TIMESTAMPTZ NOT NULL,
    description  TEXT NOT NULL,
    action_taken TEXT,
    guardian_notified BOOLEAN NOT NULL DEFAULT FALSE,
    recorded_by  UUID NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================================
-- 5. GROUPS
-- =====================================================================

CREATE TABLE child_group (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
    branch_id      UUID NOT NULL REFERENCES branch(id) ON DELETE RESTRICT,
    name           TEXT NOT NULL,
    age_min_months SMALLINT,
    age_max_months SMALLINT,
    capacity       SMALLINT NOT NULL DEFAULT 20 CHECK (capacity > 0),
    working_hours  JSONB,
    status         TEXT NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active','archived')),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at     TIMESTAMPTZ,
    UNIQUE (tenant_id, branch_id, name)
);

CREATE TABLE group_staff (
    tenant_id  UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    group_id   UUID NOT NULL REFERENCES child_group(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    staff_role TEXT NOT NULL CHECK (staff_role IN ('main_teacher','assistant','nurse')),
    assigned_from DATE NOT NULL DEFAULT CURRENT_DATE,
    assigned_to   DATE,
    PRIMARY KEY (group_id, user_id, staff_role)
);
CREATE INDEX idx_group_staff_user ON group_staff(user_id) WHERE assigned_to IS NULL;

CREATE TABLE group_assignment (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    child_id       UUID NOT NULL REFERENCES child(id) ON DELETE CASCADE,
    group_id       UUID NOT NULL REFERENCES child_group(id) ON DELETE RESTRICT,
    effective_from DATE NOT NULL,
    effective_to   DATE,
    reason         TEXT,
    assigned_by    UUID,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
-- a child can only be in one group at a time
ALTER TABLE group_assignment ADD CONSTRAINT no_overlapping_group
    EXCLUDE USING gist (
        child_id WITH =,
        daterange(effective_from, COALESCE(effective_to, 'infinity'::date), '[]') WITH &&
    );
CREATE INDEX idx_group_assignment_current ON group_assignment(group_id)
    WHERE effective_to IS NULL;

-- =====================================================================
-- 6. ATTENDANCE
-- =====================================================================

CREATE TABLE attendance_day (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    branch_id         UUID NOT NULL REFERENCES branch(id) ON DELETE RESTRICT,
    child_id          UUID NOT NULL REFERENCES child(id) ON DELETE CASCADE,
    group_id          UUID REFERENCES child_group(id) ON DELETE SET NULL,
    attendance_date   DATE NOT NULL,          -- computed in Asia/Tashkent
    status            TEXT NOT NULL DEFAULT 'present'
                      CHECK (status IN ('present','absent','sick','vacation',
                                        'excused','late','early_departure')),
    check_in_at       TIMESTAMPTZ,
    check_in_by       UUID,
    check_in_note     TEXT,
    health_observation TEXT,
    check_out_at      TIMESTAMPTZ,
    check_out_by      UUID,
    check_out_note    TEXT,
    pickup_person_id  UUID,
    pickup_permission_id UUID,
    billable          BOOLEAN NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- the constraint that makes offline replay safe
    UNIQUE (tenant_id, child_id, attendance_date),
    CHECK (check_out_at IS NULL OR check_in_at IS NULL OR check_out_at >= check_in_at)
);
CREATE INDEX idx_attendance_date  ON attendance_day(tenant_id, attendance_date);
CREATE INDEX idx_attendance_group ON attendance_day(group_id, attendance_date);
CREATE INDEX idx_attendance_inside ON attendance_day(tenant_id, attendance_date)
    WHERE check_in_at IS NOT NULL AND check_out_at IS NULL;
CREATE INDEX idx_attendance_child_billing
    ON attendance_day(child_id, attendance_date) WHERE billable;

CREATE TABLE attendance_correction (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    attendance_day_id UUID NOT NULL REFERENCES attendance_day(id) ON DELETE CASCADE,
    field             TEXT NOT NULL,
    old_value         TEXT,
    new_value         TEXT,
    reason            TEXT NOT NULL CHECK (length(reason) >= 10),
    corrected_by      UUID NOT NULL,
    corrected_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_att_corr_time ON attendance_correction(tenant_id, corrected_at DESC);

-- =====================================================================
-- 7. PICKUP AUTHORIZATION
-- =====================================================================

CREATE TABLE pickup_person (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    child_id        UUID NOT NULL REFERENCES child(id) ON DELETE CASCADE,
    guardian_id     UUID REFERENCES guardian(id) ON DELETE SET NULL,
    full_name       TEXT NOT NULL,
    relationship    TEXT,
    phone           TEXT,
    photo_file_id   UUID,
    id_doc_type     TEXT,
    id_doc_number   TEXT,
    note            TEXT,
    granted_by_guardian_id UUID REFERENCES guardian(id),
    created_by      UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at      TIMESTAMPTZ,
    revoke_reason   TEXT
);
CREATE INDEX idx_pickup_person_child ON pickup_person(child_id) WHERE revoked_at IS NULL;

CREATE TABLE pickup_permission (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    child_id         UUID NOT NULL REFERENCES child(id) ON DELETE CASCADE,
    pickup_person_id UUID REFERENCES pickup_person(id) ON DELETE CASCADE,
    permission_type  TEXT NOT NULL CHECK (permission_type IN ('permanent','temporary')),
    -- for one-off people not stored as pickup_person
    adhoc_full_name  TEXT,
    adhoc_phone      TEXT,
    adhoc_id_number  TEXT,
    valid_from       DATE NOT NULL,
    valid_to         DATE,
    one_time_code_hash TEXT,           -- future PIN/QR support
    used_at          TIMESTAMPTZ,
    reason           TEXT,
    granted_by_guardian_id UUID REFERENCES guardian(id),
    created_by       UUID,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at       TIMESTAMPTZ,
    CHECK (valid_to IS NULL OR valid_to >= valid_from),
    CHECK (pickup_person_id IS NOT NULL OR adhoc_full_name IS NOT NULL)
);
CREATE INDEX idx_pickup_perm_active ON pickup_permission(child_id, valid_from, valid_to)
    WHERE revoked_at IS NULL;

ALTER TABLE attendance_day
    ADD CONSTRAINT fk_att_pickup_person
    FOREIGN KEY (pickup_person_id) REFERENCES pickup_person(id) ON DELETE SET NULL;
ALTER TABLE attendance_day
    ADD CONSTRAINT fk_att_pickup_perm
    FOREIGN KEY (pickup_permission_id) REFERENCES pickup_permission(id) ON DELETE SET NULL;

-- =====================================================================
-- 8. FINANCE — append-only ledger
-- =====================================================================

CREATE TABLE accounting_period (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    year       SMALLINT NOT NULL,
    month      SMALLINT NOT NULL CHECK (month BETWEEN 1 AND 12),
    status     TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
    closed_at  TIMESTAMPTZ,
    closed_by  UUID,
    reopened_at TIMESTAMPTZ,
    reopened_by UUID,
    reopen_reason TEXT,
    UNIQUE (tenant_id, year, month)
);

CREATE TABLE billing_rules (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    version        INT NOT NULL,
    effective_from DATE NOT NULL,
    effective_to   DATE,
    rules          JSONB NOT NULL,
    note           TEXT,
    created_by     UUID,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, version)
);
ALTER TABLE billing_rules ADD CONSTRAINT no_overlapping_rules
    EXCLUDE USING gist (
        tenant_id WITH =,
        daterange(effective_from, COALESCE(effective_to, 'infinity'::date), '[]') WITH &&
    );

CREATE TABLE tariff (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    branch_id     UUID REFERENCES branch(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    kind          TEXT NOT NULL
                  CHECK (kind IN ('monthly_fixed','full_day','half_day','group_based',
                                  'attendance_based','meal','transport','extra_class',
                                  'registration_fee')),
    amount_tiyin  BIGINT NOT NULL CHECK (amount_tiyin >= 0),
    active        BOOLEAN NOT NULL DEFAULT TRUE,
    created_by    UUID,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE child_tariff (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    child_id       UUID NOT NULL REFERENCES child(id) ON DELETE CASCADE,
    tariff_id      UUID NOT NULL REFERENCES tariff(id) ON DELETE RESTRICT,
    effective_from DATE NOT NULL,
    effective_to   DATE,
    assigned_by    UUID,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX idx_child_tariff ON child_tariff(child_id, effective_from DESC);

CREATE TABLE discount (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    child_id     UUID NOT NULL REFERENCES child(id) ON DELETE CASCADE,
    kind         TEXT NOT NULL CHECK (kind IN ('fixed','percent')),
    value_tiyin  BIGINT CHECK (value_tiyin IS NULL OR value_tiyin >= 0),
    value_bp     INT CHECK (value_bp IS NULL OR (value_bp >= 0 AND value_bp <= 10000)),
    valid_from   DATE NOT NULL,
    valid_to     DATE,
    reason       TEXT NOT NULL,
    approved_by  UUID,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at   TIMESTAMPTZ,
    CHECK ((kind = 'fixed'   AND value_tiyin IS NOT NULL)
        OR (kind = 'percent' AND value_bp    IS NOT NULL))
);
CREATE INDEX idx_discount_child ON discount(child_id) WHERE revoked_at IS NULL;

CREATE TABLE billing_run (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    period_id       UUID NOT NULL REFERENCES accounting_period(id) ON DELETE RESTRICT,
    billing_rules_id UUID NOT NULL REFERENCES billing_rules(id),
    status          TEXT NOT NULL DEFAULT 'preview'
                    CHECK (status IN ('preview','committed','failed','discarded')),
    idempotency_key TEXT,
    child_count     INT,
    total_tiyin     BIGINT,
    preview_data    JSONB,
    created_by      UUID NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    committed_at    TIMESTAMPTZ,
    error           TEXT
);
-- only one committed run per period, ever
CREATE UNIQUE INDEX uq_billing_run_committed
    ON billing_run(tenant_id, period_id) WHERE status = 'committed';
CREATE UNIQUE INDEX uq_billing_idem
    ON billing_run(tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- IMMUTABLE. no deleted_at. corrections are sign = -1 rows.
CREATE TABLE charge (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
    branch_id        UUID NOT NULL REFERENCES branch(id) ON DELETE RESTRICT,
    child_id         UUID NOT NULL REFERENCES child(id) ON DELETE RESTRICT,
    period_id        UUID NOT NULL REFERENCES accounting_period(id) ON DELETE RESTRICT,
    billing_run_id   UUID REFERENCES billing_run(id),
    billing_rules_id UUID REFERENCES billing_rules(id),
    kind             TEXT NOT NULL
                     CHECK (kind IN ('monthly_fixed','full_day','half_day','group_based',
                                     'attendance_based','meal','transport','extra_class',
                                     'registration_fee','manual','adjustment')),
    amount_tiyin     BIGINT NOT NULL CHECK (amount_tiyin >= 0),
    sign             SMALLINT NOT NULL DEFAULT 1 CHECK (sign IN (1,-1)),
    source_charge_id UUID REFERENCES charge(id),
    tariff_snapshot  JSONB,
    calculation_trace JSONB,
    description      TEXT,
    due_date         DATE,
    issued_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by       UUID,
    reversal_reason  TEXT,
    CHECK (sign = 1 OR source_charge_id IS NOT NULL)
);
-- prevents double-charging the same child for the same thing in the same period
CREATE UNIQUE INDEX uq_charge_once
    ON charge(tenant_id, child_id, period_id, kind) WHERE sign = 1 AND kind <> 'manual';
CREATE INDEX idx_charge_child   ON charge(child_id, issued_at DESC);
CREATE INDEX idx_charge_period  ON charge(tenant_id, period_id);

-- IMMUTABLE.
CREATE TABLE payment (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
    branch_id         UUID NOT NULL REFERENCES branch(id) ON DELETE RESTRICT,
    child_id          UUID NOT NULL REFERENCES child(id) ON DELETE RESTRICT,
    payer_guardian_id UUID REFERENCES guardian(id),
    amount_tiyin      BIGINT NOT NULL CHECK (amount_tiyin > 0),
    sign              SMALLINT NOT NULL DEFAULT 1 CHECK (sign IN (1,-1)),
    method            TEXT NOT NULL
                      CHECK (method IN ('cash','bank','card','online','other')),
    source_payment_id UUID REFERENCES payment(id),
    receipt_no        TEXT,
    bank_ref          TEXT,
    paid_at           TIMESTAMPTZ NOT NULL,
    attachment_file_id UUID,
    note              TEXT,
    cancel_reason     TEXT,
    idempotency_key   TEXT,
    recorded_by       UUID NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (sign = 1 OR source_payment_id IS NOT NULL)
);
CREATE UNIQUE INDEX uq_payment_receipt ON payment(tenant_id, receipt_no)
    WHERE receipt_no IS NOT NULL;
CREATE UNIQUE INDEX uq_payment_idem ON payment(tenant_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_payment_child ON payment(child_id, paid_at DESC);
CREATE INDEX idx_payment_date  ON payment(tenant_id, paid_at DESC);

CREATE TABLE payment_allocation (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
    payment_id   UUID NOT NULL REFERENCES payment(id) ON DELETE RESTRICT,
    charge_id    UUID NOT NULL REFERENCES charge(id) ON DELETE RESTRICT,
    amount_tiyin BIGINT NOT NULL CHECK (amount_tiyin > 0),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (payment_id, charge_id)
);
CREATE INDEX idx_alloc_charge ON payment_allocation(charge_id);

-- =====================================================================
-- 9. EXPENSES (replaces the full utilities module in Stage 1)
-- =====================================================================

CREATE TABLE expense (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    branch_id      UUID NOT NULL REFERENCES branch(id) ON DELETE RESTRICT,
    expense_type   TEXT NOT NULL
                   CHECK (expense_type IN ('electricity','gas','cold_water','hot_water',
                          'heating','waste','internet','telephone','security','rent','other')),
    provider       TEXT,
    contract_number TEXT,
    billing_year   SMALLINT NOT NULL,
    billing_month  SMALLINT NOT NULL CHECK (billing_month BETWEEN 1 AND 12),
    invoice_number TEXT,
    amount_tiyin   BIGINT NOT NULL CHECK (amount_tiyin >= 0),
    due_date       DATE,
    status         TEXT NOT NULL DEFAULT 'unpaid'
                   CHECK (status IN ('unpaid','paid','cancelled')),
    paid_at        TIMESTAMPTZ,
    paid_amount_tiyin BIGINT,
    attachment_file_id UUID,
    receipt_file_id    UUID,
    note           TEXT,
    created_by     UUID,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_expense_period ON expense(tenant_id, billing_year, billing_month);
CREATE INDEX idx_expense_unpaid ON expense(tenant_id, due_date) WHERE status = 'unpaid';

-- =====================================================================
-- 10. COMMUNICATION
-- =====================================================================

CREATE TABLE telegram_binding (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    guardian_id     UUID REFERENCES guardian(id) ON DELETE CASCADE,
    user_id         UUID REFERENCES app_user(id) ON DELETE CASCADE,
    chat_id         BIGINT NOT NULL,
    telegram_username TEXT,
    language        TEXT NOT NULL DEFAULT 'ru',
    bound_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    unbound_at      TIMESTAMPTZ,
    blocked_bot     BOOLEAN NOT NULL DEFAULT FALSE,
    CHECK (guardian_id IS NOT NULL OR user_id IS NOT NULL)
);
CREATE UNIQUE INDEX uq_tg_chat ON telegram_binding(tenant_id, chat_id)
    WHERE unbound_at IS NULL;
CREATE UNIQUE INDEX uq_tg_guardian ON telegram_binding(guardian_id)
    WHERE unbound_at IS NULL AND guardian_id IS NOT NULL;

CREATE TABLE telegram_link_token (
    token        TEXT PRIMARY KEY,
    tenant_id    UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    guardian_id  UUID REFERENCES guardian(id) ON DELETE CASCADE,
    user_id      UUID REFERENCES app_user(id) ON DELETE CASCADE,
    expires_at   TIMESTAMPTZ NOT NULL,
    used_at      TIMESTAMPTZ,
    created_by   UUID,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE notification_template (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    template_key TEXT NOT NULL,
    body_uz     TEXT NOT NULL,
    body_ru     TEXT NOT NULL,
    variables   TEXT[],
    enabled     BOOLEAN NOT NULL DEFAULT TRUE,
    updated_by  UUID,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, template_key)
);

CREATE TABLE announcement (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    branch_id    UUID REFERENCES branch(id) ON DELETE CASCADE,
    title        TEXT NOT NULL,
    body         TEXT NOT NULL,
    priority     TEXT NOT NULL DEFAULT 'normal'
                 CHECK (priority IN ('low','normal','high','emergency')),
    audience_type TEXT NOT NULL
                 CHECK (audience_type IN ('all','group','children','guardians','staff')),
    audience_ids UUID[],
    file_ids     UUID[],
    publish_at   TIMESTAMPTZ,
    expires_at   TIMESTAMPTZ,
    published_at TIMESTAMPTZ,
    created_by   UUID NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at   TIMESTAMPTZ
);

CREATE TABLE notification (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    template_key   TEXT,
    announcement_id UUID REFERENCES announcement(id) ON DELETE CASCADE,
    recipient_guardian_id UUID REFERENCES guardian(id) ON DELETE CASCADE,
    recipient_user_id     UUID REFERENCES app_user(id) ON DELETE CASCADE,
    channel        TEXT NOT NULL CHECK (channel IN ('telegram','sms','internal','email')),
    language       TEXT NOT NULL DEFAULT 'ru',
    rendered_body  TEXT NOT NULL,
    payload        JSONB,
    dedup_key      TEXT,
    status         TEXT NOT NULL DEFAULT 'queued'
                   CHECK (status IN ('queued','sent','delivered','failed','skipped')),
    attempts       SMALLINT NOT NULL DEFAULT 0,
    last_error     TEXT,
    queued_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at        TIMESTAMPTZ,
    delivered_at   TIMESTAMPTZ,
    read_at        TIMESTAMPTZ
);
CREATE UNIQUE INDEX uq_notification_dedup ON notification(tenant_id, dedup_key)
    WHERE dedup_key IS NOT NULL;
CREATE INDEX idx_notification_status ON notification(tenant_id, status, queued_at);
CREATE INDEX idx_notification_recipient ON notification(recipient_guardian_id, queued_at DESC);

-- =====================================================================
-- 11. FILES, IMPORTS, AUDIT
-- =====================================================================

CREATE TABLE file (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    bucket       TEXT NOT NULL,
    object_key   TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime_type    TEXT NOT NULL,
    size_bytes   BIGINT NOT NULL,
    checksum     TEXT,
    entity_type  TEXT,
    entity_id    UUID,
    uploaded_by  UUID NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at   TIMESTAMPTZ,
    UNIQUE (bucket, object_key)
);
CREATE INDEX idx_file_entity ON file(entity_type, entity_id) WHERE deleted_at IS NULL;

CREATE TABLE import_job (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    entity       TEXT NOT NULL,
    file_id      UUID REFERENCES file(id),
    status       TEXT NOT NULL DEFAULT 'validating'
                 CHECK (status IN ('validating','validated','committing','completed','failed')),
    total_rows   INT,
    valid_rows   INT,
    failed_rows  INT,
    errors       JSONB,
    created_by   UUID NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ
);

CREATE TABLE export_job (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    report_key   TEXT NOT NULL,
    format       TEXT NOT NULL CHECK (format IN ('xlsx','pdf','csv')),
    params       JSONB,
    status       TEXT NOT NULL DEFAULT 'processing'
                 CHECK (status IN ('processing','completed','failed')),
    file_id      UUID REFERENCES file(id),
    error        TEXT,
    created_by   UUID NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at   TIMESTAMPTZ
);

-- append-only, no UPDATE/DELETE grants for application role
CREATE TABLE audit_log (
    id          BIGSERIAL PRIMARY KEY,
    tenant_id   UUID NOT NULL,
    user_id     UUID,
    action      TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id   UUID,
    old_value   JSONB,
    new_value   JSONB,
    diff        JSONB,
    ip_address  INET,
    user_agent  TEXT,
    trace_id    TEXT,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_entity ON audit_log(tenant_id, entity_type, entity_id, occurred_at DESC);
CREATE INDEX idx_audit_user   ON audit_log(tenant_id, user_id, occurred_at DESC);
CREATE INDEX idx_audit_time   ON audit_log(tenant_id, occurred_at DESC);

-- =====================================================================
-- 12. TRIGGERS
-- =====================================================================

-- block writes into a closed accounting period
CREATE OR REPLACE FUNCTION reject_closed_period() RETURNS trigger AS $$
DECLARE p_status TEXT;
BEGIN
    SELECT status INTO p_status FROM accounting_period WHERE id = NEW.period_id;
    IF p_status = 'closed' THEN
        RAISE EXCEPTION 'PERIOD_CLOSED: accounting period is closed'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_charge_period_open
    BEFORE INSERT ON charge
    FOR EACH ROW EXECUTE FUNCTION reject_closed_period();

-- financial rows are immutable
CREATE OR REPLACE FUNCTION reject_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'IMMUTABLE_RECORD: % rows cannot be updated or deleted', TG_TABLE_NAME
        USING ERRCODE = 'check_violation';
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_charge_immutable
    BEFORE UPDATE OR DELETE ON charge
    FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER trg_payment_immutable
    BEFORE UPDATE OR DELETE ON payment
    FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER trg_allocation_immutable
    BEFORE UPDATE OR DELETE ON payment_allocation
    FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER trg_audit_immutable
    BEFORE UPDATE OR DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- bump permissions_version so guard caches invalidate instantly
CREATE OR REPLACE FUNCTION bump_permissions_version() RETURNS trigger AS $$
DECLARE t_id UUID;
BEGIN
    IF TG_TABLE_NAME = 'role_permission' THEN
        SELECT tenant_id INTO t_id FROM role
        WHERE id = COALESCE(NEW.role_id, OLD.role_id);
    ELSIF TG_TABLE_NAME = 'user_role' THEN
        SELECT tenant_id INTO t_id FROM app_user
        WHERE id = COALESCE(NEW.user_id, OLD.user_id);
    ELSIF TG_TABLE_NAME = 'user_permission_override' THEN
        SELECT tenant_id INTO t_id FROM app_user
        WHERE id = COALESCE(NEW.user_id, OLD.user_id);
    ELSE
        t_id := COALESCE(NEW.tenant_id, OLD.tenant_id);
    END IF;

    IF t_id IS NOT NULL THEN
        UPDATE tenant SET permissions_version = permissions_version + 1 WHERE id = t_id;
    END IF;
    RETURN NULL;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_bump_perm_rp AFTER INSERT OR UPDATE OR DELETE ON role_permission
    FOR EACH ROW EXECUTE FUNCTION bump_permissions_version();
CREATE TRIGGER trg_bump_perm_ur AFTER INSERT OR UPDATE OR DELETE ON user_role
    FOR EACH ROW EXECUTE FUNCTION bump_permissions_version();
CREATE TRIGGER trg_bump_perm_ov AFTER INSERT OR UPDATE OR DELETE ON user_permission_override
    FOR EACH ROW EXECUTE FUNCTION bump_permissions_version();
CREATE TRIGGER trg_bump_perm_role AFTER INSERT OR UPDATE OR DELETE ON role
    FOR EACH ROW EXECUTE FUNCTION bump_permissions_version();

-- updated_at maintenance
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_touch_child   BEFORE UPDATE ON child
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_touch_guardian BEFORE UPDATE ON guardian
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_touch_group   BEFORE UPDATE ON child_group
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_touch_att     BEFORE UPDATE ON attendance_day
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_touch_expense BEFORE UPDATE ON expense
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- =====================================================================
-- 13. VIEWS — balance is always derived, never stored
-- =====================================================================

CREATE VIEW v_charge_outstanding AS
SELECT c.id AS charge_id, c.tenant_id, c.child_id, c.period_id, c.kind,
       c.issued_at, c.due_date,
       c.amount_tiyin AS charge_tiyin,
       COALESCE(a.allocated, 0) AS allocated_tiyin,
       c.amount_tiyin - COALESCE(a.allocated, 0) AS outstanding_tiyin
FROM charge c
LEFT JOIN (
    SELECT charge_id, SUM(amount_tiyin) AS allocated
    FROM payment_allocation GROUP BY charge_id
) a ON a.charge_id = c.id
WHERE c.sign = 1;

CREATE VIEW v_child_balance AS
SELECT ch.id AS child_id, ch.tenant_id, ch.branch_id,
       COALESCE(cg.charged, 0)                       AS charged_tiyin,
       COALESCE(pm.paid, 0)                          AS paid_tiyin,
       COALESCE(cg.charged, 0) - COALESCE(pm.paid,0) AS debt_tiyin,
       GREATEST(COALESCE(pm.paid,0) - COALESCE(cg.charged,0), 0) AS advance_tiyin
FROM child ch
LEFT JOIN (
    SELECT child_id, SUM(amount_tiyin * sign) AS charged
    FROM charge GROUP BY child_id
) cg ON cg.child_id = ch.id
LEFT JOIN (
    SELECT child_id, SUM(amount_tiyin * sign) AS paid
    FROM payment GROUP BY child_id
) pm ON pm.child_id = ch.id
WHERE ch.deleted_at IS NULL;

CREATE VIEW v_debt_ageing AS
SELECT o.tenant_id, o.child_id,
       SUM(o.outstanding_tiyin) FILTER (
           WHERE o.due_date IS NULL OR o.due_date >= CURRENT_DATE) AS not_overdue,
       SUM(o.outstanding_tiyin) FILTER (
           WHERE CURRENT_DATE - o.due_date BETWEEN 1 AND 7)   AS d1_7,
       SUM(o.outstanding_tiyin) FILTER (
           WHERE CURRENT_DATE - o.due_date BETWEEN 8 AND 30)  AS d8_30,
       SUM(o.outstanding_tiyin) FILTER (
           WHERE CURRENT_DATE - o.due_date > 30)              AS d30_plus,
       SUM(o.outstanding_tiyin)                               AS total_outstanding
FROM v_charge_outstanding o
WHERE o.outstanding_tiyin > 0
GROUP BY o.tenant_id, o.child_id;

CREATE VIEW v_currently_inside AS
SELECT a.tenant_id, a.branch_id, a.child_id, a.group_id,
       c.first_name, c.last_name, a.check_in_at
FROM attendance_day a
JOIN child c ON c.id = a.child_id
WHERE a.check_in_at IS NOT NULL
  AND a.check_out_at IS NULL
  AND a.attendance_date = (now() AT TIME ZONE 'Asia/Tashkent')::date;

CREATE VIEW v_group_occupancy AS
SELECT g.id AS group_id, g.tenant_id, g.branch_id, g.name, g.capacity,
       COUNT(ga.child_id) AS current_count,
       g.capacity - COUNT(ga.child_id) AS available_places
FROM child_group g
LEFT JOIN group_assignment ga
       ON ga.group_id = g.id AND ga.effective_to IS NULL
WHERE g.deleted_at IS NULL
GROUP BY g.id, g.tenant_id, g.branch_id, g.name, g.capacity;
