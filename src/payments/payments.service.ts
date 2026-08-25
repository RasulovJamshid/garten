import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantPrisma } from '../prisma/tenant-prisma.provider';
import { AuditService } from '../audit/audit.service';
import { AppErrors } from '../common/exceptions/app.exception';
import { AuthContext } from '../common/auth-context';
import { NotificationsService } from '../notifications/notifications.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { buildReceiptPdfBuffer, ReceiptData } from './receipt-pdf';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly tenantPrisma: TenantPrisma,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(filters: {
    childId?: string;
    from?: string;
    to?: string;
    method?: string;
    recordedBy?: string;
  }) {
    const where: Record<string, unknown> = {};
    if (filters.childId) where.childId = filters.childId;
    if (filters.method) where.method = filters.method;
    if (filters.recordedBy) where.recordedBy = filters.recordedBy;
    if (filters.from || filters.to) {
      where.paidAt = {
        ...(filters.from && { gte: new Date(filters.from) }),
        ...(filters.to && { lte: new Date(filters.to) }),
      };
    }
    return this.tenantPrisma.db.payment.findMany({ where, orderBy: { paidAt: 'desc' }, take: 500 });
  }

  async get(id: string) {
    const payment = await this.tenantPrisma.db.payment.findUnique({
      where: { id },
      include: { paymentAllocation: { include: { charge: true } } },
    });
    if (!payment) throw AppErrors.notFound('Payment not found');
    return payment;
  }

  /**
   * FIFO allocation under SERIALIZABLE + FOR UPDATE (01-stage1-plan.md
   * §3.3) — two accountants registering payments for the same child at
   * the same time must never both allocate to the same charge. Idempotent
   * on Idempotency-Key: a replay with the same key returns the original
   * payment instead of creating a second one.
   */
  async create(ctx: AuthContext, dto: CreatePaymentDto, idempotencyKey: string) {
    const existing = await this.tenantPrisma.db.payment.findFirst({
      where: { idempotencyKey },
    });
    if (existing) return this.get(existing.id);

    const child = await this.tenantPrisma.db.child.findUnique({ where: { id: dto.childId } });
    if (!child) throw AppErrors.notFound('Child not found');

    const amountTiyin = BigInt(dto.amountTiyin);
    const tenantId = this.tenantPrisma.tenantId;

    const payment = await this.tenantPrisma.db.$transaction(
      async (tx) => {
        const created = await tx.payment.create({
          data: {
            tenantId,
            branchId: child.branchId,
            childId: dto.childId,
            payerGuardianId: dto.payerGuardianId,
            amountTiyin,
            sign: 1,
            method: dto.method,
            receiptNo: dto.receiptNo,
            bankRef: dto.bankRef,
            paidAt: new Date(dto.paidAt),
            attachmentFileId: dto.attachmentFileId,
            note: dto.note,
            idempotencyKey,
            recordedBy: ctx.userId,
          },
        });

        if (dto.allocations && dto.allocations.length > 0) {
          await this.allocateManual(
            tx,
            tenantId,
            created.id,
            dto.childId,
            amountTiyin,
            dto.allocations,
          );
        } else {
          await this.allocateFifo(tx, tenantId, created.id, dto.childId, amountTiyin);
        }

        return created;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    await this.audit.log({
      userId: ctx.userId,
      action: 'payment.create',
      entityType: 'payment',
      entityId: payment.id,
      newValue: { childId: dto.childId, amountTiyin: dto.amountTiyin, method: dto.method },
    });

    // Never send inside the request that triggered it (§4) — queue only,
    // and never let a notification problem fail a recorded payment.
    void this.notifyPayer(
      dto.childId,
      dto.payerGuardianId,
      payment.id,
      amountTiyin,
      payment.receiptNo,
    );

    return this.get(payment.id);
  }

  private async notifyPayer(
    childId: string,
    payerGuardianId: string | undefined,
    paymentId: string,
    amountTiyin: bigint,
    receiptNo: string | null,
  ): Promise<void> {
    try {
      const recipients = payerGuardianId
        ? [{ guardianId: payerGuardianId }]
        : (
            await this.tenantPrisma.db.childGuardian.findMany({
              where: { childId, isPayer: true },
              select: { guardianId: true },
            })
          ).map((l) => ({ guardianId: l.guardianId }));
      if (recipients.length === 0) return;

      await this.notifications.send({
        templateKey: 'payment_received',
        recipients,
        channel: 'telegram',
        data: {
          amount: (Number(amountTiyin) / 100).toFixed(2),
          receipt: receiptNo ?? paymentId,
        },
        entityId: paymentId,
      });
    } catch (e) {
      this.logger.warn(`notifyPayer failed: ${(e as Error).message}`);
    }
  }

  // `tx: any` on these three helpers: the tenant-extended client's own
  // $transaction callback type and Prisma's plain Prisma.TransactionClient
  // are mutually incompatible per Prisma's generic Exact/SelectSubset
  // machinery, even though both are functionally identical for these
  // calls (see tenant-extension.ts / permission-resolver.service.ts for
  // the same trade-off made the same way elsewhere in this codebase).
  private async allocateManual(
    tx: any,
    tenantId: string,
    paymentId: string,
    childId: string,
    paymentAmount: bigint,
    allocations: { chargeId: string; amountTiyin: string }[],
  ): Promise<void> {
    const requestedTotal = allocations.reduce((acc, a) => acc + BigInt(a.amountTiyin), 0n);
    if (requestedTotal > paymentAmount) {
      throw AppErrors.validationFailed(
        'ALLOCATION_EXCEEDS_PAYMENT: allocations sum exceeds the payment amount',
      );
    }

    for (const alloc of allocations) {
      const charge = await tx.charge.findFirst({ where: { id: alloc.chargeId, childId, sign: 1 } });
      if (!charge) throw AppErrors.notFound(`Charge ${alloc.chargeId} not found for this child`);

      // Lock this one row first — Postgres forbids FOR UPDATE combined
      // with GROUP BY/aggregates, so the lock and the outstanding
      // computation are necessarily two queries, in that order.
      await tx.$queryRaw`SELECT id FROM charge WHERE id = ${alloc.chargeId}::uuid FOR UPDATE`;
      const outstanding = await this.chargeOutstanding(tx, tenantId, alloc.chargeId);
      const amount = BigInt(alloc.amountTiyin);
      if (amount > outstanding) {
        throw AppErrors.validationFailed(
          `ALLOCATION_EXCEEDS_CHARGE: charge ${alloc.chargeId} has only ${outstanding} outstanding`,
        );
      }

      await tx.paymentAllocation.create({
        data: { tenantId, paymentId, chargeId: alloc.chargeId, amountTiyin: amount },
      });
    }
  }

  private async chargeOutstanding(tx: any, tenantId: string, chargeId: string): Promise<bigint> {
    // A funding payment's OWN `sign` is always +1 — cancelling it creates a
    // SEPARATE reversal payment row, it doesn't flip the original's sign.
    // So "is this allocation still good" means "does no payment exist with
    // source_payment_id = this allocation's payment_id", not "sign = 1".
    const rows = await tx.$queryRaw<{ remaining: unknown }[]>`
      SELECT c.amount_tiyin - COALESCE(SUM(pa.amount_tiyin) FILTER (
        WHERE NOT EXISTS (SELECT 1 FROM payment rp WHERE rp.source_payment_id = pa.payment_id)
      ), 0) AS remaining
      FROM charge c
      LEFT JOIN payment_allocation pa ON pa.charge_id = c.id
      WHERE c.id = ${chargeId}::uuid AND c.tenant_id = ${tenantId}::uuid AND c.sign = 1
        AND NOT EXISTS (SELECT 1 FROM charge r WHERE r.source_charge_id = c.id)
      GROUP BY c.id, c.amount_tiyin
    `;
    // Postgres promotes BIGINT - SUM(BIGINT) to NUMERIC, which Prisma
    // returns as a Decimal, not a native bigint (see debts.service.ts's
    // toBigInt for the same issue) — normalize before any caller does
    // bigint arithmetic on it.
    const remaining = rows[0]?.remaining;
    return remaining === null || remaining === undefined ? 0n : BigInt(remaining.toString());
  }

  private async allocateFifo(
    tx: any,
    tenantId: string,
    paymentId: string,
    childId: string,
    paymentAmount: bigint,
  ): Promise<void> {
    // Step 1: lock every open charge row for this child — no aggregates
    // here, since Postgres forbids FOR UPDATE combined with GROUP BY.
    // This is what stops a concurrent payment from allocating against the
    // same charge twice. `NOT EXISTS (... source_charge_id ...)` excludes
    // any charge that has since been reversed — a reversed charge no
    // longer represents real debt and must not receive new payments.
    const lockedCharges = await tx.$queryRaw<{ id: string; amount_tiyin: bigint }[]>`
      SELECT id, amount_tiyin FROM charge c
      WHERE child_id = ${childId}::uuid AND tenant_id = ${tenantId}::uuid AND sign = 1
        AND NOT EXISTS (SELECT 1 FROM charge r WHERE r.source_charge_id = c.id)
      ORDER BY issued_at ASC
      FOR UPDATE
    `;
    if (lockedCharges.length === 0) return;

    // Step 2: how much of each locked charge is already allocated. A
    // funding payment's own `sign` is always +1 — cancelling it creates a
    // SEPARATE reversal payment row, it doesn't flip the original's sign
    // — so an allocation only still counts if no payment exists whose
    // source_payment_id points back at the payment that funded it.
    const existingAllocations = await tx.paymentAllocation.findMany({
      where: { chargeId: { in: lockedCharges.map((c: { id: string }) => c.id) } },
      include: { payment: { select: { otherPayment: { select: { id: true } } } } },
    });
    const allocatedByCharge = new Map<string, bigint>();
    for (const a of existingAllocations as {
      chargeId: string;
      amountTiyin: bigint;
      payment: { otherPayment: { id: string }[] };
    }[]) {
      if (a.payment.otherPayment.length > 0) continue; // funding payment was cancelled
      const prev = allocatedByCharge.get(a.chargeId) ?? 0n;
      allocatedByCharge.set(a.chargeId, prev + a.amountTiyin);
    }

    let remaining = paymentAmount;
    for (const charge of lockedCharges) {
      if (remaining <= 0n) break;
      const chargeRemaining = charge.amount_tiyin - (allocatedByCharge.get(charge.id) ?? 0n);
      if (chargeRemaining <= 0n) continue;

      const amount = remaining < chargeRemaining ? remaining : chargeRemaining;
      await tx.paymentAllocation.create({
        data: { tenantId, paymentId, chargeId: charge.id, amountTiyin: amount },
      });
      remaining -= amount;
    }
    // remaining > 0 stays unallocated = advance credit, auto-applied by the next billing run.
  }

  /** Never UPDATE, never DELETE — cancellation is a new sign=-1 row (01-stage1-plan.md §3.4). */
  async cancel(ctx: AuthContext, id: string, reason: string) {
    const original = await this.tenantPrisma.db.payment.findUnique({ where: { id } });
    if (!original) throw AppErrors.notFound('Payment not found');
    if (original.sign === -1) throw AppErrors.validationFailed('Cannot cancel a cancellation');

    const existingCancellation = await this.tenantPrisma.db.payment.findFirst({
      where: { sourcePaymentId: id },
    });
    if (existingCancellation) throw AppErrors.conflict('This payment was already cancelled');

    const reversal = await this.tenantPrisma.db.payment.create({
      data: {
        tenantId: this.tenantPrisma.tenantId,
        branchId: original.branchId,
        childId: original.childId,
        payerGuardianId: original.payerGuardianId,
        amountTiyin: original.amountTiyin,
        sign: -1,
        method: original.method,
        sourcePaymentId: id,
        paidAt: new Date(),
        cancelReason: reason,
        recordedBy: ctx.userId,
      },
    });

    await this.audit.log({
      userId: ctx.userId,
      action: 'payment.cancel',
      entityType: 'payment',
      entityId: id,
      oldValue: { amountTiyin: original.amountTiyin.toString() },
      newValue: { reversalId: reversal.id, reason },
    });

    return reversal;
  }

  private async receiptFields(id: string): Promise<ReceiptData> {
    const payment = await this.get(id);
    const child = await this.tenantPrisma.db.child.findUnique({ where: { id: payment.childId } });
    const setting = await this.tenantPrisma.db.setting.findUnique({
      where: { tenantId: this.tenantPrisma.tenantId },
    });

    return {
      kindergartenName: setting?.displayName ?? '',
      receiptNo: payment.receiptNo ?? payment.id,
      childName: `${child?.firstName ?? ''} ${child?.lastName ?? ''}`.trim(),
      paidAt: payment.paidAt,
      amountTiyin: payment.amountTiyin.toString(),
      method: payment.method,
      allocations: payment.paymentAllocation.map((a) => ({
        chargeKind: a.charge.kind,
        amountTiyin: a.amountTiyin.toString(),
      })),
    };
  }

  async receiptHtml(id: string): Promise<string> {
    const data = await this.receiptFields(id);
    const rows = data.allocations
      .map((a) => `<tr><td>${a.chargeKind}</td><td>${a.amountTiyin}</td></tr>`)
      .join('');

    return `<!doctype html><html><body>
      <h1>${data.kindergartenName}</h1>
      <p>Receipt: ${data.receiptNo}</p>
      <p>Child: ${data.childName}</p>
      <p>Date: ${data.paidAt.toISOString()}</p>
      <p>Amount: ${data.amountTiyin} tiyin</p>
      <table><thead><tr><th>Charge</th><th>Allocated</th></tr></thead><tbody>${rows}</tbody></table>
    </body></html>`;
  }

  async receiptPdf(id: string): Promise<Buffer> {
    const data = await this.receiptFields(id);
    return buildReceiptPdfBuffer(data);
  }
}
