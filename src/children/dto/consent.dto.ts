import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsUUID } from 'class-validator';

const CONSENT_TYPES = [
  'personal_data',
  'photography',
  'medical_storage',
  'notifications',
  'mobile_access',
] as const;

export class RecordConsentDto {
  @ApiProperty()
  @IsUUID()
  guardianId!: string;

  @ApiProperty({ enum: CONSENT_TYPES })
  @IsIn(CONSENT_TYPES)
  consentType!: (typeof CONSENT_TYPES)[number];

  @ApiProperty()
  @IsBoolean()
  granted!: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  evidenceFileId?: string;
}
