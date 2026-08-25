import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, ValidateNested } from 'class-validator';
import { AssignRoleDto } from './assign-role.dto';

export class ReplaceRolesDto {
  @ApiProperty({ type: [AssignRoleDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AssignRoleDto)
  roles!: AssignRoleDto[];
}
