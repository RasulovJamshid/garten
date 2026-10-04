import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class SetStaffDto {
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsUUID()
  mainTeacherId?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsUUID()
  assistantTeacherId?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsUUID()
  nurseId?: string | null;
}
