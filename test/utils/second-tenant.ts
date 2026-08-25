import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

/**
 * Spins up a second, fully separate tenant + branch + a minimal owner-like
 * role + one active user, for tests that need to prove data does NOT cross
 * the tenant boundary (the tenant-extension.ts seam is the only thing
 * standing between this and a real cross-customer data leak).
 *
 * Deliberately does not reuse prisma/seed.ts's ALL_GRANTS/SYSTEM_ROLES —
 * this only needs enough permissions to drive the specific cross-tenant
 * assertions each spec makes, kept in one place so every tenant-isolation
 * test builds its second tenant the same way.
 */
export interface SecondTenantFixture {
  tenantId: string;
  branchId: string;
  userId: string;
  login: string;
  password: string;
}

export async function createSecondTenant(
  prisma: PrismaClient,
  grants: { key: string; scope: string }[],
): Promise<SecondTenantFixture> {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const tenant = await prisma.tenant.create({
    data: { code: `e2e-tenant-b-${suffix}`, name: 'E2E Isolation Tenant B' },
  });
  const branch = await prisma.branch.create({
    data: { tenantId: tenant.id, code: 'main', name: 'Tenant B — Main' },
  });
  const role = await prisma.role.create({
    data: { tenantId: tenant.id, code: 'e2e_role', nameUz: 'E2E', nameRu: 'E2E', isSystem: false },
  });
  for (const g of grants) {
    await prisma.rolePermission.create({
      data: { roleId: role.id, permissionKey: g.key, scope: g.scope },
    });
  }

  const password = 'TenantBPassword12345';
  const login = `e2e-tenant-b-${suffix}@test.local`;
  const user = await prisma.appUser.create({
    data: {
      tenantId: tenant.id,
      fullName: 'Tenant B User',
      phone: `+99891${Math.floor(1000000 + Math.random() * 8999999)}`,
      email: login,
      passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
      status: 'active',
    },
  });
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id, branchId: branch.id } });
  await prisma.userBranch.create({ data: { userId: user.id, branchId: branch.id } });

  return { tenantId: tenant.id, branchId: branch.id, userId: user.id, login, password };
}

/**
 * Mirror teardown for createSecondTenant, in explicit FK-safe order.
 * NOT a cascading `tenant.delete()` — confirmed against the live schema
 * that `branch.tenant_id` and `app_user.tenant_id` are ON DELETE RESTRICT
 * (only `role.tenant_id` cascades), so deleting the tenant first would
 * fail with a foreign-key violation.
 */
export async function dropSecondTenant(prisma: PrismaClient, tenantId: string): Promise<void> {
  const users = await prisma.appUser.findMany({ where: { tenantId }, select: { id: true } });
  const userIds = users.map((u) => u.id);
  const roles = await prisma.role.findMany({ where: { tenantId }, select: { id: true } });
  const roleIds = roles.map((r) => r.id);

  await prisma.userSession.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.userBranch.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.rolePermission.deleteMany({ where: { roleId: { in: roleIds } } });
  await prisma.appUser.deleteMany({ where: { tenantId } });
  await prisma.role.deleteMany({ where: { tenantId } });
  await prisma.branch.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
}
