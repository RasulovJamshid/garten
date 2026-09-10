import { ApiProperty } from '@nestjs/swagger';

export class GroupDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  branchId!: string;

  @ApiProperty({ example: 'Quyoshcha' })
  name!: string;

  @ApiProperty({ required: false, nullable: true, example: 36 })
  ageMinMonths!: number | null;

  @ApiProperty({ required: false, nullable: true, example: 48 })
  ageMaxMonths!: number | null;

  @ApiProperty({ example: 20 })
  capacity!: number;

  @ApiProperty({
    required: false,
    nullable: true,
    description: 'e.g. { "open": "07:30", "close": "19:00" }',
  })
  workingHours!: Record<string, unknown> | null;

  @ApiProperty({ enum: ['active', 'archived'] })
  status!: string;

  @ApiProperty({ description: 'Children currently assigned (effectiveTo = null)' })
  currentCount!: number;

  @ApiProperty({ description: 'capacity − currentCount' })
  availablePlaces!: number;
}

/** Same name rule as everywhere else: first/last, never a `fullName`. */
export class GroupChildDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  lastName!: string;

  @ApiProperty({ format: 'date' })
  birthDate!: string;

  @ApiProperty()
  status!: string;
}

export class StaffMemberDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ description: 'Staff DO have fullName — children do not' })
  fullName!: string;
}

/**
 * A teacher's `own_group` scope resolves through group_staff, so a
 * teacher missing from every slot here resolves to no groups at all and
 * gets NO_SCOPE_ASSIGNMENT from the children/attendance endpoints.
 */
export class GroupStaffDto {
  @ApiProperty({ type: StaffMemberDto, required: false, nullable: true })
  mainTeacher!: StaffMemberDto | null;

  @ApiProperty({ type: StaffMemberDto, required: false, nullable: true })
  assistant!: StaffMemberDto | null;

  @ApiProperty({ type: StaffMemberDto, required: false, nullable: true })
  nurse!: StaffMemberDto | null;
}
