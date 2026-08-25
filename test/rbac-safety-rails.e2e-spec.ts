import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { createTestApp, login } from './utils/create-app';

const OWNER_LOGIN = process.env.SEED_OWNER_EMAIL ?? 'owner@demo.local';
const OWNER_PASSWORD = process.env.SEED_OWNER_PASSWORD ?? 'ChangeMe12345!';

/**
 * The §5.5 safety rails (rbac-safety.service.ts) have unit-level coverage
 * nowhere else in this repo — this is the first e2e proof that all four
 * fire through the real HTTP + permission-guard stack, not just when
 * called directly against the service. 01-stage1-plan.md §7 lists this
 * e2e coverage as one of the non-negotiable gaps.
 */
describe('RBAC safety rails (e2e)', () => {
  let app: INestApplication;
  let prefix: string;
  let prisma: PrismaClient;
  let ownerToken: string;
  let ownerUserId: string;
  let ownerRoleId: string;
  let branchId: string;
  let tenantId: string;

  let directorUserId: string;
  let directorToken: string;
  let adminUserId: string;
  let adminToken: string;
  let targetRoleId: string;

  async function createTenantUser(roleId: string, label: string) {
    const phone = `+99892${Math.floor(1000000 + Math.random() * 8999999)}`;
    const password = `E2E-${label}-Password12345`;
    const user = await prisma.appUser.create({
      data: {
        tenantId,
        fullName: `E2E ${label}`,
        phone,
        email: `e2e-${label.toLowerCase()}-${Date.now()}@test.local`,
        passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
        status: 'active',
      },
    });
    await prisma.userRole.create({ data: { userId: user.id, roleId, branchId } });
    await prisma.userBranch.create({ data: { userId: user.id, branchId } });
    const token = await login(app, prefix, phone, password);
    return { userId: user.id, token };
  }

  async function dropTenantUser(userId: string) {
    await prisma.userSession.deleteMany({ where: { userId } });
    await prisma.userRole.deleteMany({ where: { userId } });
    await prisma.userBranch.deleteMany({ where: { userId } });
    await prisma.appUser.delete({ where: { id: userId } });
  }

  beforeAll(async () => {
    ({ app, prefix } = await createTestApp());
    prisma = new PrismaClient();
    ownerToken = await login(app, prefix, OWNER_LOGIN, OWNER_PASSWORD);

    const tenant = await prisma.tenant.findFirstOrThrow({ where: { code: 'demo' } });
    tenantId = tenant.id;
    const branch = await prisma.branch.findFirstOrThrow({ where: { tenantId } });
    branchId = branch.id;
    const ownerUser = await prisma.appUser.findFirstOrThrow({
      where: { tenantId, email: OWNER_LOGIN },
    });
    ownerUserId = ownerUser.id;
    const ownerRole = await prisma.role.findFirstOrThrow({ where: { tenantId, code: 'owner' } });
    ownerRoleId = ownerRole.id;
    const directorRole = await prisma.role.findFirstOrThrow({
      where: { tenantId, code: 'director' },
    });
    const adminRole = await prisma.role.findFirstOrThrow({
      where: { tenantId, code: 'administrator' },
    });

    ({ userId: directorUserId, token: directorToken } = await createTenantUser(
      directorRole.id,
      'Director',
    ));
    ({ userId: adminUserId, token: adminToken } = await createTenantUser(adminRole.id, 'Admin'));

    const roleRes = await request(app.getHttpServer())
      .post(`${prefix}/roles`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        code: `e2e_target_${Date.now()}`,
        nameUz: 'E2E Target',
        nameRu: 'E2E Target',
        permissions: [],
      })
      .expect(201);
    targetRoleId = roleRes.body.id;
  });

  afterAll(async () => {
    await request(app.getHttpServer())
      .delete(`${prefix}/roles/${targetRoleId}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    await dropTenantUser(directorUserId);
    await dropTenantUser(adminUserId);
    await prisma.$disconnect();
    await app.close();
  });

  // --- privilege escalation & sensitive-permission gating -----------------

  it('director (all perms except period:reopen) cannot grant period:reopen — 403 PRIVILEGE_ESCALATION', async () => {
    const res = await request(app.getHttpServer())
      .post(`${prefix}/roles/${targetRoleId}/permissions`)
      .set('Authorization', `Bearer ${directorToken}`)
      .send({ key: 'period:reopen', scope: 'all' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PRIVILEGE_ESCALATION');
  });

  it('director CAN hold period:close (sensitive) but cannot grant it without role:manage:sensitive — 403 SENSITIVE_PERMISSION', async () => {
    const res = await request(app.getHttpServer())
      .post(`${prefix}/roles/${targetRoleId}/permissions`)
      .set('Authorization', `Bearer ${directorToken}`)
      .send({ key: 'period:close', scope: 'all' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SENSITIVE_PERMISSION');
  });

  it('owner (holds role:manage:sensitive) CAN grant the same sensitive permission', async () => {
    await request(app.getHttpServer())
      .post(`${prefix}/roles/${targetRoleId}/permissions`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ key: 'period:close', scope: 'all' })
      .expect(201);
  });

  // --- protected Owner role -------------------------------------------

  it('the protected Owner role cannot be edited', async () => {
    const res = await request(app.getHttpServer())
      .patch(`${prefix}/roles/${ownerRoleId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ nameRu: 'Renamed' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ROLE_PROTECTED');
  });

  it('the protected Owner role cannot have its permissions replaced', async () => {
    const res = await request(app.getHttpServer())
      .put(`${prefix}/roles/${ownerRoleId}/permissions`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ permissions: [] });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ROLE_PROTECTED');
  });

  it('the protected Owner role cannot be deleted', async () => {
    const res = await request(app.getHttpServer())
      .delete(`${prefix}/roles/${ownerRoleId}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ROLE_PROTECTED');
  });

  // --- last owner (actor distinct from the affected user) -----------------

  it("removing the sole remaining Owner's Owner role is rejected — 409 LAST_OWNER, and nothing is persisted", async () => {
    const res = await request(app.getHttpServer())
      .delete(`${prefix}/users/${ownerUserId}/roles/${ownerRoleId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('LAST_OWNER');

    const stillOwner = await prisma.userRole.findFirst({
      where: { userId: ownerUserId, roleId: ownerRoleId },
    });
    expect(stillOwner).not.toBeNull();
  });

  // --- self-lockout, isolated from last-owner by having a 2nd Owner -------

  it('a 2nd Owner revoking role:manage from themselves is blocked as self-lockout even though another Owner still exists — 403 SELF_LOCKOUT', async () => {
    const { userId: secondOwnerId, token: secondOwnerToken } = await createTenantUser(
      ownerRoleId,
      'SecondOwner',
    );
    try {
      const res = await request(app.getHttpServer())
        .put(`${prefix}/users/${secondOwnerId}/roles`)
        .set('Authorization', `Bearer ${secondOwnerToken}`)
        .send({ roles: [] });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('SELF_LOCKOUT');

      // Confirm this did NOT trip LAST_OWNER instead — the original owner
      // must still be intact, proving 2 owners existed when this ran.
      const originalOwnerStillHasRole = await prisma.userRole.findFirst({
        where: { userId: ownerUserId, roleId: ownerRoleId },
      });
      expect(originalOwnerStillHasRole).not.toBeNull();
    } finally {
      await dropTenantUser(secondOwnerId);
    }
  });
});
