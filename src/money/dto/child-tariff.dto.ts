import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsUUID } from 'class-validator';

export class AssignChildTariffDto {
  @ApiProperty()
  @IsUUID()
  tariffId!: string;

  @ApiProperty()
  @IsDateString()
  effectiveFrom!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  effectiveTo?: string;
}
