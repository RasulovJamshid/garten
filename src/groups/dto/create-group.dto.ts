import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsObject, IsOptional, IsPositive, IsString, IsUUID } from 'class-validator';

export class CreateGroupDto {
  @ApiProperty()
  @IsUUID()
  branchId!: string;

  @ApiProperty()
  @IsString()
  name!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  ageMinMonths?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  ageMaxMonths?: number;

  @ApiProperty({ required: false, default: 20 })
  @IsOptional()
  @IsInt()
  @IsPositive()
  capacity?: number;

  @ApiProperty({ required: false, example: { open: '07:00', close: '19:00' } })
  @IsOptional()
  @IsObject()
  workingHours?: Record<string, unknown>;
}
