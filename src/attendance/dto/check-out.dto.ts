import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, IsUUID } from 'class-validator';

export class CheckOutDto {
  @ApiProperty()
  @IsUUID()
  childId!: string;

  @ApiProperty({
    required: false,
    description: 'Authorized pickup person; provide this or pickupPermissionId.',
  })
  @IsOptional()
  @IsUUID()
  pickupPersonId?: string;

  @ApiProperty({
    required: false,
    format: 'uuid',
    description: 'Active permission, including ad-hoc temporary pickups',
  })
  @IsOptional()
  @IsUUID()
  pickupPermissionId?: string;

  @ApiProperty({ required: false, description: 'Defaults to now' })
  @IsOptional()
  @IsDateString()
  at?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  note?: string;
}
