import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { TenantPrisma } from '../prisma/tenant-prisma.provider';
import { AuditService } from '../audit/audit.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Auth } from '../common/decorators/auth.decorator';
import { AuthContext } from '../common/auth-context';
import { AppErrors } from '../common/exceptions/app.exception';
import { CreateBranchDto, UpdateBranchDto } from './dto/branch.dto';

@ApiTags('branches')
@Controller('branches')
@RequirePermissions('branch:manage')
export class BranchesController {
  constructor(
    private readonly tenantPrisma: TenantPrisma,
    private readonly audit: AuditService,
  ) {}

  @ApiOperation({
    summary: 'List branches',
  })
  @Get()
  list() {
    return this.tenantPrisma.db.branch.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }

  @ApiOperation({
    summary: 'Create a branch',
    description: 'Stage 1 is single-branch in practice, but the schema supports more than one.',
  })
  @Post()
  async create(@Auth() ctx: AuthContext, @Body() dto: CreateBranchDto) {
    const branch = await this.tenantPrisma.db.branch.create({
      data: { ...dto, tenantId: this.tenantPrisma.tenantId },
    });
    await this.audit.log({
      userId: ctx.userId,
      action: 'settings.update',
      entityType: 'branch',
      entityId: branch.id,
      newValue: { code: branch.code, name: branch.name },
    });
    return branch;
  }

  @ApiOperation({
    summary: 'Update a branch',
  })
  @Patch(':id')
  async update(@Auth() ctx: AuthContext, @Param('id') id: string, @Body() dto: UpdateBranchDto) {
    const before = await this.tenantPrisma.db.branch.findUnique({ where: { id } });
    if (!before) throw AppErrors.notFound('Branch not found');

    const updated = await this.tenantPrisma.db.branch.update({ where: { id }, data: dto });
    await this.audit.log({
      userId: ctx.userId,
      action: 'settings.update',
      entityType: 'branch',
      entityId: id,
      oldValue: { name: before.name, status: before.status },
      newValue: { name: updated.name, status: updated.status },
    });
    return updated;
  }
}
