import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { createTestApp, login } from './utils/create-app';

const OWNER_LOGIN = process.env.SEED_OWNER_EMAIL ?? 'owner@demo.local';
const OWNER_PASSWORD = process.env.SEED_OWNER_PASSWORD ?? 'ChangeMe12345!';

/**
 * 01-stage1-plan.md §7's other two non-negotiables: a concurrent
 * billing-run commit and a concurrent payment-allocation race. Both fire
 * genuinely simultaneous requests (Promise.all of two supertest calls) at
 * the real HTTP + Postgres stack — the only way to actually exercise the
 * DB-level locking (FOR UPDATE, the partial unique indexes) these paths
 * rely on instead of app-level mutexes.
 */
describe('Billing/payment concurrency (e2e)', () => {
  let app: INestApplication;
  let prefix: string;
  let prisma: PrismaClient;
  let token: string;
  let tenantId: string;
  let branchId: string;

  beforeAll(async () => {
    ({ app, prefix } = await createTestApp());
    prisma = new PrismaClient();
    token = await login(app, prefix, OWNER_LOGIN, OWNER_PASSWORD);

    const tenant = await prisma.tenant.findFirstOrThrow({ where: { code: 'demo' } });
    tenantId = tenant.id;
    const branch = await prisma.branch.findFirstOrThrow({ where: { tenantId } });
    branchId = branch.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  describe('two concurrent commits of the same preview run', () => {
    // billing-runs.service.ts#preview() 409s outright once a period has a
    // committed run (BILLING_ALREADY_COMMITTED) — and that committed run,
    // like the charges it creates, is append-only (no UPDATE/DELETE; see
    // payments.e2e-spec.ts's docblock for the same constraint on
    // charge/payment). So a fixed year/month would only pass once; a
    // second local run against the same dev DB would 409 at the setup
    // step above, not in the race itself. Randomized so repeated runs
    // (unlike CI, which starts from a fresh DB every time) each get an
    // untouched period, at the cost of leaving fixtures behind — same
    // trade-off payments.e2e-spec.ts makes deliberately.
    const YEAR = 2200 + Math.floor(Math.random() * 500);
    const MONTH = 1 + Math.floor(Math.random() * 12);
    let runId: string;
    let childId: string;

    beforeAll(async () => {
      const child = await prisma.child.create({
        data: {
          tenantId,
          branchId,
          firstName: 'E2E',
          lastName: `BillingRace-${Date.now()}`,
          birthDate: new Date('2021-01-01'),
        },
      });
      childId = child.id;

      const tariff = await prisma.tariff.create({
        data: {
          tenantId,
          branchId,
          name: 'E2E race tariff',
          kind: 'monthly_fixed',
          amountTiyin: 100_000_00n,
        },
      });
      await prisma.childTariff.create({
        data: {
          tenantId,
          childId,
          tariffId: tariff.id,
          effectiveFrom: new Date(`${YEAR}-${String(MONTH).padStart(2, '0')}-01`),
        },
      });

      const previewRes = await request(app.getHttpServer())
        .post(`${prefix}/billing-runs`)
        .set('Authorization', `Bearer ${token}`)
        .send({ year: YEAR, month: MONTH })
        .expect(201);
      runId = previewRes.body.id;
      expect(previewRes.body.lines.length).toBeGreaterThan(0);
    });

    it('exactly one of two simultaneous commits (different idempotency keys) wins; no duplicate charges either way', async () => {
      const [a, b] = await Promise.all([
        request(app.getHttpServer())
          .post(`${prefix}/billing-runs/${runId}/commit`)
          .set('Authorization', `Bearer ${token}`)
          .set('Idempotency-Key', randomUUID()),
        request(app.getHttpServer())
          .post(`${prefix}/billing-runs/${runId}/commit`)
          .set('Authorization', `Bearer ${token}`)
          .set('Idempotency-Key', randomUUID()),
      ]);

      const statuses = [a.status, b.status].sort();
      // Exactly one request must succeed. The loser is EXPECTED to be a
      // clean 4xx conflict, never a 2xx (that would mean it silently
      // double-committed) and never an unhandled 500 (that would mean the
      // DB-level race protection surfaced as a raw, untranslated error
      // instead of a handled one — see AllExceptionsFilter's INTERNAL_ERROR
      // fallback, which is what an uncaught Prisma error becomes).
      expect(statuses.filter((s) => s === 201)).toHaveLength(1);
      const loserStatus = statuses.find((s) => s !== 201)!;
      expect(loserStatus).toBeGreaterThanOrEqual(400);
      expect(loserStatus).toBeLessThan(500);

      // The invariant that actually matters, independent of what HTTP
      // status the loser got: the DB must never end up with two committed
      // runs for one period, nor duplicate charge rows for the same
      // child/period/kind (uq_billing_run_committed / uq_charge_once).
      const committedRuns = await prisma.billingRun.findMany({
        where: { tenantId, status: 'committed', accountingPeriod: { year: YEAR, month: MONTH } },
      });
      expect(committedRuns).toHaveLength(1);

      const charges = await prisma.charge.findMany({
        where: { tenantId, childId, sign: 1, kind: 'monthly_fixed' },
      });
      expect(charges).toHaveLength(1);
    });
  });

  describe('two concurrent payments FIFO-allocating against the same charge', () => {
    let childId: string;
    let chargeId: string;
    const chargeAmountTiyin = 100_000_00n; // 100,000 som
    const paymentAmountTiyin = '6000000'; // 60,000 som each — sum exceeds the charge

    beforeAll(async () => {
      const period = await prisma.accountingPeriod.upsert({
        where: { tenantId_year_month: { tenantId, year: 2096, month: 6 } },
        create: { tenantId, year: 2096, month: 6, status: 'open' },
        update: {},
      });
      const child = await prisma.child.create({
        data: {
          tenantId,
          branchId,
          firstName: 'E2E',
          lastName: `PaymentRace-${Date.now()}`,
          birthDate: new Date('2021-01-01'),
        },
      });
      childId = child.id;
      const charge = await prisma.charge.create({
        data: {
          tenantId,
          branchId,
          childId,
          periodId: period.id,
          kind: 'manual',
          amountTiyin: chargeAmountTiyin,
          sign: 1,
          description: 'E2E race charge',
        },
      });
      chargeId = charge.id;
    });

    it('never over-allocates past the charge amount, and neither request is left in limbo', async () => {
      const [a, b] = await Promise.all([
        request(app.getHttpServer())
          .post(`${prefix}/payments`)
          .set('Authorization', `Bearer ${token}`)
          .set('Idempotency-Key', randomUUID())
          .send({ childId, amountTiyin: paymentAmountTiyin, method: 'cash', paidAt: '2096-06-15' }),
        request(app.getHttpServer())
          .post(`${prefix}/payments`)
          .set('Authorization', `Bearer ${token}`)
          .set('Idempotency-Key', randomUUID())
          .send({ childId, amountTiyin: paymentAmountTiyin, method: 'cash', paidAt: '2096-06-15' }),
      ]);

      // Every response must be a definite success or a definite, clean
      // failure — never an unhandled 500 from an uncaught serialization
      // conflict on the FOR UPDATE lock (allocateFifo in payments.service.ts).
      for (const res of [a, b]) {
        expect(res.status === 201 || res.status >= 400).toBe(true);
        expect(res.status).toBeLessThan(500);
      }

      const allocations = await prisma.paymentAllocation.findMany({ where: { chargeId } });
      const totalAllocated = allocations.reduce((acc, al) => acc + al.amountTiyin, 0n);
      // The hard invariant: this charge can never be allocated past its
      // own amount, no matter how the two transactions interleaved.
      expect(totalAllocated).toBeLessThanOrEqual(chargeAmountTiyin);

      const succeeded = [a, b].filter((r) => r.status === 201);
      expect(succeeded.length).toBeGreaterThanOrEqual(1);
    });
  });
});
