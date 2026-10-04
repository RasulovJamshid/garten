-- Stop rather than silently rewrite historical data if existing rows violate these invariants.
CREATE UNIQUE INDEX uq_payment_one_reversal ON payment(tenant_id, source_payment_id) WHERE sign = -1;
CREATE UNIQUE INDEX uq_charge_one_reversal ON charge(tenant_id, source_charge_id) WHERE sign = -1;

-- A reversed charge may be replaced. Serialize the active-charge check on the child.
DROP INDEX uq_charge_once;
CREATE FUNCTION enforce_active_charge() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM id FROM child WHERE id = NEW.child_id AND tenant_id = NEW.tenant_id FOR UPDATE;
  IF NEW.sign = 1 AND NEW.kind NOT IN ('manual', 'adjustment') AND EXISTS (
    SELECT 1 FROM charge c WHERE c.tenant_id = NEW.tenant_id AND c.child_id = NEW.child_id
      AND c.period_id = NEW.period_id AND c.kind = NEW.kind AND c.sign = 1
      AND NOT EXISTS (SELECT 1 FROM charge r WHERE r.source_charge_id = c.id AND r.sign = -1)
  ) THEN
    RAISE EXCEPTION 'Active charge already exists' USING ERRCODE = '23505';
  END IF;
  IF NEW.sign = -1 AND NOT EXISTS (
    SELECT 1 FROM charge c WHERE c.id = NEW.source_charge_id AND c.sign = 1
      AND c.tenant_id = NEW.tenant_id AND c.child_id = NEW.child_id
      AND c.amount_tiyin = NEW.amount_tiyin
  ) THEN RAISE EXCEPTION 'Invalid charge reversal' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_active_charge BEFORE INSERT ON charge FOR EACH ROW EXECUTE FUNCTION enforce_active_charge();

CREATE FUNCTION enforce_payment_reversal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM id FROM child WHERE id = NEW.child_id AND tenant_id = NEW.tenant_id FOR UPDATE;
  IF NEW.sign = -1 AND NOT EXISTS (
    SELECT 1 FROM payment p WHERE p.id = NEW.source_payment_id AND p.sign = 1
      AND p.tenant_id = NEW.tenant_id AND p.child_id = NEW.child_id AND p.amount_tiyin = NEW.amount_tiyin
  ) THEN RAISE EXCEPTION 'Invalid payment reversal' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_payment_reversal BEFORE INSERT ON payment FOR EACH ROW EXECUTE FUNCTION enforce_payment_reversal();

-- Hold a lock until the insertion commits so period close cannot race a financial write.
CREATE OR REPLACE FUNCTION reject_closed_period() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE period_status text;
BEGIN
  SELECT status INTO period_status FROM accounting_period
    WHERE id = NEW.period_id AND tenant_id = NEW.tenant_id FOR SHARE;
  IF period_status = 'closed' THEN RAISE EXCEPTION 'PERIOD_CLOSED' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;

-- Every tenant-bearing FK must refer to a parent in the same tenant, including nested ORM writes.
DO $$
DECLARE link record; index_name text; constraint_name text;
BEGIN
  FOR link IN
    SELECT c.conrelid::regclass AS child_table, c.confrelid::regclass AS parent_table,
      a.attname AS child_column, b.attname AS parent_column, c.oid AS fk_oid
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    JOIN pg_attribute b ON b.attrelid = c.confrelid AND b.attnum = c.confkey[1]
    WHERE c.contype = 'f' AND cardinality(c.conkey) = 1
      AND a.attname <> 'tenant_id' AND b.attname <> 'tenant_id'
      AND c.connamespace = 'public'::regnamespace
      AND EXISTS (SELECT 1 FROM pg_attribute x WHERE x.attrelid = c.conrelid AND x.attname = 'tenant_id')
      AND EXISTS (SELECT 1 FROM pg_attribute x WHERE x.attrelid = c.confrelid AND x.attname = 'tenant_id')
  LOOP
    index_name := 'uq_tenant_ref_' || replace(link.parent_table::text, '.', '_') || '_' || link.parent_column;
    constraint_name := 'fk_same_tenant_' || link.fk_oid;
    EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS %I ON %s (tenant_id, %I)', index_name, link.parent_table, link.parent_column);
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (tenant_id, %I) REFERENCES %s (tenant_id, %I)',
      link.child_table, constraint_name, link.child_column, link.parent_table, link.parent_column);
  END LOOP;
END $$;

CREATE FUNCTION enforce_user_link_tenant() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE user_tenant uuid; related_tenant uuid;
BEGIN
  SELECT tenant_id INTO user_tenant FROM app_user WHERE id = NEW.user_id;
  IF NEW.branch_id IS NOT NULL THEN
    SELECT tenant_id INTO related_tenant FROM branch WHERE id = NEW.branch_id;
    IF related_tenant IS DISTINCT FROM user_tenant THEN RAISE EXCEPTION 'Branch belongs to another tenant' USING ERRCODE = '23503'; END IF;
  END IF;
  IF TG_TABLE_NAME = 'user_role' THEN
    SELECT tenant_id INTO related_tenant FROM role WHERE id = NEW.role_id;
    IF related_tenant IS DISTINCT FROM user_tenant THEN RAISE EXCEPTION 'Role belongs to another tenant' USING ERRCODE = '23503'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_user_role_tenant BEFORE INSERT OR UPDATE ON user_role FOR EACH ROW EXECUTE FUNCTION enforce_user_link_tenant();
CREATE TRIGGER trg_user_branch_tenant BEFORE INSERT OR UPDATE ON user_branch FOR EACH ROW EXECUTE FUNCTION enforce_user_link_tenant();

CREATE TABLE receipt_counter (
  tenant_id uuid NOT NULL REFERENCES tenant(id), year integer NOT NULL, value bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, year)
);

-- File permissions needed by the existing staff workflows; effective resource scope is still enforced by the API.
INSERT INTO role_permission(role_id, permission_key, scope)
SELECT id, 'file:read', 'branch' FROM role WHERE code IN ('reception', 'nurse')
ON CONFLICT (role_id, permission_key) DO NOTHING;
INSERT INTO role_permission(role_id, permission_key, scope)
SELECT id, 'file:manage', 'branch' FROM role WHERE code IN ('reception', 'nurse', 'accountant')
ON CONFLICT (role_id, permission_key) DO NOTHING;
UPDATE role_permission SET scope = 'branch' WHERE scope = 'today' AND permission_key IN ('attendance:checkin', 'attendance:checkout');
