import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

const PRIORITIES = ['low', 'normal', 'high', 'emergency'] as const;
const AUDIENCE_TYPES = ['all', 'group', 'children', 'guardians', 'staff'] as const;

export class CreateAnnouncementDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiProperty()
  @IsString()
  title!: string;

  @ApiProperty()
  @IsString()
  body!: string;

  @ApiProperty({ enum: PRIORITIES, required: false, default: 'normal' })
  @IsOptional()
  @IsIn(PRIORITIES)
  priority?: (typeof PRIORITIES)[number];

  @ApiProperty({ enum: AUDIENCE_TYPES })
  @IsIn(AUDIENCE_TYPES)
  audienceType!: (typeof AUDIENCE_TYPES)[number];

  @ApiProperty({ type: [String], required: false })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  audienceIds?: string[];

  @ApiProperty({ type: [String], required: false })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  fileIds?: string[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  publishAt?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
