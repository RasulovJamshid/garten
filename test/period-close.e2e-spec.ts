import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { createTestApp, login } from './utils/create-app';

const OWNER_LOGIN = process.env.SEED_OWNER_EMAIL ?? 'owner@demo.local';
const OWNER_PASSWORD = process.env.SEED_OWNER_PASSWORD ?? 'ChangeMe12345!';

/**
 * 01-stage1-plan.md §7 lists "period-close rejection" as one of the
 * untested non-negotiables. billing-runs.service.ts / charges.service.ts
 * each independently re-check `period.status === 'closed'` at their own
 * write path (preview, commit, manual charge, reverse) — this proves all
 * four actually reject once closed, and that reopening un-blocks them.
 */
describe('Period close rejection (e2e)', () => {
  let app: INestApplication;
  let prefix: string;
  let prisma: PrismaClient;
  let token: string;
  let tenantId: string;
  let branchId: string;
  let periodId: string;
  let childId: string;
  let chargeId: string;
  // Periods, once created, are never deleted by this spec (POST /periods
  // 409s outright on a duplicate year/month — see AppErrors.duplicate —
  // and by the time this runs the period is closed, which the app also
  // refuses to delete). A fixed year/month would only pass once against
  // a persistent dev DB; randomized so repeated local runs each get an
  // untouched period (confirmed while adding this — see the identical
  // note in billing-concurrency.e2e-spec.ts).
  const YEAR = 2300 + Math.floor(Math.random() * 500);
  const MONTH = 1 + Math.floor(Math.random() * 12);

  beforeAll(async () => {
    ({ app, prefix } = await createTestApp());
    prisma = new PrismaClient();
    token = await login(app, prefix, OWNER_LOGIN, OWNER_PASSWORD);

    const tenant = await prisma.tenant.findFirstOrThrow({ where: { code: 'demo' } });
    tenantId = tenant.id;
    const branch = await prisma.branch.findFirstOrThrow({ where: { tenantId } });
    branchId = branch.id;

    const child = await prisma.child.create({
      data: {
        tenantId,
        branchId,
        firstName: 'E2E',
        lastName: `PeriodCloseTest-${Date.now()}`,
        birthDate: new Date('2021-01-01'),
      },
    });
    childId = child.id;

    const periodRes = await request(app.getHttpServer())
      .post(`${prefix}/periods`)
      .set('Authorization', `Bearer ${token}`)
      .send({ year: YEAR, month: MONTH })
      .expect(201);
    periodId = periodRes.body.id;

    // One open-period charge, created before close, so reverse-after-close
    // has something real to reverse.
    const chargeRes = await request(app.getHttpServer())
      .post(`${prefix}/charges`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        childId,
        periodId,
        amountTiyin: '100000',
        description: 'E2E pre-close charge',
      })
      .expect(201);
    chargeId = chargeRes.body.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('closes the period', async () => {
    await request(app.getHttpServer())
      .post(`${prefix}/periods/${periodId}/close`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
  });

  it('closing an already-closed period is a conflict, not a silent no-op', async () => {
    const res = await request(app.getHttpServer())
      .post(`${prefix}/periods/${periodId}/close`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(409);
  });

  it('a manual charge cannot be created in a closed period — 409 PERIOD_CLOSED', async () => {
    const res = await request(app.getHttpServer())
      .post(`${prefix}/charges`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        childId,
        periodId,
        amountTiyin: '50000',
        description: 'E2E should be rejected',
      });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PERIOD_CLOSED');
  });

  it('an existing charge cannot be reversed once its period is closed — 409 PERIOD_CLOSED', async () => {
    const res = await request(app.getHttpServer())
      .post(`${prefix}/charges/${chargeId}/reverse`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'E2E should be rejected' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PERIOD_CLOSED');
  });

  it('a billing-run preview for a closed period is rejected — 409 PERIOD_CLOSED', async () => {
    const res = await request(app.getHttpServer())
      .post(`${prefix}/billing-runs`)
      .set('Authorization', `Bearer ${token}`)
      .send({ year: YEAR, month: MONTH });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PERIOD_CLOSED');
  });

  it('reopening restores normal writes', async () => {
    await request(app.getHttpServer())
      .post(`${prefix}/periods/${periodId}/reopen`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'E2E test reopen' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`${prefix}/charges`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        childId,
        periodId,
        amountTiyin: '25000',
        description: 'E2E post-reopen charge',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`${prefix}/charges/${chargeId}/reverse`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'E2E post-reopen reversal' })
      .expect(201);
  });
});
