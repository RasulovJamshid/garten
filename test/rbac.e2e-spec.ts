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

    teacherToken = await login(app, prefix, phone, teacherPassword);
  });

  afterAll(async () => {
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

  it('an expired/garbage bearer token is rejected the same as no token', async () => {
    const res = await request(app.getHttpServer())
      .get(`${prefix}/children`)
      .set('Authorization', 'Bearer not-a-real-jwt');
    expect(res.status).toBe(401);
  });
});
