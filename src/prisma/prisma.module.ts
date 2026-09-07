import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { TenantPrisma } from './tenant-prisma.provider';
import { PublicTenantPrisma } from './public-tenant-prisma.provider';

@Global()
@Module({
  providers: [PrismaService, TenantPrisma, PublicTenantPrisma],
  exports: [PrismaService, TenantPrisma, PublicTenantPrisma],
})
export class PrismaModule {}
