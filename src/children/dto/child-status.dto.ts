import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsIn, IsString, Matches, MinLength } from 'class-validator';

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
  @IsDateString({ strict: true })
  effectiveDate!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @Matches(/\S/)
  reason!: string;
}
