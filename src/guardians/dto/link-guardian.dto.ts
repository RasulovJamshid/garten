import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, IsUUID } from 'class-validator';

export class LinkGuardianDto {
  @ApiProperty()
  @IsUUID()
  guardianId!: string;

  @ApiProperty({ description: 'mother/father/grandmother/...' })
  @IsString()
  relationship!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isPayer?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isEmergencyContact?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isPrimaryContact?: boolean;
}

export class UpdateGuardianLinkDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  relationship?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isPayer?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isEmergencyContact?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isPrimaryContact?: boolean;
}
