import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ExportsService } from './exports.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';

@ApiTags('exports')
@Controller('exports')
export class ExportsController {
  constructor(private readonly exports: ExportsService) {}

  @ApiOperation({
    summary: 'Get an export job by ID',
    description:
      'Poll this for the job a report endpoint returned 202 for (large xlsx/pdf exports run ' +
      'async — see the reports module). Once ready, the job carries a download link/status.',
  })
  @Get(':id')
  @RequirePermissions('report:read')
  get(@Param('id') id: string) {
    return this.exports.get(id);
  }
}
