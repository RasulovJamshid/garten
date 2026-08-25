import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, ValidateNested } from 'class-validator';
import { PermissionGrantDto } from './permission-grant.dto';

export class ReplacePermissionsDto {
  @ApiProperty({ type: [PermissionGrantDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PermissionGrantDto)
  permissions!: PermissionGrantDto[];
}
