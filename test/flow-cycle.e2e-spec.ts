import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createTestApp, login } from './utils/create-app';
import { createSecondTenant, SecondTenantFixture } from './utils/second-tenant';
import { PERMISSION_CATALOG } from '../src/rbac/permission-catalog';
import { todayInTashkent } from '../src/common/tashkent-date';

describe('New family complete lifecycle through HTTP', () => {
  let app: INestApplication, prefix: string, db: PrismaClient;
  let fixture: SecondTenantFixture, token: string, childId: string, guardianId: string;
  let groupId: string, tariffId: string, periodId: string, runId: string, paymentId: string;
  const today = todayInTashkent();
  const [year, month] = today.split('-').map(Number);
  const call = (method: 'get' | 'post' | 'put' | 'patch', path: string) =>
    request(app.getHttpServer())
      [method](prefix + path)
      .set('Authorization', 'Bearer ' + token);
  beforeAll(async () => {
    ({ app, prefix } = await createTestApp());
    db = new PrismaClient();
    fixture = await createSecondTenant(
      db,
      PERMISSION_CATALOG.map((p) => ({ key: p.key, scope: 'all' })),
    );
    await db.setting.create({
      data: { tenantId: fixture.tenantId, displayName: 'Isolated lifecycle' },
    });
    token = await login(app, prefix, fixture.login, fixture.password);
  });
  afterAll(async () => {
    await db.$disconnect();
    await app.close();
  });

  it('starts empty, rejects invalid input, and creates a child without partial invalid records', async () => {
    const bootstrap = await call('get', '/auth/bootstrap').expect(200);
    expect(bootstrap.body.branches).toHaveLength(1);
    const rejected = await call('post', '/children')
      .send({
        branchId: fixture.branchId,
        firstName: 'Cycle',
        lastName: 'Family',
        birthDate: '2026-02-31',
      })
      .expect(400);
    expect(rejected.body.error.details.birthDate).toEqual(expect.any(Array));
    expect(await db.child.count({ where: { tenantId: fixture.tenantId } })).toBe(0);
    const child = await call('post', '/children')
      .send({
        branchId: fixture.branchId,
        firstName: 'Cycle',
        lastName: 'Family',
        birthDate: '2021-02-28',
        enrollmentDate: today,
      })
      .expect(201);
    childId = child.body.id;
    expect(child.body.status).toBe('applicant');
  });

  it('creates and links a guardian, detects duplicate contact, assigns a group and activates enrollment', async () => {
    const guardian = await call('post', '/guardians')
      .send({ fullName: 'Synthetic Parent', phone: '+998901234567' })
      .expect(201);
    guardianId = guardian.body.id;
    await call('post', '/guardians')
      .send({ fullName: 'Same Parent', phone: '90 123 45 67' })
      .expect(409);
    await call('post', '/children/' + childId + '/guardians')
      .send({
        guardianId,
        relationship: 'mother',
        isPayer: true,
        isPrimaryContact: true,
        isEmergencyContact: true,
      })
      .expect(201);
    const group = await call('post', '/groups')
      .send({ branchId: fixture.branchId, name: 'Cycle group', capacity: 5 })
      .expect(201);
    groupId = group.body.id;
    await call('post', '/groups/' + groupId + '/children')
      .send({ childId, effectiveDate: today })
      .expect(201);
    const missingReason = await call('post', '/children/' + childId + '/status')
      .send({ status: 'active', effectiveDate: today })
      .expect(400);
    expect(missingReason.body.error.details.reason).toEqual(expect.any(Array));
    await call('post', '/children/' + childId + '/status')
      .send({ status: 'active', effectiveDate: today, reason: 'Family enrollment completed' })
      .expect(201);
    expect((await call('get', '/children/' + childId).expect(200)).body.status).toBe('active');
  });

  it('saves and rereads medical data, documents and consent, then revokes consent', async () => {
    await call('put', '/children/' + childId + '/medical')
      .send({
        emergencyInstructions: 'Synthetic instructions',
        allergies: [{ allergen: 'Synthetic allergen', severity: 'mild' }],
        medications: [],
      })
      .expect(200);
    const medical = await call('get', '/children/' + childId + '/medical').expect(200);
    expect(JSON.stringify(medical.body)).toContain('Synthetic instructions');
    const doc = await call('post', '/children/' + childId + '/documents')
      .send({ type: 'birth_certificate', number: 'TEST-CYCLE', issueDate: '2021-03-01' })
      .expect(201);
    await call('post', '/children/' + childId + '/documents/' + doc.body.id + '/verify')
      .send({ verified: true })
      .expect(201);
    const consent = await call('post', '/children/' + childId + '/consents')
      .send({ guardianId, consentType: 'notifications', granted: true })
      .expect(201);
    await call('post', '/children/' + childId + '/consents/' + consent.body.id + '/revoke')
      .send({})
      .expect(201);
  });

  it('checks in once, verifies linked parent pickup, and removes the child from the inside list', async () => {
    await call('post', '/attendance/check-in').send({ childId }).expect(201);
    await call('post', '/attendance/check-in').send({ childId }).expect(409);
    await call('post', '/attendance/check-out').send({ childId }).expect(409);
    const verified = await call(
      'get',
      '/pickup/verify?childId=' + childId + '&guardianId=' + guardianId,
    ).expect(200);
    expect(verified.body.allowed).toBe(true);
    const checkout = await call('post', '/attendance/check-out')
      .send({ childId, guardianId })
      .expect(201);
    expect(checkout.body.pickupGuardianId).toBe(guardianId);
    const inside = await call('get', '/attendance/inside').expect(200);
    expect(JSON.stringify(inside.body)).not.toContain(childId);
  });

  it('assigns a tariff, previews and explains billing, then commits exactly once', async () => {
    const tariff = await call('post', '/tariffs')
      .send({
        branchId: fixture.branchId,
        name: 'Cycle tuition',
        kind: 'monthly_fixed',
        amountTiyin: '10000000',
      })
      .expect(201);
    tariffId = tariff.body.id;
    await call('post', '/children/' + childId + '/tariffs')
      .send({ tariffId, effectiveFrom: today })
      .expect(201);
    const preview = await call('post', '/billing-runs').send({ year, month }).expect(201);
    runId = preview.body.id;
    periodId = preview.body.periodId;
    expect(preview.body.lines.length).toBeGreaterThan(0);
    const explain = await call('get', '/billing-runs/' + runId + '/explain/' + childId).expect(200);
    expect(Array.isArray(explain.body)).toBe(true);
    await call('post', '/billing-runs/' + runId + '/commit')
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    await call('post', '/billing-runs/' + runId + '/commit')
      .set('Idempotency-Key', randomUUID())
      .expect(409);
    expect(await db.charge.count({ where: { childId, sign: 1 } })).toBe(1);
  });

  it('pays the exact debt, retries safely, rereads allocations and receipt, then cancels to restore debt', async () => {
    const debt = await call('get', '/debts/' + childId).expect(200);
    const amount = debt.body.currentDebtTiyin;
    expect(BigInt(amount)).toBeGreaterThan(0n);
    const key = randomUUID();
    const dto = {
      childId,
      payerGuardianId: guardianId,
      amountTiyin: amount,
      method: 'cash',
      paidAt: new Date().toISOString(),
    };
    const payment = await call('post', '/payments')
      .set('Idempotency-Key', key)
      .send(dto)
      .expect(201);
    paymentId = payment.body.id;
    const replay = await call('post', '/payments')
      .set('Idempotency-Key', key)
      .send(dto)
      .expect(201);
    expect(replay.body.id).toBe(paymentId);
    const detail = await call('get', '/payments/' + paymentId).expect(200);
    expect(detail.body.paymentAllocation.length).toBeGreaterThan(0);
    expect((await call('get', '/debts/' + childId).expect(200)).body.currentDebtTiyin).toBe('0');
    const charges = await call('get', '/children/' + childId + '/charges').expect(200);
    expect(charges.body[0].accountingPeriod).toEqual({ year, month });
    expect(charges.body[0].allocatedTiyin).toBe(amount);
    expect(charges.body[0].issuedAt).toEqual(expect.any(String));
    const paymentList = await call('get', '/payments?childId=' + childId).expect(200);
    expect(paymentList.body[0].recordedByName).toEqual(expect.any(String));
    await call('get', '/payments/' + paymentId + '/receipt').expect(200);
    await call('post', '/payments/' + paymentId + '/cancel')
      .send({ reason: 'Synthetic lifecycle cancellation' })
      .expect(201);
    expect((await call('get', '/debts/' + childId).expect(200)).body.currentDebtTiyin).toBe(amount);
  });

  it('creates an expense, rejects partial payment, settles it, and closes/reopens the period', async () => {
    const expense = await call('post', '/expenses')
      .send({
        branchId: fixture.branchId,
        type: 'rent',
        billingYear: year,
        billingMonth: month,
        amountTiyin: '500000',
        dueDate: today,
      })
      .expect(201);
    await call('post', '/expenses/' + expense.body.id + '/pay')
      .send({ paidAt: new Date().toISOString(), amountTiyin: '100000' })
      .expect(422);
    await call('post', '/expenses/' + expense.body.id + '/pay')
      .send({ paidAt: new Date().toISOString(), amountTiyin: '500000' })
      .expect(201);
    await call('post', '/periods/' + periodId + '/close')
      .send({})
      .expect(201);
    await call('post', '/periods/' + periodId + '/reopen')
      .send({ reason: 'Synthetic cycle review' })
      .expect(201);
  });

  it('withdraws the child, ends assignments, and retains the full status history', async () => {
    await call('post', '/children/' + childId + '/status')
      .send({ status: 'withdrawn', effectiveDate: today, reason: 'Synthetic family departure' })
      .expect(201);
    expect((await call('get', '/children/' + childId).expect(200)).body.status).toBe('withdrawn');
    const history = await call('get', '/children/' + childId + '/history').expect(200);
    expect(history.body.some((row: { newStatus: string }) => row.newStatus === 'active')).toBe(
      true,
    );
    expect(history.body.some((row: { newStatus: string }) => row.newStatus === 'withdrawn')).toBe(
      true,
    );
    expect(await db.childTariff.count({ where: { childId, effectiveTo: null } })).toBe(0);
    expect(await db.groupAssignment.count({ where: { childId, effectiveTo: null } })).toBe(0);
  });
});
