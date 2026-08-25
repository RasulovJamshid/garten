-- Fixes two financial-correctness bugs in the provided 01-schema.sql views,
-- inherited (not introduced) from kindergarten-docs: v_charge_outstanding
-- (and therefore v_debt_ageing, which is derived from it) neither excluded
-- charges that were later reversed, nor allocations funded by a payment
-- that was later cancelled. Same class of bug already fixed at the
-- application layer in payments.service.ts / charges.service.ts
-- (chargeOutstanding, allocateFifo, ChargesService.list) — this brings the
-- DB view itself in line, since debts.service.ts and the accountant/
-- director dashboards read directly from these views, bypassing that
-- JS-side logic entirely.
--
-- v_child_balance is untouched: it sums amount_tiyin * sign across ALL
-- rows, so a reversal/cancellation's sign=-1 row already nets out the
-- original sign=1 row correctly — no bug there. v_charge_outstanding is
-- different: it works per-charge for ageing buckets, which needs an
-- explicit exclusion rather than a net sum.

CREATE OR REPLACE VIEW v_charge_outstanding AS
SELECT c.id AS charge_id, c.tenant_id, c.child_id, c.period_id, c.kind,
       c.issued_at, c.due_date,
       c.amount_tiyin AS charge_tiyin,
       COALESCE(a.allocated, 0) AS allocated_tiyin,
       c.amount_tiyin - COALESCE(a.allocated, 0) AS outstanding_tiyin
FROM charge c
LEFT JOIN (
    SELECT pa.charge_id, SUM(pa.amount_tiyin) AS allocated
    FROM payment_allocation pa
    JOIN payment p ON p.id = pa.payment_id
    WHERE NOT EXISTS (SELECT 1 FROM payment rp WHERE rp.source_payment_id = p.id)
    GROUP BY pa.charge_id
) a ON a.charge_id = c.id
WHERE c.sign = 1
  AND NOT EXISTS (SELECT 1 FROM charge r WHERE r.source_charge_id = c.id);
