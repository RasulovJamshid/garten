import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { MoneyModule } from '../money/money.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { BillingRulesController } from './billing-rules.controller';
import { BillingRulesService } from './billing-rules.service';
import { BillingRunsController } from './billing-runs.controller';
import { BillingRunsService } from './billing-runs.service';
import { ChargesController } from './charges.controller';
import { ChargesService } from './charges.service';

@Module({
  imports: [AuditModule, MoneyModule, NotificationsModule],
  controllers: [BillingRulesController, BillingRunsController, ChargesController],
  providers: [BillingRulesService, BillingRunsService, ChargesService],
  exports: [BillingRulesService, BillingRunsService, ChargesService],
})
export class BillingModule {}
