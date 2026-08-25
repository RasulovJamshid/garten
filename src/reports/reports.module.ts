import { Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module';
import { DebtsModule } from '../debts/debts.module';
import { ExpensesModule } from '../expenses/expenses.module';
import { RbacModule } from '../rbac/rbac.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { ExportsController } from './exports.controller';
import { ExportsService } from './exports.service';
import { ExportWorkerService } from './export-worker.service';

@Module({
  imports: [AttendanceModule, DebtsModule, ExpensesModule, RbacModule],
  controllers: [ReportsController, ExportsController],
  providers: [ReportsService, ExportsService, ExportWorkerService],
})
export class ReportsModule {}
