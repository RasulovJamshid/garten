import { Global, Module } from '@nestjs/common';
import { PgBossService } from './pgboss.service';

/**
 * Global so any domain module can inject PgBossService without importing
 * JobsModule itself — same reasoning as PrismaModule (01-stage1-plan.md §8).
 */
@Global()
@Module({
  providers: [PgBossService],
  exports: [PgBossService],
})
export class JobsModule {}
