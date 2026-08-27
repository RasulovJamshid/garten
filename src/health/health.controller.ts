import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @ApiOperation({
    summary: 'Health check',
    description:
      'Public, unauthenticated. Confirms the database is reachable (SELECT 1) and returns 503 ' +
      'STORAGE_UNAVAILABLE otherwise. Used by the CI/CD smoke test and can be pointed at by an ' +
      'uptime monitor.',
  })
  @Public()
  @Get()
  async check() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException({
        code: 'STORAGE_UNAVAILABLE',
        message: 'Database unreachable',
      });
    }
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
