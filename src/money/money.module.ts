import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { TariffsController } from './tariffs.controller';
import { DiscountsController } from './discounts.controller';
import { PeriodsController } from './periods.controller';
import { TariffsService } from './tariffs.service';
import { DiscountsService } from './discounts.service';
import { PeriodsService } from './periods.service';

@Module({
  imports: [AuditModule],
  controllers: [TariffsController, DiscountsController, PeriodsController],
  providers: [TariffsService, DiscountsService, PeriodsService],
  exports: [TariffsService, DiscountsService, PeriodsService],
})
export class MoneyModule {}
