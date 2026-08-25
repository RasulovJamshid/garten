import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsObject, IsOptional, IsString, ArrayUnique } from 'class-validator';

export class UpsertNotificationTemplateDto {
  @ApiProperty()
  @IsString()
  bodyUz!: string;

  @ApiProperty()
  @IsString()
  bodyRu!: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  variables!: string[];

  @ApiProperty({ required: false, default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  // 05-telegram-spec.md §5 "Privacy defaults": charge_created/debt_reminder
  // include amounts by default; a tenant can turn that off so the bot
  // renders "you have a new charge, please check with the office" instead.
  @ApiProperty({ required: false, default: true })
  @IsOptional()
  @IsBoolean()
  includeAmounts?: boolean;
}

export class PreviewNotificationTemplateDto {
  @ApiProperty({ description: 'Sample values for every {var} the template declares' })
  @IsObject()
  sampleData!: Record<string, string>;
}
