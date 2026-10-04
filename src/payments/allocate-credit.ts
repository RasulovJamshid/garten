/** Call inside the financial transaction. The child lock is shared by every charge/payment write. */
export async function allocateCredit(tx: any, tenantId: string, childId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM child WHERE id = ${childId}::uuid AND tenant_id = ${tenantId}::uuid FOR UPDATE`;
  const payments = await tx.$queryRaw`
    SELECT p.id, p.amount_tiyin - COALESCE(SUM(pa.amount_tiyin) FILTER (
      WHERE c.sign = 1 AND NOT EXISTS (SELECT 1 FROM charge r WHERE r.source_charge_id = c.id AND r.sign = -1)
    ), 0) AS available
    FROM payment p LEFT JOIN payment_allocation pa ON pa.payment_id = p.id LEFT JOIN charge c ON c.id = pa.charge_id
    WHERE p.tenant_id = ${tenantId}::uuid AND p.child_id = ${childId}::uuid AND p.sign = 1
      AND NOT EXISTS (SELECT 1 FROM payment r WHERE r.source_payment_id = p.id AND r.sign = -1)
    GROUP BY p.id ORDER BY p.paid_at, p.id
  `;
  const charges = await tx.$queryRaw`
    SELECT charge_id, outstanding_tiyin FROM v_charge_outstanding
    WHERE tenant_id = ${tenantId}::uuid AND child_id = ${childId}::uuid AND outstanding_tiyin > 0
    ORDER BY issued_at, charge_id
  `;
  const outstanding = charges.map((c: any) => ({
    id: c.charge_id,
    amount: BigInt(c.outstanding_tiyin.toString()),
  }));
  for (const payment of payments) {
    let available = BigInt(payment.available.toString());
    for (const charge of outstanding) {
      if (available <= 0n) break;
      const amount = available < charge.amount ? available : charge.amount;
      if (amount <= 0n) continue;
      await tx.paymentAllocation.create({
        data: { tenantId, paymentId: payment.id, chargeId: charge.id, amountTiyin: amount },
      });
      available -= amount;
      charge.amount -= amount;
    }
  }
}
