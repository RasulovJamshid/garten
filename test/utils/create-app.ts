import '../../src/common/bigint-json.polyfill';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { AppModule } from '../../src/app.module';
import { AppConfigService } from '../../src/config/app-config.service';

/**
 * Boots the real AppModule end to end against the dev Postgres instance
 * (same DATABASE_URL as `npm run start:dev` — there is no separate test
 * database in this project's Stage 1 setup). Mirrors main.ts's global
 * pipe/middleware wiring exactly, minus Swagger/Sentry, which have
 * nothing to do with request behavior under test.
 *
 * Every *.e2e-spec.ts file shares this ONE database — there is no
 * per-file/per-worker isolation. That's why `npm run test:e2e` passes
 * `--runInBand`: Jest's default parallel workers let one file's writes
 * bleed into another's assumptions. Concretely, auth.e2e-spec.ts's
 * forgot/reset/login cycle briefly makes OWNER_PASSWORD genuinely wrong
 * before restoring it — any other suite's `login(OWNER_LOGIN,
 * OWNER_PASSWORD)` landing inside that window gets a real 401, not a bug
 * in the app (confirmed while adding this comment: with default
 * parallelism, growing the suite from 5 files to 9 was enough to make
 * that collision reproducible). Keep new suites running serially unless
 * you've made them tolerant of this.
 */
export async function createTestApp(): Promise<{ app: INestApplication; prefix: string }> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  const config = app.get(AppConfigService);

  app.use(cookieParser());
  const prefix = config.get('API_PREFIX').replace(/^\//, '');
  app.setGlobalPrefix(prefix);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  await app.init();
  return { app, prefix: `/${prefix}` };
}

export async function login(
  app: INestApplication,
  prefix: string,
  login: string,
  password: string,
): Promise<string> {
  const request = (await import('supertest')).default;
  const res = await request(app.getHttpServer())
    .post(`${prefix}/auth/login`)
    .send({ login, password })
    .expect(200);
  return res.body.accessToken;
}
