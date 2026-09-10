import { ApiProperty } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../common/dto/pagination.dto';

/**
 * A child's name is ALWAYS `firstName` / `lastName` / `middleName` —
 * there is no `fullName` and no `name` on a child anywhere in this API
 * (guardians and pickup persons do have `fullName`; children do not).
 * Declaring the shape here is what puts it into openapi.json, so a
 * generated client types it instead of inferring `unknown`.
 */
export class ChildSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  branchId!: string;

  @ApiProperty({ example: 'Alisher' })
  firstName!: string;

  @ApiProperty({ example: 'Karimov' })
  lastName!: string;

  @ApiProperty({ required: false, nullable: true })
  middleName!: string | null;

  @ApiProperty({ format: 'date', example: '2021-04-17' })
  birthDate!: string;

  @ApiProperty({ required: false, nullable: true, enum: ['male', 'female'] })
  gender!: string | null;

  @ApiProperty({
    enum: [
      'applicant',
      'active',
      'temporarily_absent',
      'suspended',
      'graduated',
      'withdrawn',
      'archived',
    ],
    description:
      'A child created via POST /children starts as `applicant` — it must be moved to `active` ' +
      'before it appears on attendance screens.',
  })
  status!: string;

  @ApiProperty({ required: false, nullable: true, format: 'uuid' })
  photoFileId!: string | null;

  @ApiProperty({
    required: false,
    nullable: true,
    format: 'uuid',
    description: 'Current group (group_assignment with effectiveTo = null); null if unassigned.',
  })
  groupId!: string | null;

  @ApiProperty({ required: false, nullable: true, example: 'Quyoshcha' })
  groupName!: string | null;
}

export class ChildListResponseDto {
  @ApiProperty({ type: [ChildSummaryDto] })
  data!: ChildSummaryDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta!: PaginationMetaDto;
}

export class ChildGuardianDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Karimov Bobur' })
  fullName!: string;

  @ApiProperty({ example: '+998901234567' })
  phone!: string;

  @ApiProperty({ enum: ['uz', 'ru'] })
  preferredLanguage!: string;
}

export class ChildGuardianLinkDto {
  @ApiProperty({ format: 'uuid' })
  guardianId!: string;

  @ApiProperty({ example: 'mother' })
  relationship!: string;

  @ApiProperty({ description: 'Primary contact for notifications' })
  isPrimaryContact!: boolean;

  @ApiProperty({ description: 'Receives invoices and is chased for debt' })
  isPayer!: boolean;

  @ApiProperty()
  isEmergencyContact!: boolean;

  @ApiProperty({ type: ChildGuardianDto })
  guardian!: ChildGuardianDto;
}

/** The compact alert surface — never the full medical record. */
export class ChildAlertDto {
  @ApiProperty({ example: 'Peanuts' })
  allergen!: string;

  @ApiProperty({ enum: ['mild', 'moderate', 'severe'] })
  severity!: string;

  @ApiProperty({ required: false, nullable: true })
  instruction!: string | null;
}

export class ChildDetailDto extends ChildSummaryDto {
  @ApiProperty({ required: false, nullable: true })
  address!: string | null;

  @ApiProperty({ required: false, nullable: true, format: 'date' })
  enrollmentDate!: string | null;

  @ApiProperty({ required: false, nullable: true, format: 'date' })
  withdrawalDate!: string | null;

  @ApiProperty({ required: false, nullable: true })
  contractNumber!: string | null;

  @ApiProperty({ required: false, nullable: true })
  registrationNumber!: string | null;

  @ApiProperty({ required: false, nullable: true })
  note!: string | null;

  @ApiProperty({ type: [ChildGuardianLinkDto] })
  childGuardian!: ChildGuardianLinkDto[];

  @ApiProperty({ type: [ChildAlertDto] })
  allergy!: ChildAlertDto[];
}
