/**
 * Regenerates the committed openapi.json without booting the server or
 * touching the database. main.ts writes the same document on every boot;
 * this is the offline path, so a contract change can land in the same
 * commit as the code that made it (api-spec §1).
 */
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { writeFileSync } from 'node:fs';
import { AppModule } from '../src/app.module';

async function main() {
  const app = await NestFactory.create(AppModule, { logger: false, preview: true });
  app.setGlobalPrefix((process.env.API_PREFIX ?? '/api/v1').replace(/^\//, ''));

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Kindergarten API')
      .setDescription('Kindergarten Management System — backend API (Stage 1)')
      .setVersion('1.0')
      .addBearerAuth()
      .build(),
  );

  writeFileSync('./openapi.json', JSON.stringify(document, null, 2));
  await app.close();
  // eslint-disable-next-line no-console
  console.log(`openapi.json written: ${Object.keys(document.paths).length} paths`);
}

void main();
