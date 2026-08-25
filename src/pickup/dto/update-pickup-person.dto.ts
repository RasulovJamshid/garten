import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID } from 'class-validator';

export class UpdatePickupPersonDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  fullName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  relationship?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  photoFileId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  idDocType?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  idDocNumber?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  note?: string;
}

export class RevokePickupPersonDto {
  @ApiProperty()
  @IsString()
  reason!: string;
}
