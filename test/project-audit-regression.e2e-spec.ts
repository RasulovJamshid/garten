// Regression coverage for the defects reproduced in the October project audit.
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { randomUUID, createHash } from 'node:crypto';
import { createTestApp } from './utils/create-app';
import { PERMISSION_CATALOG } from '../src/rbac/permission-catalog';
import { DEFAULT_BILLING_RULES } from '../src/billing/default-billing-rules';
import { BillingRunsService } from '../src/billing/billing-runs.service';

describe('October audit regressions', () => {
  let app: INestApplication, prefix: string, db: PrismaClient;
  let tenantId: string, branchA: string, branchB: string, ownerId: string, ownerToken: string;
  const api = (token: string, method: 'get' | 'post' | 'patch', path: string) =>
    request(app.getHttpServer())
      [method](prefix + path)
      .set('Authorization', `Bearer ${token}`);
  const sign = (userId: string) => app.get(JwtService).signAsync({ sub: userId, tid: tenantId });
  async function user(grants: { key: string; scope: string }[], branches = [branchA]) {
    const role = await db.role.create({
      data: {
        tenantId,
        code: randomUUID(),
        nameUz: 'Audit',
        nameRu: 'Audit',
        rolePermission: { create: grants.map((g) => ({ permissionKey: g.key, scope: g.scope })) },
      },
    });
    const value = await db.appUser.create({
      data: {
        tenantId,
        fullName: 'Audit user',
        phone: randomUUID(),
        passwordHash: 'unused',
        userBranch: { create: branches.map((branchId) => ({ branchId })) },
        userRole: { create: branches.map((branchId) => ({ branchId, roleId: role.id })) },
      },
    });
    return { id: value.id, token: await sign(value.id) };
  }
  const child = (firstName: string, branchId = branchA) =>
    db.child.create({
      data: {
        tenantId,
        branchId,
        firstName,
        lastName: 'Audit',
        status: 'active',
        birthDate: new Date('2021-01-01'),
        enrollmentDate: new Date('2026-09-01'),
      },
    });
  beforeAll(async () => {
    ({ app, prefix } = await createTestApp());
    db = new PrismaClient();
    tenantId = (
      await db.tenant.create({ data: { code: `oct-audit-${randomUUID()}`, name: 'October audit' } })
    ).id;
    branchA = (await db.branch.create({ data: { tenantId, code: 'A', name: 'A' } })).id;
    branchB = (await db.branch.create({ data: { tenantId, code: 'B', name: 'B' } })).id;
    await db.setting.create({ data: { tenantId, displayName: 'October audit' } });
    const owner = await user(
      PERMISSION_CATALOG.map((p) => ({ key: p.key, scope: 'all' })),
      [branchA, branchB],
    );
    ownerId = owner.id;
    ownerToken = owner.token;
  });
  afterAll(async () => {
    await db.$disconnect();
    await app.close();
  });
  it('keeps group report filters inside the permitted group', async () => {
    const reader = await user([
      { key: 'child:read', scope: 'own_group' },
      { key: 'report:read', scope: 'all' },
    ]);
    const own = await db.childGroup.create({
      data: { tenantId, branchId: branchA, name: randomUUID() },
    });
    const other = await db.childGroup.create({
      data: { tenantId, branchId: branchA, name: randomUUID() },
    });
    await db.groupStaff.create({
      data: { tenantId, groupId: own.id, userId: reader.id, staffRole: 'main_teacher' },
    });
    const outsider = await child('Foreign group');
    await db.groupAssignment.create({
      data: {
        tenantId,
        childId: outsider.id,
        groupId: other.id,
        effectiveFrom: new Date('2026-09-01'),
      },
    });
    const denied = await api(reader.token, 'get', `/children/${outsider.id}`);
    expect(denied.status).toBe(404);
    const report = await api(
      reader.token,
      'get',
      `/reports/children/active?groupId=${other.id}`,
    ).expect(200);
    expect(report.body).toHaveLength(0);
  });
  it('excludes canceled and out-of-branch payments from dashboard totals', async () => {
    const reader = await user(
      ['dashboard:read', 'payment:read', 'charge:read', 'debt:read', 'expense:read'].map((key) => ({
        key,
        scope: key === 'dashboard:read' ? 'all' : 'branch',
      })),
    );
    const outsider = await child('Branch B payer', branchB);
    const original = await db.payment.create({
      data: {
        tenantId,
        branchId: branchB,
        childId: outsider.id,
        amountTiyin: 73100n,
        sign: 1,
        method: 'cash',
        recordedBy: ownerId,
        paidAt: new Date(),
      },
    });
    await db.payment.create({
      data: {
        tenantId,
        branchId: branchB,
        childId: outsider.id,
        amountTiyin: 73100n,
        sign: -1,
        method: 'cash',
        recordedBy: ownerId,
        sourcePaymentId: original.id,
        paidAt: new Date(),
      },
    });
    const list = await api(reader.token, 'get', '/payments').expect(200);
    expect(list.body).toHaveLength(0);
    const dashboard = await api(reader.token, 'get', '/dashboard/accountant').expect(200);
    expect(dashboard.body.paymentsToday.totalTiyin).toBe('0');
  });
  it('rejects delegation beyond permitted branches', async () => {
    const actor = await user([
      { key: 'user:manage', scope: 'all' },
      { key: 'payment:read', scope: 'branch' },
    ]);
    const role = await db.role.create({
      data: {
        tenantId,
        code: randomUUID(),
        nameUz: 'Payment reader',
        nameRu: 'Payment reader',
        rolePermission: { create: [{ permissionKey: 'payment:read', scope: 'branch' }] },
      },
    });
    const response = await api(actor.token, 'post', '/users')
      .send({
        fullName: 'Escalated branch reader',
        phone: randomUUID(),
        password: 'AuditOnly12345!',
        roleId: role.id,
        branchIds: [branchB],
      })
      .expect(403);
    expect(response.body.error.code).toBe('PRIVILEGE_ESCALATION');
  });
  it('bills both enrollment episodes in the same month', async () => {
    const value = await child('Returning child');
    const tariff = await db.tariff.create({
      data: { tenantId, name: 'Tuition', kind: 'monthly_fixed', amountTiyin: 220000n },
    });
    await api(ownerToken, 'post', `/children/${value.id}/tariffs`)
      .send({ tariffId: tariff.id, effectiveFrom: '2026-09-01' })
      .expect(201);
    for (const day of ['2026-09-02', '2026-09-21'])
      await db.attendanceDay.create({
        data: {
          tenantId,
          branchId: branchA,
          childId: value.id,
          attendanceDate: new Date(day),
          status: 'present',
        },
      });
    await api(ownerToken, 'post', `/children/${value.id}/status`)
      .send({ status: 'withdrawn', effectiveDate: '2026-09-10', reason: 'Family relocation' })
      .expect(201);
    await api(ownerToken, 'post', `/children/${value.id}/status`)
      .send({ status: 'active', effectiveDate: '2026-09-20', reason: 'Family returned' })
      .expect(201);
    await api(ownerToken, 'post', `/children/${value.id}/tariffs`)
      .send({ tariffId: tariff.id, effectiveFrom: '2026-09-20' })
      .expect(201);
    const preview = await api(ownerToken, 'post', '/billing-runs')
      .send({ year: 2026, month: 9 })
      .expect(201);
    const line = preview.body.lines.find((l: any) => l.childId === value.id);
    expect(line.attendedDays).toBe(2);
  });
  it('preserves segmented flat fees without attendance', async () => {
    const value = await child('Flat fee child');
    const rules = structuredClone(DEFAULT_BILLING_RULES);
    rules.attendance.noAttendanceBehaviour = 'min_charge';
    rules.attendance.minChargeTiyin = '500';
    const context = {
      start: '2026-09-01',
      end: '2026-09-30',
      billableDays: 22,
      attendedDays: 0,
      fixedDiscountsTiyin: [],
      percentDiscountsBp: [],
      workingDays: 22,
      forceFullTariff: false,
    };
    const segments = [
      {
        tariffId: 'old',
        effectiveFrom: new Date('2026-09-01'),
        effectiveTo: new Date('2026-09-15'),
        tariff: { name: 'Old flat', kind: 'extra_class', amountTiyin: 22000n },
      },
      {
        tariffId: 'new',
        effectiveFrom: new Date('2026-09-16'),
        effectiveTo: null,
        tariff: { name: 'New flat', kind: 'extra_class', amountTiyin: 44000n },
      },
    ];
    const svc = new BillingRunsService(
      { db, tenantId } as any,
      {} as any,
      {
        computeChildContext: async (
          _id: string,
          _y: number,
          _m: number,
          _r: any,
          _db: any,
          window?: any,
        ) => ({ ...context, workingDays: window ? 11 : 22 }),
      } as any,
      {} as any,
      {} as any,
      {} as any,
    );
    const [line] = await svc.computeAllLines(2026, 9, rules, db, value.id, segments);
    expect(line.amountTiyin).toBe('33000');
  });
  it('allows only one concurrent refresh of a token', async () => {
    const raw = 'audit-refresh-token';
    const session = await db.userSession.create({
      data: {
        tenantId,
        userId: ownerId,
        expiresAt: new Date(Date.now() + 60000),
        refreshTokenHash: createHash('sha256').update(raw).digest('hex'),
      },
    });
    const before = await db.userSession.count({ where: { userId: ownerId } });
    const responses = await Promise.all(
      [1, 2].map(() =>
        request(app.getHttpServer())
          .post(prefix + '/auth/refresh')
          .set('Cookie', `kg_refresh=${session.id}.${raw}`),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([200, 401]);
    expect(await db.userSession.count({ where: { userId: ownerId } })).toBe(before + 1);
  });
  it('rejects a branch move while incompatible assignments remain', async () => {
    const value = await child('Moved child');
    const group = await db.childGroup.create({
      data: { tenantId, branchId: branchA, name: randomUUID() },
    });
    await db.groupAssignment.create({
      data: {
        tenantId,
        childId: value.id,
        groupId: group.id,
        effectiveFrom: new Date('2026-09-01'),
      },
    });
    const tariff = await db.tariff.create({
      data: {
        tenantId,
        branchId: branchA,
        name: 'A only',
        kind: 'monthly_fixed',
        amountTiyin: 20000n,
      },
    });
    await db.childTariff.create({
      data: {
        tenantId,
        childId: value.id,
        tariffId: tariff.id,
        effectiveFrom: new Date('2026-09-01'),
      },
    });
    await api(ownerToken, 'patch', `/children/${value.id}`).send({ branchId: branchB }).expect(409);
    const updated = await db.child.findUniqueOrThrow({
      where: { id: value.id },
      include: {
        groupAssignment: { include: { childGroup: true } },
        childTariff: { include: { tariff: true } },
      },
    });
    expect(updated.branchId).toBe(branchA);
    expect(updated.groupAssignment[0].childGroup.branchId).toBe(branchA);
    expect(updated.childTariff[0].tariff.branchId).toBe(branchA);
  });
  it('includes emergency instructions in medical warning badges', async () => {
    const value = await child('Emergency child');
    await db.medicalRecord.create({
      data: {
        tenantId,
        childId: value.id,
        emergencyInstructions: 'Emergency response instructions',
      },
    });
    const directory = await api(ownerToken, 'get', '/children?q=Emergency').expect(200);
    expect(directory.body.data[0].hasMedicalAlert).toBe(true);
    const alert = await api(ownerToken, 'get', `/children/${value.id}/medical/alerts`).expect(200);
    expect(alert.body.emergencyInstructions).toBeTruthy();
    const report = await api(ownerToken, 'get', '/reports/children/medical-alerts').expect(200);
    expect(report.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ instruction: 'Emergency response instructions' }),
      ]),
    );
  });
  it('rejects paying expenses outside manage scope', async () => {
    const actor = await user([
      { key: 'expense:read', scope: 'all' },
      { key: 'expense:manage', scope: 'branch' },
    ]);
    const expense = await db.expense.create({
      data: {
        tenantId,
        branchId: branchB,
        expenseType: 'other',
        billingYear: 2026,
        billingMonth: 9,
        amountTiyin: 12500n,
        createdBy: ownerId,
      },
    });
    await api(actor.token, 'patch', `/expenses/${expense.id}`)
      .send({ note: 'Denied edit' })
      .expect(404);
    await api(actor.token, 'post', `/expenses/${expense.id}/pay`)
      .send({ paidAt: new Date().toISOString(), amountTiyin: '12500' })
      .expect(404);
    expect((await db.expense.findUniqueOrThrow({ where: { id: expense.id } })).status).toBe(
      'unpaid',
    );
  });
  it('allows expense payment without an expense read grant', async () => {
    const actor = await user([{ key: 'expense:manage', scope: 'branch' }]);
    const expense = await db.expense.create({
      data: {
        tenantId,
        branchId: branchA,
        expenseType: 'other',
        billingYear: 2026,
        billingMonth: 9,
        amountTiyin: 12500n,
        createdBy: ownerId,
      },
    });
    await api(actor.token, 'post', `/expenses/${expense.id}/pay`)
      .send({ paidAt: new Date().toISOString(), amountTiyin: '12500' })
      .expect(201);
  });
  it('applies medical warning filters to emergency instructions', async () => {
    const yes = await api(ownerToken, 'get', '/children?q=Emergency&hasMedicalAlert=true').expect(
      200,
    );
    const no = await api(ownerToken, 'get', '/children?q=Emergency&hasMedicalAlert=false').expect(
      200,
    );
    expect(yes.body.data).toHaveLength(1);
    expect(no.body.data).toHaveLength(0);
  });
  it('deduplicates manual notification retries and rejects changed payloads', async () => {
    const key = randomUUID(),
      templateKey = randomUUID();
    await db.notificationTemplate.create({
      data: {
        tenantId,
        templateKey,
        bodyRu: 'Hello {message}',
        bodyUz: 'Hello {message}',
        includeAmounts: true,
      },
    });
    const body = {
      templateKey,
      channel: 'internal',
      recipients: [{ userId: ownerId }],
      data: { message: 'Audit' },
    };
    const send = (payload: any) =>
      api(ownerToken, 'post', '/notifications/send').set('Idempotency-Key', key).send(payload);
    const [first, second] = await Promise.all([send(body).expect(201), send(body).expect(201)]);
    expect(first.body.results[0].notificationId).toBe(second.body.results[0].notificationId);
    await send({ ...body, data: { message: 'Changed' } }).expect(409);
    expect(await db.notification.count({ where: { tenantId, templateKey } })).toBe(1);
  });
  it('blocks expired export metadata and downloads', async () => {
    const file = await db.file.create({
      data: {
        tenantId,
        bucket: 'local',
        objectKey: randomUUID(),
        originalName: 'audit.xlsx',
        mimeType: 'application/octet-stream',
        sizeBytes: 1n,
        entityType: 'export_job',
        uploadedBy: ownerId,
      },
    });
    const job = await db.exportJob.create({
      data: {
        tenantId,
        reportKey: 'children/active',
        format: 'xlsx',
        status: 'completed',
        createdBy: ownerId,
        fileId: file.id,
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    await api(ownerToken, 'get', `/exports/${job.id}`).expect(404);
    await api(ownerToken, 'get', `/files/${file.id}`).expect(404);
  });
  it('blocks unexpired exports after report access is revoked', async () => {
    const reader = await user([{ key: 'file:read', scope: 'all' }]);
    const file = await db.file.create({
      data: {
        tenantId,
        bucket: 'local',
        objectKey: randomUUID(),
        originalName: 'audit.xlsx',
        mimeType: 'application/octet-stream',
        sizeBytes: 1n,
        entityType: 'export_job',
        uploadedBy: reader.id,
      },
    });
    await db.exportJob.create({
      data: {
        tenantId,
        reportKey: 'children/active',
        format: 'xlsx',
        status: 'completed',
        createdBy: reader.id,
        fileId: file.id,
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    await api(reader.token, 'get', `/files/${file.id}`).expect(403);
  });
  it('checks destination permission branches for role assignment and replacement', async () => {
    const actor = await user([
      { key: 'user:manage', scope: 'all' },
      { key: 'payment:read', scope: 'branch' },
    ]);
    const target = await user([], [branchB]);
    const role = await db.role.create({
      data: {
        tenantId,
        code: randomUUID(),
        nameUz: 'Reader',
        nameRu: 'Reader',
        rolePermission: { create: [{ permissionKey: 'payment:read', scope: 'branch' }] },
      },
    });
    await api(actor.token, 'post', `/users/${target.id}/roles`)
      .send({ roleId: role.id, branchId: branchB })
      .expect(403);
    await request(app.getHttpServer())
      .put(prefix + `/users/${target.id}/roles`)
      .set('Authorization', `Bearer ${actor.token}`)
      .send({ roles: [{ roleId: role.id, branchId: branchB }] })
      .expect(403);
    expect(await db.userRole.count({ where: { userId: target.id, roleId: role.id } })).toBe(0);
  });
  it('rejects branch expansion that would expand existing role grants', async () => {
    const actor = await user([
      { key: 'user:manage', scope: 'all' },
      { key: 'payment:read', scope: 'branch' },
    ]);
    const target = await user([{ key: 'payment:read', scope: 'branch' }]);
    await api(actor.token, 'patch', `/users/${target.id}`)
      .send({ branchIds: [branchA, branchB] })
      .expect(403);
    expect(await db.userBranch.count({ where: { userId: target.id } })).toBe(1);
  });
  it('rejects overrides outside the actor permission branches', async () => {
    const actor = await user([
      { key: 'role:manage:sensitive', scope: 'all' },
      { key: 'payment:read', scope: 'branch' },
    ]);
    const target = await user([], [branchB]);
    await api(actor.token, 'post', `/users/${target.id}/permission-overrides`)
      .send({
        key: 'payment:read',
        scope: 'branch',
        effect: 'grant',
        reason: 'Audit permission grant',
      })
      .expect(403);
  });
  it('rejects expanding an assigned role outside the actor branches', async () => {
    const actor = await user([
      { key: 'role:manage', scope: 'all' },
      { key: 'payment:read', scope: 'branch' },
    ]);
    const target = await user([], [branchB]);
    const assignment = await db.userRole.findFirstOrThrow({ where: { userId: target.id } });
    await api(actor.token, 'post', `/roles/${assignment.roleId}/permissions`)
      .send({ key: 'payment:read', scope: 'branch' })
      .expect(403);
  });
  it('consumes a password reset code only once under concurrency', async () => {
    const target = await user([]);
    const token = randomUUID();
    await db.passwordResetToken.create({
      data: { tenantId, userId: target.id, token, expiresAt: new Date(Date.now() + 60000) },
    });
    const responses = await Promise.all(
      [1, 2].map(() =>
        request(app.getHttpServer())
          .post(prefix + '/auth/reset-password')
          .send({ token, newPassword: 'AuditReset12345!' }),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([200, 422]);
  });
  it('rolls payment and reversal writes back when their audit insert fails', async () => {
    const value = await child('Audit failure');
    const period = await db.accountingPeriod.upsert({
      where: { tenantId_year_month: { tenantId, year: 2026, month: 9 } },
      create: { tenantId, year: 2026, month: 9 },
      update: {},
    });
    const charge = await db.charge.create({
      data: {
        tenantId,
        branchId: branchA,
        childId: value.id,
        periodId: period.id,
        kind: 'manual',
        amountTiyin: 20000n,
        createdBy: ownerId,
      },
    });
    const name = 'audit_failure_' + randomUUID().replaceAll('-', '');
    await db.$executeRawUnsafe(
      `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.user_id='${ownerId}'::uuid AND NEW.action IN ('payment.create','charge.reverse') THEN RAISE EXCEPTION 'Audit failure injected by regression'; END IF; RETURN NEW; END $$`,
    );
    await db.$executeRawUnsafe(
      `CREATE TRIGGER ${name} BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION ${name}()`,
    );
    try {
      const key = randomUUID();
      await api(ownerToken, 'post', '/payments')
        .set('Idempotency-Key', key)
        .send({
          childId: value.id,
          amountTiyin: '10000',
          method: 'cash',
          paidAt: new Date().toISOString(),
        })
        .expect(500);
      expect(await db.payment.count({ where: { tenantId, idempotencyKey: key } })).toBe(0);
      await api(ownerToken, 'post', `/charges/${charge.id}/reverse`)
        .send({ reason: 'Audit rollback verification' })
        .expect(500);
      expect(await db.charge.count({ where: { sourceChargeId: charge.id } })).toBe(0);
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${name} ON audit_log`);
      await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${name}()`);
    }
  });
  it('keeps explicit branch filters within child read scope', async () => {
    const reader = await user([{ key: 'child:read', scope: 'branch' }]);
    const result = await api(reader.token, 'get', `/children?branchId=${branchB}`).expect(200);
    expect(result.body.data).toHaveLength(0);
  });
});
