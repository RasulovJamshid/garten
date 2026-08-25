import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DocumentsService } from './documents.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';

@ApiTags('children')
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get('expiring')
  @RequirePermissions('child:read')
  expiring(@Query('withinDays') withinDays = '30') {
    return this.documents.expiring(Number(withinDays) || 30);
  }
}
