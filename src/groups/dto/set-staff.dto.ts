import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class SetStaffDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  mainTeacherId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  assistantTeacherId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  nurseId?: string;
}
