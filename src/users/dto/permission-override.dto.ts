import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, IsString } from 'class-validator';

const SCOPES = ['all', 'branch', 'own_group', 'today', 'self'] as const;

export class PermissionOverrideDto {
  @ApiProperty()
  @IsString()
  key!: string;

  @ApiProperty({ enum: SCOPES })
  @IsIn(SCOPES)
  scope!: (typeof SCOPES)[number];

  @ApiProperty({ enum: ['grant', 'deny'] })
  @IsIn(['grant', 'deny'])
  effect!: 'grant' | 'deny';

  @ApiProperty({ description: 'Mandatory — this is audited' })
  @IsString()
  reason!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  validUntil?: string;
}
