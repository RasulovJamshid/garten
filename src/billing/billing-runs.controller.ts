import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { BillingRunsService } from './billing-runs.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Auth } from '../common/decorators/auth.decorator';
import { AuthContext } from '../common/auth-context';
import { PreviewBillingRunDto } from './dto/preview-billing-run.dto';

@ApiTags('billing-runs')
@Controller('billing-runs')
export class BillingRunsController {
  constructor(private readonly billingRuns: BillingRunsService) {}

  @Post()
  @RequirePermissions('charge:generate')
  preview(@Auth() ctx: AuthContext, @Body() dto: PreviewBillingRunDto) {
    return this.billingRuns.preview(ctx, dto.year, dto.month);
  }

  @Get(':id')
  @RequirePermissions('charge:read')
  get(@Param('id') id: string) {
    return this.billingRuns.get(id);
  }

  @Get(':id/explain/:childId')
  @RequirePermissions('charge:read')
  explain(@Param('id') id: string, @Param('childId') childId: string) {
    return this.billingRuns.explainChild(id, childId);
  }

  @Post(':id/commit')
  @RequirePermissions('charge:generate')
  commit(
    @Auth() ctx: AuthContext,
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    if (!idempotencyKey) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'Idempotency-Key header is required',
      });
    }
    return this.billingRuns.commit(ctx, id, idempotencyKey);
  }

  @Delete(':id')
  @RequirePermissions('charge:generate')
  discard(@Auth() ctx: AuthContext, @Param('id') id: string) {
    return this.billingRuns.discard(ctx, id);
  }
}
