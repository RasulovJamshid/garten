import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, MinLength } from 'class-validator';

const CORRECTABLE_FIELDS = ['status', 'checkInAt', 'checkOutAt', 'pickupPersonId'] as const;

export class CorrectAttendanceDto {
  @ApiProperty({ enum: CORRECTABLE_FIELDS })
  @IsIn(CORRECTABLE_FIELDS)
  field!: (typeof CORRECTABLE_FIELDS)[number];

  @ApiProperty()
  @IsString()
  newValue!: string;

  @ApiProperty({ description: 'Minimum 10 characters — enforced by the DB too' })
  @IsString()
  @MinLength(10)
  reason!: string;
}
