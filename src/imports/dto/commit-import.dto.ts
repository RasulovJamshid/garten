import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

export class CommitImportDto {
  @ApiProperty()
  @IsUUID()
  importJobId!: string;

  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @IsBoolean()
  skipInvalid?: boolean;
}
