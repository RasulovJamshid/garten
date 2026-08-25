import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsDateString, IsIn, IsOptional, IsString, ValidateNested } from 'class-validator';

const SEVERITIES = ['mild', 'moderate', 'severe', 'anaphylactic'] as const;

export class AllergyDto {
  @ApiProperty()
  @IsString()
  allergen!: string;

  @ApiProperty({ enum: SEVERITIES, required: false })
  @IsOptional()
  @IsIn(SEVERITIES)
  severity?: (typeof SEVERITIES)[number];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  reaction?: string;

  @ApiProperty({ required: false, description: 'Shown as the reception/teacher alert' })
  @IsOptional()
  @IsString()
  instruction?: string;
}

export class MedicationDto {
  @ApiProperty()
  @IsString()
  name!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  dosage?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  schedule?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  validFrom?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  validTo?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  prescribedBy?: string;
}

export class UpdateMedicalDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  bloodType?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  chronicConditions?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  emergencyInstructions?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  doctorName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  doctorPhone?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  clinic?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiProperty({ type: [AllergyDto], required: false })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AllergyDto)
  allergies?: AllergyDto[];

  @ApiProperty({ type: [MedicationDto], required: false })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MedicationDto)
  medications?: MedicationDto[];
}
