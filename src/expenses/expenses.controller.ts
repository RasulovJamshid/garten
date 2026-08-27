import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ExpensesService } from './expenses.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Auth } from '../common/decorators/auth.decorator';
import { AuthContext } from '../common/auth-context';
import { CreateExpenseDto, PayExpenseDto, UpdateExpenseDto } from './dto/expense.dto';

@ApiTags('expenses')
@Controller('expenses')
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @ApiOperation({
    summary: 'Get an expense summary for a year',
  })
  @Get('summary')
  @RequirePermissions('expense:read')
  summary(@Query('year') year: string) {
    return this.expenses.summary(Number(year) || new Date().getFullYear());
  }

  @ApiOperation({
    summary: 'List expenses',
    description: 'Filterable by year, month, type, and status.',
  })
  @Get()
  @RequirePermissions('expense:read')
  list(
    @Query('year') year?: string,
    @Query('month') month?: string,
    @Query('type') type?: string,
    @Query('status') status?: string,
  ) {
    return this.expenses.list({
      year: year ? Number(year) : undefined,
      month: month ? Number(month) : undefined,
      type,
      status,
    });
  }

  @ApiOperation({
    summary: 'Record an expense',
    description: 'Requires expense:manage. Recorded as unpaid until POST /:id/pay.',
  })
  @Post()
  @RequirePermissions('expense:manage')
  create(@Auth() ctx: AuthContext, @Body() dto: CreateExpenseDto) {
    return this.expenses.create(ctx, dto);
  }

  @ApiOperation({
    summary: 'Update an expense',
  })
  @Patch(':id')
  @RequirePermissions('expense:manage')
  update(@Auth() ctx: AuthContext, @Param('id') id: string, @Body() dto: UpdateExpenseDto) {
    return this.expenses.update(ctx, id, dto);
  }

  @ApiOperation({
    summary: 'Mark an expense as paid',
  })
  @Post(':id/pay')
  @RequirePermissions('expense:manage')
  pay(@Auth() ctx: AuthContext, @Param('id') id: string, @Body() dto: PayExpenseDto) {
    return this.expenses.pay(ctx, id, dto);
  }
}
