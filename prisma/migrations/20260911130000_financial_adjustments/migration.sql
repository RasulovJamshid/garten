ALTER TABLE charge ADD COLUMN adjustment_for_charge_id uuid REFERENCES charge(id);
DO $$ DECLARE rule record; BEGIN
  FOR rule IN SELECT conname FROM pg_constraint WHERE conrelid = 'charge'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%source_charge_id%'
  LOOP EXECUTE format('ALTER TABLE charge DROP CONSTRAINT %I', rule.conname); END LOOP;
END $$;
ALTER TABLE charge ADD CONSTRAINT ck_charge_reversal_or_adjustment
  CHECK (sign = 1 OR source_charge_id IS NOT NULL OR kind = 'adjustment');
ALTER TABLE charge ADD CONSTRAINT fk_adjustment_same_tenant FOREIGN KEY (tenant_id, adjustment_for_charge_id) REFERENCES charge(tenant_id, id);

CREATE OR REPLACE FUNCTION enforce_active_charge() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM id FROM child WHERE id = NEW.child_id AND tenant_id = NEW.tenant_id FOR UPDATE;
  IF NEW.sign = 1 AND NEW.kind NOT IN ('manual', 'adjustment') AND EXISTS (
    SELECT 1 FROM charge c WHERE c.tenant_id = NEW.tenant_id AND c.child_id = NEW.child_id
      AND c.period_id = NEW.period_id AND c.kind = NEW.kind AND c.sign = 1
      AND NOT EXISTS (SELECT 1 FROM charge r WHERE r.source_charge_id = c.id AND r.sign = -1)
  ) THEN RAISE EXCEPTION 'Active charge already exists' USING ERRCODE = '23505'; END IF;
  IF NEW.source_charge_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM charge c WHERE c.id = NEW.source_charge_id AND c.sign = 1 AND NEW.sign = -1
      AND c.tenant_id = NEW.tenant_id AND c.child_id = NEW.child_id AND c.amount_tiyin = NEW.amount_tiyin
  ) THEN RAISE EXCEPTION 'Invalid charge reversal' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;

ALTER TABLE payment_allocation DROP CONSTRAINT payment_allocation_payment_id_charge_id_key;
CREATE INDEX idx_allocation_payment_charge ON payment_allocation(payment_id, charge_id);

-- Unallocated negative adjustments are credit. Apply that credit to oldest outstanding debt.
CREATE OR REPLACE VIEW v_charge_outstanding AS
WITH raw AS (
  SELECT c.*, COALESCE(a.allocated, 0) AS allocated,
    GREATEST(c.amount_tiyin - COALESCE(a.allocated, 0), 0) AS remaining
  FROM charge c
  LEFT JOIN (
    SELECT pa.charge_id, SUM(pa.amount_tiyin) AS allocated
    FROM payment_allocation pa JOIN payment p ON p.id = pa.payment_id
    WHERE NOT EXISTS (SELECT 1 FROM payment r WHERE r.source_payment_id = p.id AND r.sign = -1)
    GROUP BY pa.charge_id
  ) a ON a.charge_id = c.id
  WHERE c.sign = 1 AND NOT EXISTS (SELECT 1 FROM charge r WHERE r.source_charge_id = c.id AND r.sign = -1)
), credits AS (
  SELECT tenant_id, child_id, SUM(amount_tiyin) AS credit FROM charge
  WHERE sign = -1 AND source_charge_id IS NULL AND kind = 'adjustment' GROUP BY tenant_id, child_id
), ranked AS (
  SELECT raw.*, COALESCE(credits.credit, 0) AS credit,
    COALESCE(SUM(remaining) OVER (PARTITION BY raw.tenant_id, raw.child_id ORDER BY issued_at, id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS prior
  FROM raw LEFT JOIN credits USING (tenant_id, child_id)
)
SELECT id AS charge_id, tenant_id, child_id, period_id, kind, issued_at, due_date,
  amount_tiyin AS charge_tiyin, allocated AS allocated_tiyin,
  GREATEST(remaining - GREATEST(credit - prior, 0), 0) AS outstanding_tiyin
FROM ranked;
