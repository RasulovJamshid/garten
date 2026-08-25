import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsIn, IsInt, IsObject, IsOptional, IsString, Max, Min } from 'class-validator';

export class UpdateSettingsDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  displayName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  phones?: string[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsObject()
  bankDetails?: Record<string, unknown>;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsObject()
  taxInfo?: Record<string, unknown>;

  @ApiProperty({ required: false, type: [Number], description: 'ISO weekdays, 1=Mon..7=Sun' })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  workingDays?: number[];

  @ApiProperty({ required: false, example: { open: '07:00', close: '19:00' } })
  @IsOptional()
  @IsObject()
  workingHours?: Record<string, unknown>;

  @ApiProperty({ required: false, enum: ['uz', 'ru'] })
  @IsOptional()
  @IsIn(['uz', 'ru'])
  defaultLanguage?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  timezone?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  receiptNumberFormat?: string;

  @ApiProperty({ required: false, minimum: 1, maximum: 28 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(28)
  paymentDueDay?: number;
}
