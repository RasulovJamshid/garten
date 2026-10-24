import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantPrisma } from '../prisma/tenant-prisma.provider';
import { AuditService } from '../audit/audit.service';
import { AppErrors } from '../common/exceptions/app.exception';
import { AuthContext } from '../common/auth-context';
import { NotificationsService } from '../notifications/notifications.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { buildReceiptPdfBuffer, ReceiptData } from './receipt-pdf';
import { timestampRange, todayInTashkent } from '../common/tashkent-date';
import { allocateCredit } from './allocate-credit';

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
    const where: Record<string, unknown> = { child: this.tenantPrisma.childWhere('payment:read') };
    if (filters.childId) where.childId = filters.childId;
    if (filters.method) where.method = filters.method;
    if (filters.recordedBy) where.recordedBy = filters.recordedBy;
    if (filters.from || filters.to) {
      where.paidAt = timestampRange(filters.from, filters.to);
    }
    const payments = await this.tenantPrisma.db.payment.findMany({
      where,
      orderBy: [{ paidAt: 'desc' }, { id: 'desc' }],
      include: {
        child: { select: { id: true, firstName: true, lastName: true } },
        guardian: { select: { id: true, fullName: true } },
        otherPayment: { select: { id: true } },
      },
    });
    const recorders = await this.tenantPrisma.db.appUser.findMany({
      where: { id: { in: [...new Set(payments.map((payment) => payment.recordedBy))] } },
      select: { id: true, fullName: true },
    });
    const names = new Map(recorders.map((user) => [user.id, user.fullName]));
    return payments.map((payment) => ({
      ...payment,
      recordedByName: names.get(payment.recordedBy) ?? null,
    }));
  }

  async get(id: string, permission = 'payment:read') {
    const payment = await this.tenantPrisma.db.payment.findFirst({
      where: { id, child: this.tenantPrisma.childWhere(permission) },
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
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify({
          childId: dto.childId,
          payerGuardianId: dto.payerGuardianId ?? null,
          amountTiyin: BigInt(dto.amountTiyin).toString(),
          method: dto.method,
          paidAt: new Date(dto.paidAt).toISOString(),
          receiptNo: dto.receiptNo ?? null,
          bankRef: dto.bankRef ?? null,
          attachmentFileId: dto.attachmentFileId ?? null,
          note: dto.note ?? null,
          allocations:
            dto.allocations
              ?.map((a) => ({
                chargeId: a.chargeId,
                amountTiyin: BigInt(a.amountTiyin).toString(),
              }))
              .sort((a, b) => a.chargeId.localeCompare(b.chargeId)) ?? null,
        }),
      )
      .digest('hex');
    const existing = await this.tenantPrisma.db.payment.findFirst({
      where: { idempotencyKey },
    });
    if (existing) {
      if (existing.requestHash && existing.requestHash !== requestHash)
        throw AppErrors.conflict('IDEMPOTENCY_CONFLICT: request payload differs');
      if (
        existing.childId !== dto.childId ||
        existing.amountTiyin !== BigInt(dto.amountTiyin) ||
        existing.method !== dto.method
      )
        throw AppErrors.conflict('IDEMPOTENCY_CONFLICT: key was used for another payment');
      return this.get(existing.id, 'payment:create');
    }

    const child = await this.tenantPrisma.assertChild(dto.childId, 'payment:create');
    if (!child) throw AppErrors.notFound('Child not found');

    const amountTiyin = BigInt(dto.amountTiyin);
    if (amountTiyin <= 0n) throw AppErrors.validationFailed('Payment must be positive');
    if (
      dto.payerGuardianId &&
      !(await this.tenantPrisma.db.childGuardian.findFirst({
        where: { childId: dto.childId, guardianId: dto.payerGuardianId },
      }))
    )
      throw AppErrors.notFound('Payer is not linked to this child');
    const tenantId = this.tenantPrisma.tenantId;

    let payment;
    try {
      payment = await this.tenantPrisma.db.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM child WHERE id = ${dto.childId}::uuid AND tenant_id = ${tenantId}::uuid FOR UPDATE`;
          const year = Number(todayInTashkent(new Date(dto.paidAt)).slice(0, 4));
          const counters = dto.receiptNo
            ? []
            : await tx.$queryRaw<
                { value: bigint }[]
              >`INSERT INTO receipt_counter(tenant_id, year, value) VALUES (${tenantId}::uuid, ${year}, 1) ON CONFLICT (tenant_id, year) DO UPDATE SET value = receipt_counter.value + 1 RETURNING value`;
          const setting = await tx.setting.findUnique({ where: { tenantId } });
          const format = setting?.receiptNumberFormat ?? '{year}-{seq}';
          const receiptNo =
            dto.receiptNo ??
            format
              .replace(/\{YYYY\}|\{year\}|YYYY/g, String(year))
              .replace(/\{SEQ:(\d+)\}|\{seq\}|\{number\}|\{n\}/g, (_match, width) =>
                String(counters[0].value).padStart(Math.min(Number(width ?? 6), 20), '0'),
              );
          if (
            !dto.receiptNo &&
            (!/\{SEQ:\d+\}|\{seq\}|\{number\}|\{n\}/.test(format) || /[{}]/.test(receiptNo))
          )
            throw AppErrors.validationFailed('Invalid receiptNumberFormat setting');
          const created = await tx.payment.create({
            data: {
              tenantId,
              branchId: child.branchId,
              childId: dto.childId,
              payerGuardianId: dto.payerGuardianId,
              amountTiyin,
              sign: 1,
              method: dto.method,
              receiptNo,
              bankRef: dto.bankRef,
              paidAt: new Date(dto.paidAt),
              attachmentFileId: dto.attachmentFileId,
              note: dto.note,
              idempotencyKey,
              requestHash,
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
            await allocateCredit(tx, tenantId, dto.childId);
          }

          await this.audit.log(
            {
              userId: ctx.userId,
              action: 'payment.create',
              entityType: 'payment',
              entityId: created.id,
              newValue: { childId: dto.childId, amountTiyin: dto.amountTiyin, method: dto.method },
            },
            tx,
          );
          return created;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (e) {
      // SERIALIZABLE + the charge-row FOR UPDATE lock (allocateFifo /
      // allocateManual above) is what stops two concurrent payments from
      // both allocating against the same charge — but Postgres enforces
      // that by aborting the LOSING transaction with a serialization
      // failure (P2034) rather than making it wait for a safe answer.
      // Uncaught, that surfaced as an unhandled 500 for a perfectly
      // legitimate race (two staff recording payments for the same child
      // at once — confirmed while adding
      // test/billing-concurrency.e2e-spec.ts). The client's own retry of
      // the same request is safe: `idempotencyKey` is still unused since
      // this transaction never committed.
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        (e.code === 'P2034' ||
          e.code === 'P2002' ||
          (e.code === 'P2010' && ['40001', '40P01'].includes(String(e.meta?.code))))
      ) {
        throw AppErrors.conflict(
          'CONCURRENT_PAYMENT: a concurrent payment for this child is being processed, please retry',
        );
      }
      throw e;
    }

    // Never send inside the request that triggered it (§4) — queue only,
    // and never let a notification problem fail a recorded payment.
    void this.notifyPayer(
      dto.childId,
      dto.payerGuardianId,
      payment.id,
      amountTiyin,
      payment.receiptNo,
    );

    return this.get(payment.id, 'payment:create');
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
      if (amount <= 0n) throw AppErrors.validationFailed('Allocation must be positive');
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
    const rows =
      await tx.$queryRaw`SELECT outstanding_tiyin FROM v_charge_outstanding WHERE tenant_id = ${tenantId}::uuid AND charge_id = ${chargeId}::uuid`;
    return BigInt(String(rows[0]?.outstanding_tiyin ?? 0));
  }

  /** Never UPDATE, never DELETE — cancellation is a new sign=-1 row (01-stage1-plan.md §3.4). */
  async cancel(ctx: AuthContext, id: string, reason: string) {
    if (!reason.trim()) throw AppErrors.validationFailed('Cancellation requires a reason');
    return this.tenantPrisma.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM payment WHERE id = ${id}::uuid AND tenant_id = ${ctx.tenantId}::uuid FOR UPDATE`;
      const original = await tx.payment.findUnique({ where: { id } });
      if (!original) throw AppErrors.notFound('Payment not found');
      await this.tenantPrisma.assertChild(original.childId, 'payment:cancel', tx);
      if (original.sign === -1) throw AppErrors.validationFailed('Cannot cancel a cancellation');

      const existingCancellation = await tx.payment.findFirst({
        where: { sourcePaymentId: id },
      });
      if (existingCancellation) throw AppErrors.conflict('ALREADY_CANCELLED');

      const reversal = await tx.payment.create({
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

      await allocateCredit(tx, ctx.tenantId, original.childId);
      await this.audit.log(
        {
          userId: ctx.userId,
          action: 'payment.cancel',
          entityType: 'payment',
          entityId: id,
          newValue: { reversalId: reversal.id, reason },
        },
        tx,
      );

      return reversal;
    });
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
    const escape = (value: unknown) =>
      String(value).replace(
        /[&<>"']/g,
        (character) =>
          ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
      );
    const rows = data.allocations
      .map((a) => `<tr><td>${escape(a.chargeKind)}</td><td>${a.amountTiyin}</td></tr>`)
      .join('');

    return `<!doctype html><html><body>
      <h1>${escape(data.kindergartenName)}</h1>
      <p>Receipt: ${escape(data.receiptNo)}</p>
      <p>Child: ${escape(data.childName)}</p>
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
