import './instrument';
import './common/bigint-json.polyfill';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { writeFileSync } from 'node:fs';
import { AppModule } from './app.module';
import { AppConfigService } from './config/app-config.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(AppConfigService);

  app.use(helmet());
  app.use(cookieParser());

  // Explicit allow-list — `credentials: true` with a reflected/wildcard
  // origin would let any site read authenticated responses via the
  // browser's ambient cookies (see env.schema.ts CORS_ORIGINS comment).
  const allowedOrigins = new Set(config.get('CORS_ORIGINS') ?? [config.get('APP_URL')]);
  app.enableCors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`Origin "${origin}" is not allowed by CORS`));
      }
    },
    credentials: true,
  });
  app.setGlobalPrefix(config.get('API_PREFIX').replace(/^\//, ''));
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Single source of truth for docs — hand-maintained OpenAPI drifts within
  // weeks. Regenerated on every boot; committed copy is checked in CI
  // (api-spec §1).
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Kindergarten API')
      .setDescription('Kindergarten Management System — backend API (Stage 1)')
      .setVersion('1.0')
      .addBearerAuth()
      .build(),
  );
  SwaggerModule.setup('docs', app, document);
  try {
    writeFileSync('./openapi.json', JSON.stringify(document, null, 2));
  } catch {
    // non-fatal in read-only environments (e.g. some container filesystems)
  }

  const port = config.get('PORT');
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`Kindergarten API listening on port ${port} (prefix ${config.get('API_PREFIX')})`);
}

bootstrap();
