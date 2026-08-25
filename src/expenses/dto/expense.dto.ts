import { ApiProperty } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';

const EXPENSE_TYPES = [
  'electricity',
  'gas',
  'cold_water',
  'hot_water',
  'heating',
  'waste',
  'internet',
  'telephone',
  'security',
  'rent',
  'other',
] as const;

export class CreateExpenseDto {
  @ApiProperty()
  @IsUUID()
  branchId!: string;

  @ApiProperty({ enum: EXPENSE_TYPES })
  @IsIn(EXPENSE_TYPES)
  type!: (typeof EXPENSE_TYPES)[number];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  provider?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  contractNumber?: string;

  @ApiProperty()
  @IsInt()
  @Min(2000)
  billingYear!: number;

  @ApiProperty()
  @IsInt()
  @Min(1)
  @Max(12)
  billingMonth!: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  invoiceNumber?: string;

  @ApiProperty({ description: 'Integer tiyin as a string' })
  @Matches(/^\d+$/, { message: 'amountTiyin must be a non-negative integer string' })
  amountTiyin!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  attachmentFileId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  note?: string;
}

export class UpdateExpenseDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  provider?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @Matches(/^\d+$/, { message: 'amountTiyin must be a non-negative integer string' })
  amountTiyin?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  note?: string;
}

export class PayExpenseDto {
  @ApiProperty()
  @IsDateString()
  paidAt!: string;

  @ApiProperty({ description: 'Integer tiyin as a string' })
  @Matches(/^\d+$/, { message: 'amountTiyin must be a non-negative integer string' })
  amountTiyin!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  attachmentFileId?: string;
}
