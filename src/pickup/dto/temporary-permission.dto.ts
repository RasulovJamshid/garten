import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, IsUUID } from 'class-validator';

export class TemporaryPermissionDto {
  @ApiProperty()
  @IsUUID()
  childId!: string;

  @ApiProperty({ required: false, description: 'Existing pickup person, if any' })
  @IsOptional()
  @IsUUID()
  pickupPersonId?: string;

  @ApiProperty({
    required: false,
    description: 'For a one-off person not stored as a pickup person',
  })
  @IsOptional()
  @IsString()
  fullName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  idDocNumber?: string;

  @ApiProperty()
  @IsDateString()
  validFrom!: string;

  @ApiProperty()
  @IsDateString()
  validTo!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  grantedByGuardianId?: string;

  @ApiProperty()
  @IsString()
  reason!: string;
}
