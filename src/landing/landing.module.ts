import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { LandingController } from './landing.controller';
import { LandingService } from './landing.service';
import { PublicLandingController } from './public-landing.controller';
import { PublicLandingService } from './public-landing.service';

/**
 * Content management for the public marketing site. Two halves, kept in
 * separate classes rather than one controller with mixed decorators: the
 * admin half is permission-gated and tenant-scoped through the JWT, the
 * public half is anonymous and resolves its tenant from the URL. Nothing
 * on the public side can reach a draft.
 */
@Module({
  imports: [AuditModule],
  controllers: [LandingController, PublicLandingController],
  providers: [LandingService, PublicLandingService],
  exports: [LandingService],
})
export class LandingModule {}
