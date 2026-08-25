import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Max, Min } from 'class-validator';

export class CreatePeriodDto {
  @ApiProperty()
  @IsInt()
  @Min(2000)
  year!: number;

  @ApiProperty()
  @IsInt()
  @Min(1)
  @Max(12)
  month!: number;
}

export class ReopenPeriodDto {
  @ApiProperty()
  @IsString()
  reason!: string;
}
