import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

const NON_ATTENDING_STATUSES = ['absent', 'sick', 'vacation', 'excused'] as const;

export class SetAttendanceStatusDto {
  @ApiProperty()
  @IsUUID()
  childId!: string;

  @ApiProperty()
  @IsDateString({ strict: true })
  date!: string;

  @ApiProperty({ enum: NON_ATTENDING_STATUSES })
  @IsIn(NON_ATTENDING_STATUSES)
  status!: (typeof NON_ATTENDING_STATUSES)[number];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiProperty({
    required: false,
    description: 'Required for corrections and historical entries; minimum 10 characters',
  })
  @IsOptional()
  @IsString()
  reason?: string;
}
