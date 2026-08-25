import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsUUID } from 'class-validator';

export class AssignChildDto {
  @ApiProperty()
  @IsUUID()
  childId!: string;

  @ApiProperty()
  @IsDateString()
  effectiveDate!: string;
}
