import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, IsUUID } from 'class-validator';

export class CheckOutDto {
  @ApiProperty()
  @IsUUID()
  childId!: string;

  @ApiProperty({
    required: false,
    description:
      'Person picking up the child. Validated against pickup permissions once the pickup ' +
      'module exists — currently recorded but not yet permission-checked (see attendance.service.ts).',
  })
  @IsOptional()
  @IsUUID()
  pickupPersonId?: string;

  @ApiProperty({ required: false, description: 'Defaults to now' })
  @IsOptional()
  @IsDateString()
  at?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  note?: string;
}
