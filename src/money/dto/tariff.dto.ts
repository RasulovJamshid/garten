import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, Matches } from 'class-validator';

const TARIFF_KINDS = [
  'monthly_fixed',
  'full_day',
  'half_day',
  'group_based',
  'attendance_based',
  'meal',
  'transport',
  'extra_class',
  'registration_fee',
] as const;

export class CreateTariffDto {
  @ApiProperty({ required: false, description: 'Omit for a tenant-wide tariff' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiProperty()
  @IsString()
  name!: string;

  @ApiProperty({ enum: TARIFF_KINDS })
  @IsIn(TARIFF_KINDS)
  kind!: (typeof TARIFF_KINDS)[number];

  @ApiProperty({ description: 'Integer tiyin as a string, e.g. "150000000"' })
  @Matches(/^\d+$/, { message: 'amountTiyin must be a non-negative integer string' })
  amountTiyin!: string;
}

export class UpdateTariffDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @Matches(/^\d+$/, { message: 'amountTiyin must be a non-negative integer string' })
  amountTiyin?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
