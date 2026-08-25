import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { createTestApp, login } from './utils/create-app';
import { createSecondTenant, dropSecondTenant, SecondTenantFixture } from './utils/second-tenant';

const OWNER_LOGIN = process.env.SEED_OWNER_EMAIL ?? 'owner@demo.local';
const OWNER_PASSWORD = process.env.SEED_OWNER_PASSWORD ?? 'ChangeMe12345!';

/**
 * 01-stage1-plan.md §7 calls this "non-negotiable": prove the
 * tenant-extension.ts seam actually stops one customer's data reaching
 * another's request, over the real HTTP + Prisma-extension stack — not
 * just by reading the extension's source and trusting it.
 */
describe('Tenant isolation (e2e)', () => {
  let app: INestApplication;
  let prefix: string;
  let prisma: PrismaClient;
  let ownerTokenA: string;
  let childIdA: string;
  let tenantB: SecondTenantFixture;
  let tokenB: string;

  beforeAll(async () => {
    ({ app, prefix } = await createTestApp());
    prisma = new PrismaClient();
    ownerTokenA = await login(app, prefix, OWNER_LOGIN, OWNER_PASSWORD);

    const tenantA = await prisma.tenant.findFirstOrThrow({ where: { code: 'demo' } });
    const branchA = await prisma.branch.findFirstOrThrow({ where: { tenantId: tenantA.id } });
    const childA = await prisma.child.create({
      data: {
        tenantId: tenantA.id,
        branchId: branchA.id,
        firstName: 'E2E',
        lastName: `TenantIsolationA-${Date.now()}`,
        birthDate: new Date('2021-01-01'),
      },
    });
    childIdA = childA.id;

    tenantB = await createSecondTenant(prisma, [
      { key: 'child:read', scope: 'all' },
      { key: 'child:create', scope: 'all' },
      { key: 'child:update', scope: 'all' },
    ]);
    tokenB = await login(app, prefix, tenantB.login, tenantB.password);
  });

  afterAll(async () => {
    await prisma.child.deleteMany({ where: { id: childIdA } });
    await dropSecondTenant(prisma, tenantB.tenantId);
    await prisma.$disconnect();
    await app.close();
  });

  it("tenant B cannot fetch tenant A's child by id — 404, not the record", async () => {
    const res = await request(app.getHttpServer())
      .get(`${prefix}/children/${childIdA}`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(404);
    expect(res.body.error?.code).toBeDefined();
  });

  it("tenant B's child list never includes tenant A's child", async () => {
    const res = await request(app.getHttpServer())
      .get(`${prefix}/children`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);
    const ids = (Array.isArray(res.body) ? res.body : res.body.data).map((c: any) => c.id);
    expect(ids).not.toContain(childIdA);
  });

  it("tenant B cannot update tenant A's child through the tenant-scoped write path", async () => {
    const res = await request(app.getHttpServer())
      .patch(`${prefix}/children/${childIdA}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ address: 'should never be written' });
    expect(res.status).toBe(404);

    const stillOriginal = await prisma.child.findUniqueOrThrow({ where: { id: childIdA } });
    expect(stillOriginal.address).not.toBe('should never be written');
  });

  it("tenant A cannot see tenant B's user-scoped data either (symmetry check via /auth/me)", async () => {
    // Each token resolves /auth/me to its OWN user only — not each other's
    // and not merged. /auth/me's own response never echoes tenantId
    // (see auth.controller.ts's `user` select), so identity is confirmed
    // via the distinct user ids instead.
    const meA = await request(app.getHttpServer())
      .get(`${prefix}/auth/me`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .expect(200);
    const meB = await request(app.getHttpServer())
      .get(`${prefix}/auth/me`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);
    expect(meA.body.user.id).not.toBe(meB.body.user.id);
    expect(meB.body.user.id).toBe(tenantB.userId);
  });
});
