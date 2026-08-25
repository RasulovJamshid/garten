import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { SettingsController } from './settings.controller';
import { HolidaysController } from './holidays.controller';
import { BranchesController } from './branches.controller';

@Module({
  imports: [AuditModule],
  controllers: [SettingsController, HolidaysController, BranchesController],
})
export class AdminModule {}
