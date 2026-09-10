import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { createTestApp, login } from './utils/create-app';

const OWNER_LOGIN = process.env.SEED_OWNER_EMAIL ?? 'owner@demo.local';
const OWNER_PASSWORD = process.env.SEED_OWNER_PASSWORD ?? 'ChangeMe12345!';

/**
 * A scope-limited user (teacher role: own_group only, no user:manage/
 * child:create/etc.) created fresh for this file so the 403 assertions
 * test a *real* denial path through PermissionGuard, not just "no token."
 */
describe('RBAC guard (e2e)', () => {
  let app: INestApplication;
  let prefix: string;
  let prisma: PrismaClient;
  let ownerToken: string;
  let teacherToken: string;
  let teacherUserId: string;
  let groupId: string;

  beforeAll(async () => {
    ({ app, prefix } = await createTestApp());
    prisma = new PrismaClient();
    ownerToken = await login(app, prefix, OWNER_LOGIN, OWNER_PASSWORD);

    const tenant = await prisma.tenant.findFirstOrThrow({ where: { code: 'demo' } });
    const branch = await prisma.branch.findFirstOrThrow({ where: { tenantId: tenant.id } });
    const teacherRole = await prisma.role.findFirstOrThrow({
      where: { tenantId: tenant.id, code: 'teacher' },
    });

    const phone = `+99890${Math.floor(1000000 + Math.random() * 8999999)}`;
    const teacherPassword = 'E2ETeacherPassword12345';
    const teacher = await prisma.appUser.create({
      data: {
        tenantId: tenant.id,
        fullName: 'E2E Test Teacher',
        phone,
        email: `e2e-teacher-${Date.now()}@test.local`,
        passwordHash: await argon2.hash(teacherPassword, { type: argon2.argon2id }),
        status: 'active',
      },
    });
    teacherUserId = teacher.id;
    await prisma.userRole.create({
      data: { userId: teacher.id, roleId: teacherRole.id, branchId: branch.id },
    });
    await prisma.userBranch.create({ data: { userId: teacher.id, branchId: branch.id } });

    // own_group scope resolves through group_staff. A teacher with a role
    // but no staff row has an EMPTY own-group list, which is a different
    // state from "assigned but the group is empty" — both are covered below.
    const group = await prisma.childGroup.create({
      data: { tenantId: tenant.id, branchId: branch.id, name: `E2E Group ${Date.now()}` },
    });
    groupId = group.id;
    await prisma.groupStaff.create({
      data: {
        tenantId: tenant.id,
        groupId: group.id,
        userId: teacher.id,
        staffRole: 'main_teacher',
      },
    });

    teacherToken = await login(app, prefix, phone, teacherPassword);
  });

  afterAll(async () => {
    await prisma.groupStaff.deleteMany({ where: { userId: teacherUserId } });
    await prisma.childGroup.delete({ where: { id: groupId } });
    await prisma.userRole.deleteMany({ where: { userId: teacherUserId } });
    await prisma.userBranch.deleteMany({ where: { userId: teacherUserId } });
    await prisma.userSession.deleteMany({ where: { userId: teacherUserId } });
    await prisma.appUser.delete({ where: { id: teacherUserId } });
    await prisma.$disconnect();
    await app.close();
  });

  it('owner (all-permissions role) can list children', async () => {
    await request(app.getHttpServer())
      .get(`${prefix}/children`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
  });

  it('a teacher (own_group scope, no child:create) is forbidden from creating a child', async () => {
    const res = await request(app.getHttpServer())
      .post(`${prefix}/children`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({
        branchId: '00000000-0000-0000-0000-000000000000',
        firstName: 'Should',
        lastName: 'Fail',
        birthDate: '2022-01-01',
      });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('a teacher CAN list children (holds child:read at own_group scope)', async () => {
    await request(app.getHttpServer())
      .get(`${prefix}/children`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .expect(200);
  });

  /**
   * The reported production bug: a teacher who holds child:read at
   * own_group scope but is staffed on NO group used to compile to
   * `groupId IN ()` and answer 200 with zero rows — indistinguishable from
   * "this kindergarten has no children", which is what everyone read it as.
   * It must be an explicit 403 NO_SCOPE_ASSIGNMENT instead.
   */
  it('a teacher staffed on no group gets NO_SCOPE_ASSIGNMENT, not an empty list', async () => {
    await prisma.groupStaff.deleteMany({ where: { userId: teacherUserId } });
    try {
      const res = await request(app.getHttpServer())
        .get(`${prefix}/children`)
        .set('Authorization', `Bearer ${teacherToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('NO_SCOPE_ASSIGNMENT');
    } finally {
      const teacher = await prisma.appUser.findFirstOrThrow({ where: { id: teacherUserId } });
      await prisma.groupStaff.create({
        data: {
          tenantId: teacher.tenantId,
          groupId,
          userId: teacherUserId,
          staffRole: 'main_teacher',
        },
      });
    }
  });

  /**
   * The scope must survive a caller-supplied filter that targets the same
   * Prisma key: `?groupId=` and own_group scope both write
   * `groupAssignment`, and assignment used to drop the scope entirely.
   */
  it('a teacher cannot widen their scope by passing another group id', async () => {
    const tenant = await prisma.tenant.findFirstOrThrow({ where: { code: 'demo' } });
    const branch = await prisma.branch.findFirstOrThrow({ where: { tenantId: tenant.id } });
    const otherGroup = await prisma.childGroup.create({
      data: { tenantId: tenant.id, branchId: branch.id, name: `E2E Other ${Date.now()}` },
    });
    const child = await prisma.child.create({
      data: {
        tenantId: tenant.id,
        branchId: branch.id,
        firstName: 'Outside',
        lastName: 'Scope',
        birthDate: new Date('2022-01-01'),
        status: 'active',
      },
    });
    await prisma.groupAssignment.create({
      data: {
        tenantId: tenant.id,
        childId: child.id,
        groupId: otherGroup.id,
        effectiveFrom: new Date('2026-01-01'),
      },
    });

    try {
      const res = await request(app.getHttpServer())
        .get(`${prefix}/children?groupId=${otherGroup.id}`)
        .set('Authorization', `Bearer ${teacherToken}`)
        .expect(200);

      expect(res.body.data).toHaveLength(0);
      expect(res.body.meta.total).toBe(0);
    } finally {
      await prisma.groupAssignment.deleteMany({ where: { childId: child.id } });
      await prisma.child.delete({ where: { id: child.id } });
      await prisma.childGroup.delete({ where: { id: otherGroup.id } });
    }
  });

  it('an expired/garbage bearer token is rejected the same as no token', async () => {
    const res = await request(app.getHttpServer())
      .get(`${prefix}/children`)
      .set('Authorization', 'Bearer not-a-real-jwt');
    expect(res.status).toBe(401);
  });
});
