import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ExportsService } from './exports.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';

@ApiTags('exports')
@Controller('exports')
export class ExportsController {
  constructor(private readonly exports: ExportsService) {}

  @Get(':id')
  @RequirePermissions('report:read')
  get(@Param('id') id: string) {
    return this.exports.get(id);
  }
}
