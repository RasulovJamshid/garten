import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { PaymentsService } from './payments.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Auth } from '../common/decorators/auth.decorator';
import { AuthContext } from '../common/auth-context';
import { CreatePaymentDto, CancelPaymentDto } from './dto/create-payment.dto';

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get()
  @RequirePermissions('payment:read')
  list(
    @Query('childId') childId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('method') method?: string,
    @Query('recordedBy') recordedBy?: string,
  ) {
    return this.payments.list({ childId, from, to, method, recordedBy });
  }

  @Post()
  @RequirePermissions('payment:create')
  create(
    @Auth() ctx: AuthContext,
    @Body() dto: CreatePaymentDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    if (!idempotencyKey) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'Idempotency-Key header is required',
      });
    }
    return this.payments.create(ctx, dto, idempotencyKey);
  }

  @Get(':id')
  @RequirePermissions('payment:read')
  get(@Param('id') id: string) {
    return this.payments.get(id);
  }

  @Post(':id/cancel')
  @RequirePermissions('payment:cancel')
  cancel(@Auth() ctx: AuthContext, @Param('id') id: string, @Body() dto: CancelPaymentDto) {
    return this.payments.cancel(ctx, id, dto.reason);
  }

  @Get(':id/receipt')
  @RequirePermissions('payment:read')
  async receipt(
    @Param('id') id: string,
    @Query('format') format: string | undefined,
    @Res() res: Response,
  ) {
    if (format === 'pdf') {
      const buffer = await this.payments.receiptPdf(id);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="receipt-${id}.pdf"`);
      res.send(buffer);
      return;
    }
    const html = await this.payments.receiptHtml(id);
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  }
}
