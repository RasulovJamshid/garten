import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class ForgotPasswordDto {
  @ApiProperty({ description: 'phone | email | username' })
  @IsString()
  login!: string;
}
