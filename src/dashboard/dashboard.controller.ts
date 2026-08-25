import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Auth } from '../common/decorators/auth.decorator';
import { AuthContext } from '../common/auth-context';

@ApiTags('dashboard')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('director')
  @RequirePermissions('dashboard:read')
  director(@Auth() ctx: AuthContext) {
    return this.dashboard.director(ctx);
  }

  @Get('accountant')
  @RequirePermissions('dashboard:read')
  accountant() {
    return this.dashboard.accountant();
  }

  @Get('reception')
  @RequirePermissions('dashboard:read')
  reception(@Auth() ctx: AuthContext) {
    return this.dashboard.reception(ctx);
  }
}
