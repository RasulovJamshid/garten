import { Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module';
import { DebtsModule } from '../debts/debts.module';
import { ExpensesModule } from '../expenses/expenses.module';
import { TelegramModule } from '../telegram/telegram.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [AttendanceModule, DebtsModule, ExpensesModule, TelegramModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
