import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, IsString } from 'class-validator';

const STATUSES = [
  'applicant',
  'active',
  'temporarily_absent',
  'suspended',
  'graduated',
  'withdrawn',
  'archived',
] as const;

export class ChildStatusDto {
  @ApiProperty({ enum: STATUSES })
  @IsIn(STATUSES)
  status!: (typeof STATUSES)[number];

  @ApiProperty()
  @IsDateString()
  effectiveDate!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  reason?: string;
}
