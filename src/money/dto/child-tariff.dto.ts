import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsUUID } from 'class-validator';

export class AssignChildTariffDto {
  @ApiProperty()
  @IsUUID()
  tariffId!: string;

  @ApiProperty()
  @IsDateString({ strict: true })
  effectiveFrom!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString({ strict: true })
  effectiveTo?: string;
}

export class EndChildTariffDto {
  @ApiProperty({ format: 'date' })
  @IsDateString({ strict: true })
  effectiveTo!: string;
}
