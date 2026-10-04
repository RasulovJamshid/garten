// Run after migrations, seeding and build against an explicitly isolated test database.
// Unlike Jest's HTTP tests, this starts the real pg-boss queues and workers.
if (process.env.NODE_ENV !== 'test' || process.env.TEST_DATABASE_ISOLATED !== 'true') {
  throw new Error('Worker smoke requires NODE_ENV=test and TEST_DATABASE_ISOLATED=true');
}
const database = new URL(process.env.DATABASE_URL);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname)) {
  throw new Error('Worker smoke is restricted to a local isolated test database');
}
const { randomUUID } = require('node:crypto');
const queueSchema = 'worker_smoke_' + randomUUID().replaceAll('-', '');
process.env.PGBOSS_SCHEMA = queueSchema;
process.env.REPORT_ASYNC_ROW_THRESHOLD = '1';
process.env.TELEGRAM_ENABLED = 'false';
process.env.STORAGE_DRIVER = 'local';
process.env.STORAGE_LOCAL_PATH = './data/worker-smoke-files';
require('../../dist/common/bigint-json.polyfill');
const assert = require('node:assert/strict');
const { NestFactory } = require('@nestjs/core');
const { ValidationPipe } = require('@nestjs/common');
const { JwtService } = require('@nestjs/jwt');
const { PrismaClient } = require('@prisma/client');
const request = require('supertest');
const cookieParser = require('cookie-parser');
const { AppModule } = require('../../dist/app.module');
const { PERMISSION_CATALOG } = require('../../dist/rbac/permission-catalog');

async function waitFor(read, predicate, label) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(label + ' did not finish within 30 seconds');
}

async function main() {
  const db = new PrismaClient();
  let app;
  try {
    const tenant = await db.tenant.create({
      data: { code: 'worker-smoke-' + randomUUID(), name: 'Synthetic worker smoke' },
    });
    const branch = await db.branch.create({
      data: { tenantId: tenant.id, code: 'A', name: 'Synthetic branch' },
    });
    await db.setting.create({ data: { tenantId: tenant.id, displayName: tenant.name } });
    const role = await db.role.create({
      data: {
        tenantId: tenant.id, code: 'smoke', nameUz: 'Smoke', nameRu: 'Smoke',
        rolePermission: { create: PERMISSION_CATALOG.map((p) => ({ permissionKey: p.key, scope: 'all' })) },
      },
    });
    const user = await db.appUser.create({
      data: {
        tenantId: tenant.id, fullName: 'Synthetic worker user', phone: randomUUID(),
        passwordHash: 'unused', userBranch: { create: { branchId: branch.id } },
        userRole: { create: { roleId: role.id, branchId: branch.id } },
      },
    });
    await db.child.createMany({
      data: [1, 2].map((i) => ({
        tenantId: tenant.id, branchId: branch.id, firstName: 'Worker ' + i,
        lastName: 'Synthetic', birthDate: new Date('2021-01-01'),
        enrollmentDate: new Date('2026-09-01'), status: 'active',
      })),
    });
    await db.notificationTemplate.create({
      data: { tenantId: tenant.id, templateKey: 'smoke', bodyRu: 'Worker smoke', bodyUz: 'Worker smoke' },
    });
    app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
    const prefix = (process.env.API_PREFIX || '/api/v1').replace(/^\//, '');
    app.setGlobalPrefix(prefix);
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({
      whitelist: true, forbidNonWhitelisted: true, transform: true,
      transformOptions: { enableImplicitConversion: true },
    }));
    await app.init();
    const token = await app.get(JwtService).signAsync({ sub: user.id, tid: tenant.id });
    const get = (path) => request(app.getHttpServer()).get('/' + prefix + path)
      .set('Authorization', 'Bearer ' + token);
    const sent = await request(app.getHttpServer()).post('/' + prefix + '/notifications/send')
      .set('Authorization', 'Bearer ' + token).set('Idempotency-Key', randomUUID())
      .send({ templateKey: 'smoke', channel: 'internal', data: {}, recipients: [{ userId: user.id }] })
      .expect(201);
    const notificationId = sent.body.results[0].notificationId;
    await waitFor(() => db.notification.findUniqueOrThrow({ where: { id: notificationId } }),
      (row) => row.status === 'sent', 'Internal notification worker');
    for (const format of ['xlsx', 'pdf']) {
      const queued = await get('/reports/children/active?format=' + format).expect(202);
      const job = await waitFor(
        () => db.exportJob.findUniqueOrThrow({ where: { id: queued.body.jobId } }),
        (row) => row.status !== 'processing', format + ' export worker',
      );
      assert.equal(job.status, 'completed', job.error || 'Export failed');
      const metadata = await get('/exports/' + job.id).expect(200);
      const downloaded = await get(metadata.body.downloadUrl).buffer(true).parse((response, done) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => done(null, Buffer.concat(chunks)));
        response.on('error', done);
      }).expect(200);
      if (format === 'xlsx') {
        assert.match(downloaded.headers['content-type'], /spreadsheetml/);
        assert.equal(downloaded.body.subarray(0, 2).toString(), 'PK');
      } else {
        assert.match(downloaded.headers['content-type'], /application\/pdf/);
        assert.equal(downloaded.body.subarray(0, 4).toString(), '%PDF');
      }
      await db.exportJob.update({ where: { id: job.id }, data: { expiresAt: new Date(0) } });
      await get(metadata.body.downloadUrl).expect(404);
    }
    console.log('Real workers passed: internal notification, XLSX/PDF generation, storage, downloads and expiry.');
  } finally {
    if (app) await app.close();
    // The schema name is generated above, never taken from user or application input.
    await db.$executeRawUnsafe('DROP SCHEMA IF EXISTS "' + queueSchema + '" CASCADE');
    await db.$disconnect();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
