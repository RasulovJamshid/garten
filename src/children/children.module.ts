import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ChildrenController } from './children.controller';
import { DocumentsController } from './documents.controller';
import { ChildrenService } from './children.service';
import { MedicalService } from './medical.service';
import { DocumentsService } from './documents.service';
import { ConsentsService } from './consents.service';

@Module({
  imports: [AuditModule],
  controllers: [ChildrenController, DocumentsController],
  providers: [ChildrenService, MedicalService, DocumentsService, ConsentsService],
  exports: [ChildrenService, MedicalService, DocumentsService, ConsentsService],
})
export class ChildrenModule {}
