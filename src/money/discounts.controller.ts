import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DiscountsService } from './discounts.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Auth } from '../common/decorators/auth.decorator';
import { AuthContext } from '../common/auth-context';
import { CreateDiscountDto } from './dto/discount.dto';

@ApiTags('discounts')
@Controller('children/:childId/discounts')
export class DiscountsController {
  constructor(private readonly discounts: DiscountsService) {}

  @Get()
  @RequirePermissions('charge:read')
  list(@Param('childId') childId: string) {
    return this.discounts.listForChild(childId);
  }

  @Post()
  @RequirePermissions('discount:manage')
  create(
    @Auth() ctx: AuthContext,
    @Param('childId') childId: string,
    @Body() dto: CreateDiscountDto,
  ) {
    return this.discounts.create(ctx, childId, dto);
  }

  @Delete(':discountId')
  @RequirePermissions('discount:manage')
  revoke(@Auth() ctx: AuthContext, @Param('discountId') discountId: string) {
    return this.discounts.revoke(ctx, discountId);
  }
}
