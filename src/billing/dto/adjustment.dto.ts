import { ApiProperty } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MinLength,
} from 'class-validator';

export class CreateAdjustmentDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() childId!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() periodId!: string;
  @ApiProperty({ enum: [-1, 1], description: '-1 credits the family, +1 adds a charge' })
  @IsIn([-1, 1])
  sign!: -1 | 1;
  @ApiProperty({ description: 'Positive integer tiyin' })
  @Matches(/^[1-9]\d*$/)
  amountTiyin!: string;
  @ApiProperty() @IsString() @MinLength(10) reason!: string;
  @ApiProperty({ required: false, format: 'date' })
  @IsOptional()
  @IsDateString({ strict: true })
  dueDate?: string;
}
