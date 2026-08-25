import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class AssignRoleDto {
  @ApiProperty()
  @IsUUID()
  roleId!: string;

  @ApiProperty({
    required: false,
    description:
      'Branch to scope this grant to. Omit to grant across every branch the user currently ' +
      'has access to (see user_role.branch_id note in roles.service.ts / README).',
  })
  @IsOptional()
  @IsUUID()
  branchId?: string;
}
