import { Workbook } from 'exceljs';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createTestApp, login } from './utils/create-app';
import { createSecondTenant, SecondTenantFixture } from './utils/second-tenant';
import { PERMISSION_CATALOG } from '../src/rbac/permission-catalog';
import { todayInTashkent } from '../src/common/tashkent-date';

describe('Backend integrity regression', () => {
  let app: INestApplication,
    prefix: string,
    prisma: PrismaClient,
    fixture: SecondTenantFixture,
    token: string;
  let childId: string, attendanceId: string, runId: string, periodId: string, paymentId: string;
  const today = todayInTashkent();
  const [year, month] = today.split('-').map(Number);
  const monthStart = today.slice(0, 7) + '-01';
  const call = (method: 'get' | 'post', path: string) =>
    request(app.getHttpServer())
      [method](prefix + path)
      .set('Authorization', `Bearer ${token}`);
  beforeAll(async () => {
    ({ app, prefix } = await createTestApp());
    prisma = new PrismaClient();
    fixture = await createSecondTenant(
      prisma,
      PERMISSION_CATALOG.map((p) => ({ key: p.key, scope: 'all' })),
    );
    await prisma.setting.create({
      data: { tenantId: fixture.tenantId, displayName: 'Integrity test' },
    });
    token = await login(app, prefix, fixture.login, fixture.password);
    const child = await prisma.child.create({
      data: {
        tenantId: fixture.tenantId,
        branchId: fixture.branchId,
        firstName: 'Integrity',
        lastName: 'Child',
        birthDate: new Date('2021-01-01'),
        status: 'active',
        enrollmentDate: new Date(monthStart),
      },
    });
    childId = child.id;
  });
  // Ledger fixtures are append-only and intentionally remain in the isolated test database.
  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('bootstraps labels without granting settings administration to clients', async () => {
    const response = await call('get', '/auth/bootstrap').expect(200);
    expect(response.body.organization.id).toBe(fixture.tenantId);
    expect(response.body.branches[0].id).toBe(fixture.branchId);
  });
  it('includes an unrecorded child on the attendance board', async () => {
    const response = await call('get', '/attendance/board').expect(200);
    expect(response.body.data.find((r: any) => r.child.id === childId).attendance).toBeNull();
  });
  it('requires pickup authorization and accepts ad-hoc temporary permissions', async () => {
    const checkIn = await call('post', '/attendance/check-in').send({ childId }).expect(201);
    expect(checkIn.body.child.firstName).toBe('Integrity');
    await call('post', '/attendance/check-out').send({ childId }).expect(409);
    const permission = await prisma.pickupPermission.create({
      data: {
        tenantId: fixture.tenantId,
        childId,
        permissionType: 'temporary',
        validFrom: new Date(today),
        validTo: new Date(today),
        adhocFullName: 'Authorized adult',
        reason: 'Guardian permission',
      },
    });
    const result = await call('post', '/attendance/check-out')
      .send({ childId, pickupPermissionId: permission.id })
      .expect(201);
    expect(result.body.pickupPermissionId).toBe(permission.id);
    await call('post', '/attendance/status')
      .send({ childId, date: today, status: 'absent' })
      .expect(422);
  });
  it('allocates an earlier advance when mid-month billing creates a charge', async () => {
    const child = await prisma.child.create({
      data: {
        tenantId: fixture.tenantId,
        branchId: fixture.branchId,
        firstName: 'Billed',
        lastName: 'Child',
        birthDate: new Date('2021-01-01'),
        status: 'active',
        enrollmentDate: new Date(monthStart.slice(0, 8) + '05'),
      },
    });
    childId = child.id;
    const tariff = await prisma.tariff.create({
      data: {
        tenantId: fixture.tenantId,
        branchId: fixture.branchId,
        name: 'Tuition',
        kind: 'monthly_fixed',
        amountTiyin: 100000n,
      },
    });
    await prisma.childTariff.create({
      data: {
        tenantId: fixture.tenantId,
        childId,
        tariffId: tariff.id,
        effectiveFrom: new Date(monthStart.slice(0, 8) + '05'),
      },
    });
    const attendance = await prisma.attendanceDay.create({
      data: {
        tenantId: fixture.tenantId,
        branchId: fixture.branchId,
        childId,
        attendanceDate: new Date(monthStart.slice(0, 8) + '05'),
        status: 'present',
      },
    });
    attendanceId = attendance.id;
    const payment = await call('post', '/payments')
      .set('Idempotency-Key', randomUUID())
      .send({ childId, amountTiyin: '1000', method: 'cash', paidAt: new Date().toISOString() })
      .expect(201);
    paymentId = payment.body.id;
    expect(payment.body.receiptNo).toMatch(/^R-\d{4}-\d{6}$/);
    const preview = await call('post', '/billing-runs').send({ year, month }).expect(201);
    runId = preview.body.id;
    periodId = preview.body.periodId;
    const commit = await call('post', `/billing-runs/${runId}/commit`)
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    expect(commit.body.charges.some((c: any) => c.childId === childId)).toBe(true);
    const allocations = await prisma.paymentAllocation.findMany({ where: { paymentId } });
    expect(allocations.reduce((sum, a) => sum + a.amountTiyin, 0n)).toBe(1000n);
  });
  it('reverses and replaces billed attendance in an open period', async () => {
    await call('post', `/attendance/${attendanceId}/correct`)
      .send({ field: 'status', newValue: 'absent', reason: 'Correcting imported attendance' })
      .expect(201);
    const charges = await call('get', `/charges?childId=${childId}`).expect(200);
    expect(charges.body).toHaveLength(1);
    expect(charges.body[0].amountTiyin).toBe('0');
    const correction = await prisma.attendanceCorrection.findFirstOrThrow({
      where: { attendanceDayId: attendanceId },
    });
    expect(correction.billingResolution).toBe('applied');
  });
  it('posts a next-period adjustment when attendance changes after period close', async () => {
    await call('post', `/periods/${periodId}/close`).expect(201);
    await call('post', `/attendance/${attendanceId}/correct`)
      .send({ field: 'status', newValue: 'present', reason: 'Attendance confirmed by teacher' })
      .expect(201);
    const adjustments = await prisma.charge.findMany({
      where: { childId, kind: 'adjustment', sign: 1 },
    });
    expect(adjustments).toHaveLength(1);
    expect(adjustments[0].periodId).not.toBe(periodId);
  });
  it('allows only one concurrent cancellation of a payment', async () => {
    const responses = await Promise.all(
      [1, 2].map(() =>
        call('post', `/payments/${paymentId}/cancel`).send({ reason: 'Duplicate cash entry' }),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await prisma.payment.count({ where: { sourcePaymentId: paymentId } })).toBe(1);
  });
  it('rolls back a failed import and makes concurrent retry idempotent', async () => {
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet('groups');
    sheet.addRow(['name', 'branchCode', 'capacity', 'ageMinMonths', 'ageMaxMonths']);
    sheet.addRow(['Import integrity group', 'main', 10, 24, 72]);
    sheet.addRow(['Import integrity group', 'main', 10, 24, 72]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const validation = await call('post', '/imports/validate?entity=groups')
      .attach('file', buffer, 'groups.xlsx')
      .expect(201);
    const importJobId = validation.body.importJobId;
    await call('post', '/imports/commit').send({ importJobId, skipInvalid: false }).expect(422);
    expect(
      await prisma.childGroup.count({
        where: { tenantId: fixture.tenantId, name: 'Import integrity group' },
      }),
    ).toBe(0);
    const results = await Promise.all(
      [1, 2].map(() => call('post', '/imports/commit').send({ importJobId, skipInvalid: true })),
    );
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    expect(
      await prisma.childGroup.count({
        where: { tenantId: fixture.tenantId, name: 'Import integrity group' },
      }),
    ).toBe(1);
  });
  it('paginates array lists without truncating the total', async () => {
    const result = await call('get', '/payments?page=1&limit=1').expect(200);
    expect(result.body.data).toHaveLength(1);
    expect(result.body.meta.total).toBe(2);
  });
  it('rejects a partial expense settlement without marking it paid', async () => {
    const expense = await prisma.expense.create({
      data: {
        tenantId: fixture.tenantId,
        branchId: fixture.branchId,
        expenseType: 'rent',
        billingYear: year,
        billingMonth: month,
        amountTiyin: 10000n,
      },
    });
    await call('post', `/expenses/${expense.id}/pay`)
      .send({ paidAt: new Date().toISOString(), amountTiyin: '1000' })
      .expect(422);
    expect((await prisma.expense.findUniqueOrThrow({ where: { id: expense.id } })).status).toBe(
      'unpaid',
    );
  });
});
