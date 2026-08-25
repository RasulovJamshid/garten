import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

export class CreateUserDto {
  @ApiProperty()
  @IsString()
  fullName!: string;

  @ApiProperty()
  @IsString()
  phone!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  username?: string;

  @ApiProperty({ description: 'Initial password, set by the admin creating this account' })
  @IsString()
  @MinLength(10)
  password!: string;

  @ApiProperty({ description: 'Role to assign at creation' })
  @IsUUID()
  roleId!: string;

  @ApiProperty({ type: [String], description: 'Branches this user has access to' })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  branchIds!: string[];
}
