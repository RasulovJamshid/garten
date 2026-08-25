import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsInt, IsObject, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateBillingRulesDto {
  @ApiProperty()
  @IsDateString()
  effectiveFrom!: string;

  @ApiProperty({ description: 'Full BillingRules config — see billing-rules.types.ts' })
  @IsObject()
  rules!: Record<string, unknown>;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  note?: string;
}

export class SimulateBillingDto {
  @ApiProperty()
  @IsString()
  childId!: string;

  @ApiProperty()
  @IsInt()
  @Min(2000)
  year!: number;

  @ApiProperty()
  @IsInt()
  @Min(1)
  @Max(12)
  month!: number;

  @ApiProperty({
    required: false,
    description: 'Override rules for the simulation, otherwise the active version is used',
  })
  @IsOptional()
  @IsObject()
  rules?: Record<string, unknown>;
}
