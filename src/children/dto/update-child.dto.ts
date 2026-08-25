import { ApiProperty, PartialType } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { CreateChildDto } from './create-child.dto';

export class UpdateChildDto extends PartialType(CreateChildDto) {
  // A validator-less field is invisible to class-validator's whitelist
  // check — with forbidNonWhitelisted:true that doesn't silently drop the
  // field, it rejects the *entire request* with "property photoFileId
  // should not exist", even when the field isn't in the request body at
  // all. Broke every PATCH /children/:id call (confirmed via e2e test).
  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  photoFileId?: string;
}
