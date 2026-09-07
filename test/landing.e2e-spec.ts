import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { createTestApp, login } from './utils/create-app';
import { createSecondTenant, dropSecondTenant } from './utils/second-tenant';

const OWNER_LOGIN = process.env.SEED_OWNER_EMAIL ?? 'owner@demo.local';
const OWNER_PASSWORD = process.env.SEED_OWNER_PASSWORD ?? 'ChangeMe12345!';
const TENANT_CODE = process.env.SEED_TENANT_CODE ?? 'demo';

/** Smallest valid PNG — the upload path checks the declared mime type, not
 *  the bytes, but a real image keeps the fixture honest. */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('Landing page CMS (e2e)', () => {
  let app: INestApplication;
  let prefix: string;
  let prisma: PrismaClient;
  let token: string;
  let tenantId: string;
  let heroBlockId: string;
  let usedFileId: string;
  let unusedFileId: string;
  /** Only tear the page down if this suite is what created it — the e2e
   *  suites share the dev database, and a developer's real draft content
   *  should survive a test run. */
  let pageExistedBefore = true;

  const auth = (req: request.Test) => req.set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    ({ app, prefix } = await createTestApp());
    prisma = new PrismaClient();
    token = await login(app, prefix, OWNER_LOGIN, OWNER_PASSWORD);
    const tenant = await prisma.tenant.findFirstOrThrow({ where: { code: TENANT_CODE } });
    tenantId = tenant.id;
    pageExistedBefore = (await prisma.landingPage.count({ where: { tenantId, slug: 'home' } })) > 0;
  });

  afterAll(async () => {
    if (!pageExistedBefore) {
      // Blocks and versions cascade from the page row.
      await prisma.landingPage.deleteMany({ where: { tenantId, slug: 'home' } });
    }
    for (const id of [usedFileId, unusedFileId].filter(Boolean)) {
      await prisma.file.deleteMany({ where: { id } });
    }
    await prisma.$disconnect();
    await app.close();
  });

  describe('before anything is published', () => {
    it('returns an empty draft rather than 404 for a tenant that never opened the editor', async () => {
      const res = await auth(request(app.getHttpServer()).get(`${prefix}/landing`)).expect(200);
      expect(res.body.slug).toBe('home');
      expect(Array.isArray(res.body.blocks)).toBe(true);
      expect(res.body.publishedVersion).toBeNull();
    });

    it('404s on the public endpoint — an unpublished page is not visible', async () => {
      await request(app.getHttpServer()).get(`${prefix}/public/landing/${TENANT_CODE}`).expect(404);
    });
  });

  describe('editing the draft', () => {
    it('rejects an unknown block type at the DTO boundary', async () => {
      const res = await auth(request(app.getHttpServer()).post(`${prefix}/landing/blocks`)).send({
        type: 'not-a-section',
        content: {},
      });
      // 400 — `type` is constrained by @IsIn on the DTO, so ValidationPipe
      // rejects it before the handler runs.
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('rejects content that does not match its block type', async () => {
      const res = await auth(request(app.getHttpServer()).post(`${prefix}/landing/blocks`)).send({
        type: 'hero',
        content: { title: 'a plain string, not a translation object' },
      });
      // 422 — the shape passed the DTO and was rejected by the block
      // schema in business logic (app.exception.ts).
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('creates a hero block', async () => {
      const res = await auth(request(app.getHttpServer()).post(`${prefix}/landing/blocks`))
        .send({
          type: 'hero',
          content: {
            title: { ru: 'Детский сад «Солнышко»', uz: 'Quyoshcha bogchasi' },
            subtitle: { ru: 'Забота и развитие с 2 лет' },
          },
        })
        .expect(201);
      expect(res.body.type).toBe('hero');
      expect(res.body.position).toBe(0);
      heroBlockId = res.body.id;
    });

    it('marks the draft as having unpublished changes', async () => {
      const res = await auth(request(app.getHttpServer()).get(`${prefix}/landing`)).expect(200);
      expect(res.body.hasUnpublishedChanges).toBe(true);
    });

    it('still shows nothing publicly until publish', async () => {
      await request(app.getHttpServer()).get(`${prefix}/public/landing/${TENANT_CODE}`).expect(404);
    });
  });

  describe('publishing', () => {
    it('publishes version 1', async () => {
      const res = await auth(request(app.getHttpServer()).post(`${prefix}/landing/publish`))
        .send({ note: 'e2e first publish' })
        .expect(201);
      expect(res.body.version).toBe(1);
      expect(res.body.blocks).toBe(1);
    });

    it('serves the published page anonymously, flattened to one locale', async () => {
      const res = await request(app.getHttpServer())
        .get(`${prefix}/public/landing/${TENANT_CODE}?lang=ru`)
        .expect(200);
      expect(res.body.blocks).toHaveLength(1);
      expect(res.body.blocks[0].type).toBe('hero');
      expect(res.body.blocks[0].content.title).toBe('Детский сад «Солнышко»');
      expect(res.headers['content-language']).toBe('ru');
      // Carries the global prefix — a client appends a file id and uses it
      // as-is, so a prefix-less value here would 404 on every image.
      expect(res.body.mediaBaseUrl).toBe(`${prefix}/public/landing/${TENANT_CODE}/media`);
    });

    it('falls back to another locale rather than returning an empty section', async () => {
      const res = await request(app.getHttpServer())
        .get(`${prefix}/public/landing/${TENANT_CODE}?lang=en`)
        .expect(200);
      // Nothing was authored in English; ru is the first fallback.
      expect(res.body.blocks[0].content.title).toBe('Детский сад «Солнышко»');
    });

    it('answers a matching If-None-Match with 304', async () => {
      const first = await request(app.getHttpServer())
        .get(`${prefix}/public/landing/${TENANT_CODE}`)
        .expect(200);
      const etag = first.headers.etag;
      expect(etag).toBeDefined();
      await request(app.getHttpServer())
        .get(`${prefix}/public/landing/${TENANT_CODE}`)
        .set('If-None-Match', etag)
        .expect(304);
    });

    it('keeps a hidden block out of the published payload', async () => {
      await auth(request(app.getHttpServer()).put(`${prefix}/landing/blocks/${heroBlockId}`))
        .send({ isVisible: false })
        .expect(200);
      await auth(request(app.getHttpServer()).post(`${prefix}/landing/publish`))
        .send({})
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`${prefix}/public/landing/${TENANT_CODE}`)
        .expect(200);
      expect(res.body.blocks).toHaveLength(0);

      await auth(request(app.getHttpServer()).put(`${prefix}/landing/blocks/${heroBlockId}`))
        .send({ isVisible: true })
        .expect(200);
    });
  });

  describe('version history', () => {
    it('restores a previous version as a new version', async () => {
      const before = await auth(
        request(app.getHttpServer()).get(`${prefix}/landing/versions`),
      ).expect(200);
      const latest = before.body[0].version;

      const res = await auth(
        request(app.getHttpServer()).post(`${prefix}/landing/versions/1/restore`),
      ).expect(201);
      expect(res.body.restoredFrom).toBe(1);
      // Append-only: restoring moves history forward, never rewrites it.
      expect(res.body.version).toBe(latest + 1);

      const publicRes = await request(app.getHttpServer())
        .get(`${prefix}/public/landing/${TENANT_CODE}`)
        .expect(200);
      expect(publicRes.body.blocks).toHaveLength(1);
      expect(publicRes.body.blocks[0].type).toBe('hero');
    });
  });

  describe('public media', () => {
    beforeAll(async () => {
      const used = await auth(request(app.getHttpServer()).post(`${prefix}/files`))
        .attach('file', PNG_1X1, { filename: 'hero.png', contentType: 'image/png' })
        .expect(201);
      usedFileId = used.body.fileId;

      const unused = await auth(request(app.getHttpServer()).post(`${prefix}/files`))
        .attach('file', PNG_1X1, { filename: 'private.png', contentType: 'image/png' })
        .expect(201);
      unusedFileId = unused.body.fileId;

      // Blocks were replaced wholesale by the restore above, so re-read the
      // current hero id before pointing it at the image.
      const draft = await auth(request(app.getHttpServer()).get(`${prefix}/landing`)).expect(200);
      heroBlockId = draft.body.blocks[0].id;

      await auth(request(app.getHttpServer()).put(`${prefix}/landing/blocks/${heroBlockId}`))
        .send({
          content: {
            title: { ru: 'Детский сад «Солнышко»' },
            imageFileId: usedFileId,
          },
        })
        .expect(200);
      await auth(request(app.getHttpServer()).post(`${prefix}/landing/publish`))
        .send({})
        .expect(201);
    });

    it('serves an image referenced by the published page, without auth', async () => {
      const res = await request(app.getHttpServer())
        .get(`${prefix}/public/landing/${TENANT_CODE}/media/${usedFileId}`)
        .expect(200);
      expect(res.headers['content-type']).toContain('image/png');
      expect(res.headers['content-disposition']).toBe('inline');
    });

    it('refuses a file the published page does not reference', async () => {
      // The whole point of deriving access from the snapshot: uploading a
      // file must not make it publicly readable.
      await request(app.getHttpServer())
        .get(`${prefix}/public/landing/${TENANT_CODE}/media/${unusedFileId}`)
        .expect(404);
    });

    it('rejects a landing block pointing at a file that does not exist', async () => {
      const res = await auth(
        request(app.getHttpServer()).put(`${prefix}/landing/blocks/${heroBlockId}`),
      ).send({
        content: {
          title: { ru: 'Детский сад «Солнышко»' },
          imageFileId: '00000000-0000-4000-8000-000000000000',
        },
      });
      expect(res.status).toBe(422);
    });
  });

  describe('tenant isolation and permissions', () => {
    let second: Awaited<ReturnType<typeof createSecondTenant>>;
    let secondCode: string;

    beforeAll(async () => {
      second = await createSecondTenant(prisma, [{ key: 'landing:manage', scope: 'all' }]);
      const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: second.tenantId } });
      secondCode = tenant.code;
    });

    afterAll(async () => {
      await dropSecondTenant(prisma, second.tenantId);
    });

    it("does not serve one tenant's page under another tenant's code", async () => {
      // Tenant B has published nothing; the demo tenant has. A leak here
      // would show tenant A's content on tenant B's URL.
      await request(app.getHttpServer()).get(`${prefix}/public/landing/${secondCode}`).expect(404);
    });

    it('404s for a tenant code that does not exist', async () => {
      await request(app.getHttpServer()).get(`${prefix}/public/landing/no-such-tenant`).expect(404);
    });

    it('lets landing:manage edit but not publish', async () => {
      const secondToken = await login(app, prefix, second.login, second.password);
      await request(app.getHttpServer())
        .get(`${prefix}/landing`)
        .set('Authorization', `Bearer ${secondToken}`)
        .expect(200);

      const res = await request(app.getHttpServer())
        .post(`${prefix}/landing/publish`)
        .set('Authorization', `Bearer ${secondToken}`)
        .send({});
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('requires authentication on the admin endpoints', async () => {
      await request(app.getHttpServer()).get(`${prefix}/landing`).expect(401);
    });
  });
});
