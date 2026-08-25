import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';
import { PermissionGrantDto } from './permission-grant.dto';

export class CreateRoleDto {
  @ApiProperty({ description: 'Short machine code, unique per tenant, e.g. senior_teacher' })
  @IsString()
  @Matches(/^[a-z][a-z0-9_]*$/, {
    message: 'code must be lowercase snake_case, starting with a letter',
  })
  code!: string;

  @ApiProperty()
  @IsString()
  nameUz!: string;

  @ApiProperty()
  @IsString()
  nameRu!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ type: [PermissionGrantDto] })
  @IsArray()
  @ArrayMinSize(0)
  @ValidateNested({ each: true })
  @Type(() => PermissionGrantDto)
  permissions!: PermissionGrantDto[];
}
