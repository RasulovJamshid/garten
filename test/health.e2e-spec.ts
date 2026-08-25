import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/create-app';

describe('Health (e2e)', () => {
  let app: INestApplication;
  let prefix: string;

  beforeAll(async () => {
    ({ app, prefix } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health is public and returns ok', async () => {
    const res = await request(app.getHttpServer()).get(`${prefix}/health`).expect(200);
    expect(res.body.status).toBe('ok');
  });

  it('an unknown route 404s with the standard error envelope', async () => {
    const res = await request(app.getHttpServer()).get(`${prefix}/this-route-does-not-exist`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.traceId).toBeDefined();
  });
});
