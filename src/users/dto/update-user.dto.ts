import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

export class UpdateUserDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  fullName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsIn(['uz', 'ru'])
  language?: string;

  @ApiProperty({
    required: false,
    type: [String],
    description:
      'Replaces the branches this user can see. Role grants move with them: dropping a branch ' +
      'drops the role rows on it, adding one re-grants every role the user already holds.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  branchIds?: string[];

  @ApiProperty({ required: false, description: 'Admin-initiated password reset' })
  @IsOptional()
  @IsString()
  @MinLength(10)
  password?: string;
}
