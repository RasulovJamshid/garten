import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreatePickupPersonDto {
  @ApiProperty()
  @IsString()
  fullName!: string;

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

  @ApiProperty({ enum: ['permanent', 'temporary'], default: 'permanent' })
  @IsIn(['permanent', 'temporary'])
  permissionType!: 'permanent' | 'temporary';

  @ApiProperty()
  @IsDateString()
  validFrom!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  validTo?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  grantedByGuardianId?: string;
}
