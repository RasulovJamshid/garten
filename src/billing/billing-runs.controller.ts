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
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { BillingRunsService } from './billing-runs.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Auth } from '../common/decorators/auth.decorator';
import { AuthContext } from '../common/auth-context';
import { PreviewBillingRunDto } from './dto/preview-billing-run.dto';

@ApiTags('billing-runs')
@Controller('billing-runs')
export class BillingRunsController {
  constructor(private readonly billingRuns: BillingRunsService) {}

  @ApiOperation({
    summary: 'Preview a billing run',
    description:
      'Computes what charges a run for dto.year/dto.month would generate, without writing ' +
      'anything to the ledger. Nothing is real until POST /:id/commit.',
  })
  @Post()
  @RequirePermissions('charge:generate')
  preview(@Auth() ctx: AuthContext, @Body() dto: PreviewBillingRunDto) {
    return this.billingRuns.preview(ctx, dto.year, dto.month);
  }

  @ApiOperation({
    summary: 'Get a billing run by ID',
  })
  @Get(':id')
  @RequirePermissions('charge:read')
  get(@Param('id') id: string) {
    return this.billingRuns.get(id);
  }

  @ApiOperation({
    summary: "Explain one child's charge within a billing run",
    description: "Breaks down how this child's charge was computed — tariff, discounts, proration.",
  })
  @Get(':id/explain/:childId')
  @RequirePermissions('charge:read')
  explain(@Param('id') id: string, @Param('childId') childId: string) {
    return this.billingRuns.explainChild(id, childId);
  }

  @ApiOperation({
    summary: 'Commit a billing run',
    description:
      'Writes the previewed charges to the ledger. Requires an Idempotency-Key header — ' +
      'retrying the same key returns the original result instead of double-billing.',
  })
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

  @ApiOperation({
    summary: 'Discard a billing run',
    description:
      'Discards a previewed (not yet committed) run. Nothing was written, so nothing to reverse.',
  })
  @Delete(':id')
  @RequirePermissions('charge:generate')
  discard(@Auth() ctx: AuthContext, @Param('id') id: string) {
    return this.billingRuns.discard(ctx, id);
  }
}
