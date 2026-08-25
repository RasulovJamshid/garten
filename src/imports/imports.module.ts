import { Module } from '@nestjs/common';
import { ChildrenModule } from '../children/children.module';
import { GuardiansModule } from '../guardians/guardians.module';
import { GroupsModule } from '../groups/groups.module';
import { UsersModule } from '../users/users.module';
import { ExpensesModule } from '../expenses/expenses.module';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';

@Module({
  imports: [ChildrenModule, GuardiansModule, GroupsModule, UsersModule, ExpensesModule],
  controllers: [ImportsController],
  providers: [ImportsService],
})
export class ImportsModule {}
