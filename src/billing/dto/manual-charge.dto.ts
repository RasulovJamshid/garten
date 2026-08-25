import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, Matches } from 'class-validator';

export class CreateManualChargeDto {
  @ApiProperty()
  @IsUUID()
  childId!: string;

  @ApiProperty()
  @IsUUID()
  periodId!: string;

  @ApiProperty({
    description:
      'Integer tiyin as a string — always positive; use a negative percent/fixed discount or /charges/:id/reverse for reductions',
  })
  @Matches(/^\d+$/, { message: 'amountTiyin must be a non-negative integer string' })
  amountTiyin!: string;

  @ApiProperty()
  @IsString()
  description!: string;
}

export class ReverseChargeDto {
  @ApiProperty()
  @IsString()
  reason!: string;
}
