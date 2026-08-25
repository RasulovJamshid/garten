import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PickupPersonsController } from './pickup-persons.controller';
import { PickupPermissionsController } from './pickup-permissions.controller';
import { PickupService } from './pickup.service';

@Module({
  imports: [AuditModule],
  controllers: [PickupPersonsController, PickupPermissionsController],
  providers: [PickupService],
})
export class PickupModule {}
