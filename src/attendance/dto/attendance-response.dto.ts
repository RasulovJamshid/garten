import { ApiProperty } from '@nestjs/swagger';

/**
 * NOTE FOR CLIENTS: attendance rows nest the child under `child` —
 * `row.child.firstName`, not `row.firstName`. The children directory
 * (`GET /children`) returns the child flat instead. The two screens are
 * often merged into one board, and reading the wrong one is why names
 * come out `undefined`.
 *
 * A child has no `fullName` field anywhere: compose it from
 * `firstName` + `lastName` client-side.
 */
export class AttendanceChildDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Alisher' })
  firstName!: string;

  @ApiProperty({ example: 'Karimov' })
  lastName!: string;
}

export class AttendanceDayDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  branchId!: string;

  @ApiProperty({ format: 'uuid' })
  childId!: string;

  @ApiProperty({ required: false, nullable: true, format: 'uuid' })
  groupId!: string | null;

  @ApiProperty({ format: 'date', example: '2026-09-09' })
  attendanceDate!: string;

  @ApiProperty({
    enum: ['present', 'late', 'early_departure', 'absent', 'sick', 'vacation', 'excused'],
  })
  status!: string;

  @ApiProperty({ required: false, nullable: true, format: 'date-time' })
  checkInAt!: string | null;

  @ApiProperty({ required: false, nullable: true, format: 'uuid' })
  checkInBy!: string | null;

  @ApiProperty({ required: false, nullable: true })
  checkInNote!: string | null;

  @ApiProperty({ required: false, nullable: true })
  healthObservation!: string | null;

  @ApiProperty({ required: false, nullable: true, format: 'date-time' })
  checkOutAt!: string | null;

  @ApiProperty({ required: false, nullable: true, format: 'uuid' })
  checkOutBy!: string | null;

  @ApiProperty({ required: false, nullable: true })
  checkOutNote!: string | null;

  @ApiProperty({ required: false, nullable: true, format: 'uuid' })
  pickupPersonId!: string | null;

  @ApiProperty({ description: 'Whether this day counts toward billing' })
  billable!: boolean;

  @ApiProperty({
    type: AttendanceChildDto,
    description: 'The child — names live HERE, not on the row',
  })
  child!: AttendanceChildDto;
}

export class AttendanceSummaryRowDto {
  @ApiProperty({ type: AttendanceChildDto })
  child!: AttendanceChildDto;

  @ApiProperty({ description: 'present + late + early_departure' })
  present!: number;

  @ApiProperty()
  absent!: number;

  @ApiProperty({ description: 'sick, vacation, excused' })
  other!: number;
}
