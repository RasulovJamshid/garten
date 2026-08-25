import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  ValidateNested,
} from 'class-validator';

const METHODS = ['cash', 'bank', 'card', 'online', 'other'] as const;

export class PaymentAllocationInputDto {
  @ApiProperty()
  @IsUUID()
  chargeId!: string;

  @ApiProperty({ description: 'Integer tiyin as a string' })
  @Matches(/^\d+$/, { message: 'amountTiyin must be a non-negative integer string' })
  amountTiyin!: string;
}

export class CreatePaymentDto {
  @ApiProperty()
  @IsUUID()
  childId!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  payerGuardianId?: string;

  @ApiProperty({ description: 'Integer tiyin as a string' })
  @Matches(/^\d+$/, { message: 'amountTiyin must be a positive integer string' })
  amountTiyin!: string;

  @ApiProperty({ enum: METHODS })
  @IsIn(METHODS)
  method!: (typeof METHODS)[number];

  @ApiProperty()
  @IsDateString()
  paidAt!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  receiptNo?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  bankRef?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  attachmentFileId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiProperty({
    required: false,
    type: [PaymentAllocationInputDto],
    description: 'Omit to auto-allocate FIFO, oldest open charge first',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PaymentAllocationInputDto)
  allocations?: PaymentAllocationInputDto[];
}

export class CancelPaymentDto {
  @ApiProperty()
  @IsString()
  reason!: string;
}
