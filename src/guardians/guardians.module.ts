import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { GuardiansController } from './guardians.controller';
import { ChildGuardianLinksController } from './child-guardian-links.controller';
import { GuardiansService } from './guardians.service';

@Module({
  imports: [AuditModule],
  controllers: [GuardiansController, ChildGuardianLinksController],
  providers: [GuardiansService],
  exports: [GuardiansService],
})
export class GuardiansModule {}
