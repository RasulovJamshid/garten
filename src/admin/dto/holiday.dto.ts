import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateHolidayDto {
  @ApiProperty({ required: false, description: 'Omit for all branches' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiProperty()
  @IsDateString()
  holidayDate!: string;

  @ApiProperty()
  @IsString()
  name!: string;

  @ApiProperty({ required: false, description: 'True = a working Saturday override' })
  @IsOptional()
  @IsBoolean()
  isWorking?: boolean;
}
