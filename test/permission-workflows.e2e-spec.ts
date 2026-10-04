import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { createTestApp } from './utils/create-app';
import { ROLE_GRANTS } from '../src/rbac/default-role-grants';
import { todayInTashkent } from '../src/common/tashkent-date';

describe('Limited-role workflow permissions', () => {
  let app: INestApplication, prefix: string, db: PrismaClient;
  let tenantId: string, branchA: string, branchB: string;
  let ownGroup: string, otherGroup: string;
  let childA: string, childOther: string, childB: string, payerA: string, payerB: string;
  const today = todayInTashkent();
  const api = (token: string, method: 'get' | 'post', path: string) =>
    request(app.getHttpServer())
      [method](prefix + path)
      .set('Authorization', `Bearer ${token}`);
  async function user(grants: { key: string; scope: string }[], branches = [branchA]) {
    const role = await db.role.create({
      data: {
        tenantId,
        code: randomUUID(),
        nameUz: 'Workflow test',
        nameRu: 'Workflow test',
        rolePermission: { create: grants.map((g) => ({ permissionKey: g.key, scope: g.scope })) },
      },
    });
    const value = await db.appUser.create({
      data: {
        tenantId,
        fullName: 'Workflow test',
        phone: randomUUID(),
        passwordHash: 'unused',
        userBranch: { create: branches.map((branchId) => ({ branchId })) },
        userRole: { create: branches.map((branchId) => ({ branchId, roleId: role.id })) },
      },
    });
    const token = await app.get(JwtService).signAsync({ sub: value.id, tid: tenantId });
    return { id: value.id, token };
  }
  async function assign(userId: string, groupId = ownGroup) {
    await db.groupStaff.create({
      data: {
        tenantId,
        userId,
        groupId,
        staffRole: 'main_teacher',
        assignedFrom: new Date(today),
        assignedTo: new Date(today),
      },
    });
  }
  beforeAll(async () => {
    ({ app, prefix } = await createTestApp());
    db = new PrismaClient();
    tenantId = (
      await db.tenant.create({
        data: { code: `permission-workflows-${randomUUID()}`, name: 'Permission workflows' },
      })
    ).id;
    branchA = (await db.branch.create({ data: { tenantId, code: 'A', name: 'A' } })).id;
    branchB = (await db.branch.create({ data: { tenantId, code: 'B', name: 'B' } })).id;
    await db.setting.create({ data: { tenantId, displayName: 'Permission workflows' } });
    ownGroup = (await db.childGroup.create({ data: { tenantId, branchId: branchA, name: 'Own' } }))
      .id;
    otherGroup = (
      await db.childGroup.create({ data: { tenantId, branchId: branchA, name: 'Other' } })
    ).id;
    await db.childGroup.create({ data: { tenantId, branchId: branchB, name: 'Branch B' } });
    async function child(branchId: string, name: string, groupId?: string) {
      const value = await db.child.create({
        data: {
          tenantId,
          branchId,
          firstName: name,
          lastName: 'Workflow',
          status: 'active',
          birthDate: new Date('2021-01-01'),
          enrollmentDate: new Date(today),
          address: 'Private address',
        },
      });
      if (groupId)
        await db.groupAssignment.create({
          data: {
            tenantId,
            childId: value.id,
            groupId,
            effectiveFrom: new Date(today),
          },
        });
      return value.id;
    }
    childA = await child(branchA, 'Assigned', ownGroup);
    childOther = await child(branchA, 'Unassigned', otherGroup);
    childB = await child(branchB, 'Finance only');
    for (const [childId, label] of [
      [childA, 'A'],
      [childB, 'B'],
    ]) {
      const guardian = await db.guardian.create({
        data: {
          tenantId,
          fullName: `Payer ${label}`,
          phone: randomUUID(),
          passportNumber: 'Private',
        },
      });
      await db.childGuardian.create({
        data: {
          tenantId,
          childId,
          guardianId: guardian.id,
          relationship: 'parent',
          isPayer: true,
        },
      });
      if (label === 'A') payerA = guardian.id;
      else payerB = guardian.id;
    }
  });
  afterAll(async () => {
    await db.$disconnect();
    await app.close();
  });

  it('lets teachers list assigned children and group labels on their last assignment day', async () => {
    const teacher = await user(ROLE_GRANTS.teacher);
    await assign(teacher.id);
    const children = await api(teacher.token, 'get', '/children?limit=200').expect(200);
    expect(children.body.data.map((c: any) => c.id)).toEqual([childA]);
    const bootstrap = await api(teacher.token, 'get', '/auth/bootstrap').expect(200);
    expect(bootstrap.body.groups.map((g: any) => g.id)).toEqual([ownGroup]);
    await api(teacher.token, 'get', '/groups').expect(403);
    await api(teacher.token, 'get', `/children/${childOther}`).expect(404);
    await api(teacher.token, 'get', `/children/${childA}/consents`).expect(403);
    await api(teacher.token, 'get', `/children/${childA}/medical`).expect(403);
    await api(teacher.token, 'get', `/children/${childA}/medical/alerts`).expect(200);
    await api(teacher.token, 'get', '/children?hasDebt=true').expect(403);
  });

  it('does not widen teacher bootstrap groups with a tenant-wide report grant', async () => {
    const teacher = await user([...ROLE_GRANTS.teacher, { key: 'report:read', scope: 'all' }]);
    await assign(teacher.id);
    const response = await api(teacher.token, 'get', '/auth/bootstrap').expect(200);
    expect(response.body.groups.map((g: any) => g.id)).toEqual([ownGroup]);
    expect(response.body.branches.map((b: any) => b.id)).toEqual([branchA]);
    const lookup = await api(
      teacher.token,
      'get',
      `/lookups/children?permission=child:read&groupId=${otherGroup}`,
    ).expect(200);
    expect(lookup.body.data).toEqual([]);
  });

  it('keeps reception attendance today-only and rejects correction access', async () => {
    const reception = await user(ROLE_GRANTS.reception);
    const board = await api(reception.token, 'get', '/attendance/board').expect(200);
    expect(board.body.data.map((r: any) => r.child.id).sort()).toEqual([childA, childOther].sort());
    const history = await api(
      reception.token,
      'get',
      '/attendance?from=2026-01-01&to=2026-01-02',
    ).expect(200);
    expect(history.body).toEqual([]);
    await api(reception.token, 'get', '/attendance/corrections').expect(403);
  });

  it('lets payment-only users select minimal child and linked payer names and record payment', async () => {
    const cashier = await user([{ key: 'payment:create', scope: 'branch' }]);
    await api(cashier.token, 'get', '/children').expect(403);
    await api(cashier.token, 'get', '/guardians').expect(403);
    const lookup = await api(
      cashier.token,
      'get',
      '/lookups/children?permission=payment:create',
    ).expect(200);
    const selected = lookup.body.data.find((c: any) => c.id === childA);
    expect(Object.keys(selected).sort()).toEqual(['branchId', 'firstName', 'id', 'lastName']);
    expect(lookup.body.data.map((c: any) => c.id)).not.toContain(childB);
    const payers = await api(cashier.token, 'get', `/lookups/children/${childA}/payers`).expect(
      200,
    );
    expect(payers.body).toEqual([{ id: payerA, fullName: 'Payer A' }]);
    await api(cashier.token, 'post', '/payments')
      .set('Idempotency-Key', randomUUID())
      .send({
        childId: childA,
        payerGuardianId: payerA,
        amountTiyin: '10000',
        method: 'cash',
        paidAt: new Date().toISOString(),
      })
      .expect(201);
  });

  it('lets the accountant use all-scoped finance lookups without widening branch child profiles', async () => {
    const accountant = await user(ROLE_GRANTS.accountant);
    await api(accountant.token, 'get', `/children/${childB}`).expect(404);
    const lookup = await api(
      accountant.token,
      'get',
      '/lookups/children?permission=payment:create',
    ).expect(200);
    expect(lookup.body.data.map((c: any) => c.id)).toContain(childB);
    const payers = await api(accountant.token, 'get', `/lookups/children/${childB}/payers`).expect(
      200,
    );
    expect(payers.body).toEqual([{ id: payerB, fullName: 'Payer B' }]);
    await api(accountant.token, 'post', '/payments')
      .set('Idempotency-Key', randomUUID())
      .send({
        childId: childB,
        payerGuardianId: payerB,
        amountTiyin: '25000',
        method: 'cash',
        paidAt: new Date().toISOString(),
      })
      .expect(201);
  });

  it('rejects out-of-branch payers and keeps operation lookup filters from widening scope', async () => {
    const cashier = await user([{ key: 'payment:create', scope: 'branch' }]);
    const response = await api(
      cashier.token,
      'get',
      `/lookups/children?permission=payment:create&branchId=${branchB}`,
    ).expect(200);
    expect(response.body.data).toEqual([]);
    await api(cashier.token, 'get', `/lookups/children/${childB}/payers`).expect(404);
    await api(cashier.token, 'post', '/payments')
      .set('Idempotency-Key', randomUUID())
      .send({
        childId: childB,
        amountTiyin: '10000',
        method: 'cash',
        paidAt: new Date().toISOString(),
      })
      .expect(404);
  });

  it('requires an allowed operation permission and validates lookup pagination', async () => {
    const teacher = await user(ROLE_GRANTS.teacher);
    await assign(teacher.id);
    await api(teacher.token, 'get', '/lookups/children?permission=payment:create').expect(403);
    await api(teacher.token, 'get', '/lookups/children?permission=report:read').expect(400);
    await api(teacher.token, 'get', '/lookups/children?permission=child:read&limit=201').expect(
      422,
    );
    await api(teacher.token, 'get', `/lookups/children/${childA}/payers`).expect(403);
    await request(app.getHttpServer())
      .get(prefix + '/lookups/children')
      .expect(401);
  });

  it('lets administrators assign teacher and reception roles while clinical delegation stays protected', async () => {
    const administrator = await user(ROLE_GRANTS.administrator);
    for (const code of ['teacher', 'reception', 'nurse']) {
      const role = await db.role.create({
        data: {
          tenantId,
          code,
          nameUz: code,
          nameRu: code,
          rolePermission: {
            create: ROLE_GRANTS[code].map((g) => ({
              permissionKey: g.key,
              scope: g.scope,
            })),
          },
        },
      });
      const response = await api(administrator.token, 'post', '/users').send({
        fullName: `New ${code}`,
        phone: randomUUID(),
        password: 'WorkflowOnly12345!',
        roleId: role.id,
        branchIds: [branchA],
      });
      expect(response.status).toBe(code === 'nurse' ? 403 : 201);
      if (code === 'nurse') expect(response.body.error.code).toBe('PRIVILEGE_ESCALATION');
    }
  });

  it('upgrades only an unchanged administrator template and invalidates permission caches', async () => {
    const additions = new Set([
      'attendance:read',
      'attendance:checkin',
      'attendance:checkout',
      'attendance:correct',
      'pickup:read',
      'pickup:manage',
      'pickup:temporary',
      'medical:alerts',
    ]);
    const old = ROLE_GRANTS.administrator.filter((g) => !additions.has(g.key));
    const role = await db.role.create({
      data: {
        tenantId,
        code: 'administrator',
        isSystem: true,
        nameUz: 'Admin',
        nameRu: 'Admin',
        rolePermission: { create: old.map((g) => ({ permissionKey: g.key, scope: g.scope })) },
      },
    });
    const migration = readFileSync(
      join(
        process.cwd(),
        'prisma/migrations/20261003140000_administrator_operational_permissions/migration.sql',
      ),
      'utf8',
    );
    // Restrict the migration to this synthetic tenant; the migration's matching logic is unchanged.
    const scoped = migration.replace(
      'r.is_system AND r.code',
      `r.tenant_id = '${tenantId}'::uuid AND r.is_system AND r.code`,
    );
    const before = (await db.tenant.findUniqueOrThrow({ where: { id: tenantId } }))
      .permissionsVersion;
    await db.$executeRawUnsafe(scoped);
    expect(await db.rolePermission.count({ where: { roleId: role.id } })).toBe(
      ROLE_GRANTS.administrator.length,
    );
    expect(
      (await db.tenant.findUniqueOrThrow({ where: { id: tenantId } })).permissionsVersion,
    ).toBeGreaterThan(before);
    await db.$executeRawUnsafe(scoped);
    expect(await db.rolePermission.count({ where: { roleId: role.id } })).toBe(
      ROLE_GRANTS.administrator.length,
    );
    await db.rolePermission.deleteMany({ where: { roleId: role.id } });
    const customized = old.filter((g) => g.key !== 'child:update');
    await db.rolePermission.createMany({
      data: customized.map((g) => ({
        roleId: role.id,
        permissionKey: g.key,
        scope: g.scope,
      })),
    });
    await db.$executeRawUnsafe(scoped);
    expect(await db.rolePermission.count({ where: { roleId: role.id } })).toBe(customized.length);
    expect(
      await db.rolePermission.count({
        where: {
          roleId: role.id,
          permissionKey: { in: [...additions] },
        },
      }),
    ).toBe(0);
  });
});
