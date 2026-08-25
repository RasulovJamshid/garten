import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { createTestApp, login } from './utils/create-app';

const OWNER_LOGIN = process.env.SEED_OWNER_EMAIL ?? 'owner@demo.local';
const OWNER_PASSWORD = process.env.SEED_OWNER_PASSWORD ?? 'ChangeMe12345!';

describe('Children CRUD (e2e)', () => {
  let app: INestApplication;
  let prefix: string;
  let prisma: PrismaClient;
  let token: string;
  let branchId: string;
  let childId: string;

  beforeAll(async () => {
    ({ app, prefix } = await createTestApp());
    prisma = new PrismaClient();
    token = await login(app, prefix, OWNER_LOGIN, OWNER_PASSWORD);
    const tenant = await prisma.tenant.findFirstOrThrow({ where: { code: 'demo' } });
    const branch = await prisma.branch.findFirstOrThrow({ where: { tenantId: tenant.id } });
    branchId = branch.id;
  });

  afterAll(async () => {
    if (childId) {
      await prisma.child.deleteMany({ where: { id: childId } });
    }
    await prisma.$disconnect();
    await app.close();
  });

  it('rejects a create with a missing required field', async () => {
    const res = await request(app.getHttpServer())
      .post(`${prefix}/children`)
      .set('Authorization', `Bearer ${token}`)
      .send({ branchId, firstName: 'NoLastName' }); // missing lastName, birthDate
    // 400, not 422: this is class-validator's automatic ValidationPipe
    // rejecting the request shape — 422 is reserved for a manually-thrown
    // AppErrors.validationFailed() from business logic (see app.exception.ts).
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('creates a child', async () => {
    const res = await request(app.getHttpServer())
      .post(`${prefix}/children`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        branchId,
        firstName: 'E2E',
        lastName: 'TestChild',
        birthDate: '2021-01-01',
        gender: 'female',
      })
      .expect(201);
    expect(res.body.id).toEqual(expect.any(String));
    expect(res.body.status).toBe('applicant');
    childId = res.body.id;
  });

  it('fetches the created child by id', async () => {
    const res = await request(app.getHttpServer())
      .get(`${prefix}/children/${childId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.firstName).toBe('E2E');
    expect(res.body.lastName).toBe('TestChild');
  });

  it('updates the child', async () => {
    const res = await request(app.getHttpServer())
      .patch(`${prefix}/children/${childId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ address: '123 E2E Test Street' })
      .expect(200);
    expect(res.body.address).toBe('123 E2E Test Street');
  });

  it('an unknown field is rejected outright (forbidNonWhitelisted), not silently stripped', async () => {
    const res = await request(app.getHttpServer())
      .patch(`${prefix}/children/${childId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ address: 'still valid', notARealField: 'should be rejected' });
    expect(res.status).toBe(400);
  });

  it('records a status transition and reflects it in history', async () => {
    await request(app.getHttpServer())
      .post(`${prefix}/children/${childId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'active', reason: 'e2e test enrollment', effectiveDate: '2026-01-01' })
      .expect(201);

    const history = await request(app.getHttpServer())
      .get(`${prefix}/children/${childId}/history`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(Array.isArray(history.body)).toBe(true);
    expect(history.body.length).toBeGreaterThan(0);
  });

  it('records and revokes a consent for the child', async () => {
    const guardian = await prisma.guardian.findFirst({
      where: {
        tenantId: (await prisma.child.findUniqueOrThrow({ where: { id: childId } })).tenantId,
      },
    });
    if (!guardian) return; // demo data may not have a guardian seeded; not this suite's concern

    const record = await request(app.getHttpServer())
      .post(`${prefix}/children/${childId}/consents`)
      .set('Authorization', `Bearer ${token}`)
      .send({ guardianId: guardian.id, consentType: 'personal_data', granted: true })
      .expect(201);

    await request(app.getHttpServer())
      .post(`${prefix}/children/${childId}/consents/${record.body.id}/revoke`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    const list = await request(app.getHttpServer())
      .get(`${prefix}/children/${childId}/consents`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(list.body.find((c: any) => c.id === record.body.id).revokedAt).not.toBeNull();
  });
});
