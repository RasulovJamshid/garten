import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export const CHILD_LOOKUP_PERMISSIONS = [
  'child:read',
  'payment:read',
  'payment:create',
  'charge:read',
  'charge:generate',
  'billing_rules:manage',
  'pickup:read',
  'attendance:checkin',
] as const;

export class ChildLookupDto {
  @ApiPropertyOptional({ enum: CHILD_LOOKUP_PERMISSIONS, default: 'child:read' })
  @IsIn(CHILD_LOOKUP_PERMISSIONS)
  permission: (typeof CHILD_LOOKUP_PERMISSIONS)[number] = 'child:read';

  @ApiPropertyOptional({ type: String, maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  groupId?: string;

  @ApiPropertyOptional({ type: Number, minimum: 1, default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: 200, default: 20 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit = 20;
}
