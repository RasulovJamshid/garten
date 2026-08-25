import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

const CHANNELS = ['telegram', 'sms', 'internal', 'email'] as const;

export class NotificationRecipientDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  guardianId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  userId?: string;
}

export class SendNotificationDto {
  @ApiProperty()
  @IsString()
  templateKey!: string;

  @ApiProperty({ type: [NotificationRecipientDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => NotificationRecipientDto)
  recipients!: NotificationRecipientDto[];

  @ApiProperty({ enum: CHANNELS })
  @IsIn(CHANNELS)
  channel!: (typeof CHANNELS)[number];

  @ApiProperty({ description: 'Values for the template’s {var} placeholders' })
  @IsObject()
  data!: Record<string, string>;

  // Feeds dedup_key = sha256(templateKey + recipientId + entityId) — the
  // caller supplies the natural id of whatever triggered this (a payment,
  // a charge, an attendance record). Omitted for one-off manual sends,
  // where at most one of this template ever reaches a given recipient.
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  entityId?: string;
}
