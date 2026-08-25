import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AppConfigService } from '../config/app-config.service';

/**
 * The raw, tenant-unaware Prisma client.
 *
 * Only auth/ (login happens before a tenant is known) and admin/ (tenant
 * bootstrap, cross-tenant operator tooling) may inject this directly.
 * Every domain module injects TenantPrisma instead — enforced by the
 * no-restricted-imports ESLint override in .eslintrc.js.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: AppConfigService) {
    super({
      datasourceUrl: config.get('DATABASE_URL'),
      log: config.isProduction ? ['warn', 'error'] : ['warn', 'error'],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Connected to Postgres');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
