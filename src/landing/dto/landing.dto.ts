import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { LANDING_BLOCK_TYPES, LANDING_LOCALES } from '../block-content';

/**
 * `content` is deliberately typed as a plain object here and validated
 * separately by `parseBlockContent()` against the block's own schema —
 * class-validator has no clean way to express "this object's shape depends
 * on the value of a sibling field", and duplicating eleven block shapes as
 * DTO classes would put the section catalog in two places.
 */
export class CreateBlockDto {
  @ApiProperty({ enum: LANDING_BLOCK_TYPES })
  @IsIn(LANDING_BLOCK_TYPES)
  type!: (typeof LANDING_BLOCK_TYPES)[number];

  @ApiProperty({
    description: 'Shape depends on `type` — see GET /landing/block-types for each schema.',
    example: { title: { uz: 'Xush kelibsiz', ru: 'Добро пожаловать' } },
  })
  @IsObject()
  content!: Record<string, unknown>;

  @ApiProperty({ required: false, description: 'Defaults to the end of the page.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;

  @ApiProperty({ required: false, default: true })
  @IsOptional()
  @IsBoolean()
  isVisible?: boolean;
}

export class UpdateBlockDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsObject()
  content?: Record<string, unknown>;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isVisible?: boolean;
}

export class ReorderItemDto {
  @ApiProperty()
  @IsUUID()
  id!: string;

  @ApiProperty()
  @IsInt()
  @Min(0)
  position!: number;
}

export class ReorderBlocksDto {
  @ApiProperty({ type: [ReorderItemDto] })
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ReorderItemDto)
  blocks!: ReorderItemDto[];
}

export class I18nTextDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  uz?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  ru?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  en?: string;
}

export class UpdateSeoDto {
  @ApiProperty({ required: false, type: I18nTextDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => I18nTextDto)
  title?: I18nTextDto;

  @ApiProperty({ required: false, type: I18nTextDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => I18nTextDto)
  description?: I18nTextDto;

  @ApiProperty({ required: false, description: 'Open Graph preview image.' })
  @IsOptional()
  @IsUUID()
  ogImageFileId?: string;

  @ApiProperty({ required: false, example: 'https://sunshine.uz' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  canonicalUrl?: string;
}

export class PublishDto {
  @ApiProperty({ required: false, description: 'Shown in the version history.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class PublicLandingQueryDto {
  @ApiProperty({ required: false, enum: LANDING_LOCALES, default: 'ru' })
  @IsOptional()
  @IsIn(LANDING_LOCALES)
  lang?: (typeof LANDING_LOCALES)[number];
}
