import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Auth } from '../common/decorators/auth.decorator';
import { AuthContext } from '../common/auth-context';

@ApiTags('dashboard')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @ApiOperation({
    summary: "Director's dashboard",
    description: 'Cross-domain overview (enrollment, attendance, finance) scoped to the caller.',
  })
  @Get('director')
  @RequirePermissions('dashboard:read')
  director(@Auth() ctx: AuthContext) {
    return this.dashboard.director(ctx);
  }

  @ApiOperation({
    summary: "Accountant's dashboard",
    description: 'Finance-focused overview: billing, payments, debts.',
  })
  @Get('accountant')
  @RequirePermissions('dashboard:read')
  accountant() {
    return this.dashboard.accountant();
  }

  @ApiOperation({
    summary: "Reception's dashboard",
    description: "Day-to-day operational view: today's attendance, pickups, alerts.",
  })
  @Get('reception')
  @RequirePermissions('dashboard:read')
  reception(@Auth() ctx: AuthContext) {
    return this.dashboard.reception(ctx);
  }
}
