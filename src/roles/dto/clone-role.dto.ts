import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class CloneRoleDto {
  @ApiProperty()
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
}
