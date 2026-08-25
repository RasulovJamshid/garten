import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, IsUUID } from 'class-validator';

export class TransferChildDto {
  @ApiProperty()
  @IsUUID()
  childId!: string;

  @ApiProperty()
  @IsUUID()
  toGroupId!: string;

  @ApiProperty()
  @IsDateString()
  effectiveDate!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  reason?: string;
}
