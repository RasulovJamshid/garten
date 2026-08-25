import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { createTestApp, login } from './utils/create-app';

const OWNER_LOGIN = process.env.SEED_OWNER_EMAIL ?? 'owner@demo.local';
const OWNER_PASSWORD = process.env.SEED_OWNER_PASSWORD ?? 'ChangeMe12345!';

/**
 * Exercises the FIFO/idempotency allocation path end to end over the real
 * HTTP layer. Charges/payments are append-only (an immutability trigger
 * rejects UPDATE/DELETE — confirmed while building this suite), so the
 * fixtures this creates are intentionally left in place afterward, named
 * so they're identifiable ("E2E ...") rather than deleted.
 */
describe('Payments FIFO + idempotency (e2e)', () => {
  let app: INestApplication;
  let prefix: string;
  let prisma: PrismaClient;
  let token: string;
  let childId: string;
  let chargeId: string;
  const chargeAmountTiyin = 10_000_00n; // 10,000 som

  beforeAll(async () => {
    ({ app, prefix } = await createTestApp());
    prisma = new PrismaClient();
    token = await login(app, prefix, OWNER_LOGIN, OWNER_PASSWORD);

    const tenant = await prisma.tenant.findFirstOrThrow({ where: { code: 'demo' } });
    const branch = await prisma.branch.findFirstOrThrow({ where: { tenantId: tenant.id } });
    const period = await prisma.accountingPeriod.upsert({
      where: { tenantId_year_month: { tenantId: tenant.id, year: 2099, month: 1 } },
      create: { tenantId: tenant.id, year: 2099, month: 1, status: 'open' },
      update: {},
    });

    const child = await prisma.child.create({
      data: {
        tenantId: tenant.id,
        branchId: branch.id,
        firstName: 'E2E',
        lastName: `PaymentsTest-${Date.now()}`,
        birthDate: new Date('2021-01-01'),
      },
    });
    childId = child.id;

    const charge = await prisma.charge.create({
      data: {
        tenantId: tenant.id,
        branchId: branch.id,
        childId: child.id,
        periodId: period.id,
        kind: 'manual',
        amountTiyin: chargeAmountTiyin,
        sign: 1,
        description: 'E2E test charge',
      },
    });
    chargeId = charge.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('requires an Idempotency-Key header', async () => {
    const res = await request(app.getHttpServer())
      .post(`${prefix}/payments`)
      .set('Authorization', `Bearer ${token}`)
      .send({ childId, amountTiyin: '500000', method: 'cash', paidAt: '2099-01-15' });
    expect(res.status).toBe(400);
  });

  let paymentId: string;
  const idempotencyKey = randomUUID();

  it('creates a payment allocated against the charge', async () => {
    const res = await request(app.getHttpServer())
      .post(`${prefix}/payments`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ childId, amountTiyin: '500000', method: 'cash', paidAt: '2099-01-15' })
      .expect(201);
    expect(res.body.id).toEqual(expect.any(String));
    paymentId = res.body.id;
    expect(res.body.paymentAllocation.length).toBeGreaterThan(0);
    const allocated = res.body.paymentAllocation.reduce(
      (acc: bigint, a: any) => acc + BigInt(a.amountTiyin),
      0n,
    );
    expect(allocated).toBe(500000n);
  });

  it('replays the same Idempotency-Key as the identical payment, not a duplicate', async () => {
    const res = await request(app.getHttpServer())
      .post(`${prefix}/payments`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ childId, amountTiyin: '500000', method: 'cash', paidAt: '2099-01-15' })
      .expect(201);
    expect(res.body.id).toBe(paymentId);

    const allPayments = await prisma.payment.findMany({ where: { childId, sign: 1 } });
    expect(allPayments.filter((p) => p.idempotencyKey === idempotencyKey)).toHaveLength(1);
  });

  it('the charge now shows the correct outstanding balance', async () => {
    const res = await request(app.getHttpServer())
      .get(`${prefix}/children/${childId}/charges`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const charge = res.body.find((c: any) => c.id === chargeId);
    expect(BigInt(charge.outstandingTiyin)).toBe(chargeAmountTiyin - 500000n);
  });

  it('cancelling the payment reopens the charge for the cancelled amount', async () => {
    await request(app.getHttpServer())
      .post(`${prefix}/payments/${paymentId}/cancel`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'e2e test cancellation' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get(`${prefix}/children/${childId}/charges`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const charge = res.body.find((c: any) => c.id === chargeId);
    expect(BigInt(charge.outstandingTiyin)).toBe(chargeAmountTiyin);
  });
});
