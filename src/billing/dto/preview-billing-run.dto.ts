import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';

export class PreviewBillingRunDto {
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
