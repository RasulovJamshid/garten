import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { createTestApp } from './utils/create-app';

const OWNER_LOGIN = process.env.SEED_OWNER_EMAIL ?? 'owner@demo.local';
const OWNER_PASSWORD = process.env.SEED_OWNER_PASSWORD ?? 'ChangeMe12345!';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prefix: string;
  let prisma: PrismaClient;
  let accessToken: string;

  beforeAll(async () => {
    ({ app, prefix } = await createTestApp());
    prisma = new PrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('rejects an unknown login/password combination without revealing which is wrong', async () => {
    const res = await request(app.getHttpServer())
      .post(`${prefix}/auth/login`)
      .send({ login: OWNER_LOGIN, password: 'definitely-wrong-password' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('logs in with valid credentials and returns an access token', async () => {
    const res = await request(app.getHttpServer())
      .post(`${prefix}/auth/login`)
      .send({ login: OWNER_LOGIN, password: OWNER_PASSWORD })
      .expect(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.user.fullName).toBeDefined();
    accessToken = res.body.accessToken;
  });

  it('rejects a protected route with no token at all', async () => {
    const res = await request(app.getHttpServer()).get(`${prefix}/auth/me`);
    expect(res.status).toBe(401);
  });

  it('GET /auth/me returns the authenticated user, roles, and resolved permissions', async () => {
    const res = await request(app.getHttpServer())
      .get(`${prefix}/auth/me`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(res.body.user).toBeDefined();
    expect(Array.isArray(res.body.roles)).toBe(true);
    expect(res.body.permissions).toBeDefined();
  });

  it('rejects a change-password with the wrong current password', async () => {
    const res = await request(app.getHttpServer())
      .post(`${prefix}/auth/change-password`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: 'not-the-real-password', newPassword: 'SomeNewPassword12345' });
    expect(res.status).toBe(401);
  });

  it('forgot-password responds identically for a known and an unknown login (no account enumeration)', async () => {
    const known = await request(app.getHttpServer())
      .post(`${prefix}/auth/forgot-password`)
      .send({ login: OWNER_LOGIN });
    const unknown = await request(app.getHttpServer())
      .post(`${prefix}/auth/forgot-password`)
      .send({ login: 'no-such-user@nowhere.invalid' });
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(known.body).toEqual(unknown.body);
  });

  it('completes a full forgot -> reset -> login-with-new-password cycle, then restores the original password', async () => {
    await request(app.getHttpServer())
      .post(`${prefix}/auth/forgot-password`)
      .send({ login: OWNER_LOGIN })
      .expect(200);

    const owner = await prisma.appUser.findFirst({ where: { email: OWNER_LOGIN } });
    const tokenRow = await prisma.passwordResetToken.findFirst({
      where: { userId: owner!.id, usedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    expect(tokenRow).not.toBeNull();

    const tempPassword = 'TempE2EPassword12345';
    await request(app.getHttpServer())
      .post(`${prefix}/auth/reset-password`)
      .send({ token: tokenRow!.token, newPassword: tempPassword })
      .expect(200);

    // The same token can't be replayed.
    const replay = await request(app.getHttpServer())
      .post(`${prefix}/auth/reset-password`)
      .send({ token: tokenRow!.token, newPassword: 'AnotherPassword12345' });
    expect(replay.status).toBe(422);

    // Restore the seeded password so this test is repeatable and doesn't
    // leave the demo account in a changed state for anyone else testing.
    const relogin = await request(app.getHttpServer())
      .post(`${prefix}/auth/login`)
      .send({ login: OWNER_LOGIN, password: tempPassword })
      .expect(200);
    await request(app.getHttpServer())
      .post(`${prefix}/auth/change-password`)
      .set('Authorization', `Bearer ${relogin.body.accessToken}`)
      .send({ currentPassword: tempPassword, newPassword: OWNER_PASSWORD })
      .expect(200);
  });
});
