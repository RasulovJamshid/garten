import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString } from 'class-validator';

const SCOPES = ['all', 'branch', 'own_group', 'today', 'self'] as const;

export class PermissionGrantDto {
  @ApiProperty({ description: 'Permission key from the code catalog, e.g. child:read' })
  @IsString()
  key!: string;

  @ApiProperty({ enum: SCOPES })
  @IsIn(SCOPES)
  scope!: (typeof SCOPES)[number];
}
