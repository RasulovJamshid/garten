import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, IsUUID } from 'class-validator';

export class CheckInDto {
  @ApiProperty()
  @IsUUID()
  childId!: string;

  @ApiProperty({ required: false, description: 'Defaults to now' })
  @IsOptional()
  @IsDateString()
  at?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  healthObservation?: string;
}
