import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DocumentsService } from './documents.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';

@ApiTags('children')
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @ApiOperation({
    summary: 'List documents expiring soon',
    description:
      'Cross-child view of documents (e.g. medical certificates, contracts) expiring within the ' +
      'given window (default 30 days). Requires child:read.',
  })
  @Get('expiring')
  @RequirePermissions('child:read')
  expiring(@Query('withinDays') withinDays = '30') {
    return this.documents.expiring(Number(withinDays) || 30);
  }
}
