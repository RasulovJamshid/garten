import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AttendanceService } from './attendance.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Auth } from '../common/decorators/auth.decorator';
import { AuthContext } from '../common/auth-context';
import { CheckInDto } from './dto/check-in.dto';
import { CheckOutDto } from './dto/check-out.dto';
import { SetAttendanceStatusDto } from './dto/set-attendance-status.dto';
import { CorrectAttendanceDto } from './dto/correct-attendance.dto';

@ApiTags('attendance')
@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @ApiOperation({
    summary: "Get today's attendance",
    description: 'Filterable by groupId/branchId. Requires attendance:read.',
  })
  @Get('today')
  @RequirePermissions('attendance:read')
  today(
    @Auth() ctx: AuthContext,
    @Query('groupId') groupId?: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.attendance.today(ctx, groupId, branchId);
  }

  @ApiOperation({
    summary: 'List children currently checked in',
    description: 'Children who have checked in but not yet checked out, right now.',
  })
  @Get('inside')
  @RequirePermissions('attendance:read')
  inside(@Auth() ctx: AuthContext) {
    return this.attendance.inside(ctx);
  }

  @ApiOperation({
    summary: 'List absent children',
    description: 'Children with no check-in for the given date (defaults to today).',
  })
  @Get('absent')
  @RequirePermissions('attendance:read')
  absent(@Auth() ctx: AuthContext, @Query('date') date?: string) {
    return this.attendance.absent(ctx, date);
  }

  @ApiOperation({
    summary: 'List children not yet picked up',
    description: 'Children still checked in past their expected pickup time.',
  })
  @Get('not-picked-up')
  @RequirePermissions('attendance:read')
  notPickedUp(@Auth() ctx: AuthContext) {
    return this.attendance.notPickedUp(ctx);
  }

  @ApiOperation({
    summary: "Get a child's attendance calendar",
    description: 'One month of daily attendance status for a single child.',
  })
  @Get('calendar')
  @RequirePermissions('attendance:read')
  calendar(
    @Auth() ctx: AuthContext,
    @Query('childId') childId: string,
    @Query('year') year: string,
    @Query('month') month: string,
  ) {
    return this.attendance.calendar(ctx, childId, Number(year), Number(month));
  }

  @ApiOperation({
    summary: 'Get attendance summary',
    description: 'Aggregated attendance stats for a group over a date range (from/to).',
  })
  @Get('summary')
  @RequirePermissions('attendance:read')
  summary(
    @Auth() ctx: AuthContext,
    @Query('groupId') groupId: string | undefined,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.attendance.summary(ctx, groupId, from, to);
  }

  @ApiOperation({
    summary: 'List attendance corrections',
    description:
      'Audit trail of manually corrected attendance records, filterable by date range and the ' +
      'user who made the correction. Requires attendance:correct.',
  })
  @Get('corrections')
  @RequirePermissions('attendance:correct')
  corrections(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('userId') userId?: string,
  ) {
    return this.attendance.corrections({ from, to, userId });
  }

  @ApiOperation({
    summary: 'List attendance records',
    description: 'Filterable by date, date range, group, child, and status.',
  })
  @Get()
  @RequirePermissions('attendance:read')
  list(
    @Auth() ctx: AuthContext,
    @Query('date') date?: string,
    @Query('groupId') groupId?: string,
    @Query('childId') childId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('status') status?: string,
  ) {
    return this.attendance.list(ctx, { date, groupId, childId, from, to, status });
  }

  @ApiOperation({
    summary: 'Check in a child',
    description: 'Records a check-in event for the current day. Requires attendance:checkin.',
  })
  @Post('check-in')
  @RequirePermissions('attendance:checkin')
  checkIn(@Auth() ctx: AuthContext, @Body() dto: CheckInDto) {
    return this.attendance.checkIn(ctx, dto);
  }

  @ApiOperation({
    summary: 'Check out a child',
    description:
      'Records a check-out event, pairing with the open check-in. Requires attendance:checkout.',
  })
  @Post('check-out')
  @RequirePermissions('attendance:checkout')
  checkOut(@Auth() ctx: AuthContext, @Body() dto: CheckOutDto) {
    return this.attendance.checkOut(ctx, dto);
  }

  @ApiOperation({
    summary: 'Set attendance status directly',
    description:
      "Sets a child's attendance status (e.g. marking a planned absence) without going through " +
      'a physical check-in/check-out. Requires attendance:checkin.',
  })
  @Post('status')
  @RequirePermissions('attendance:checkin')
  setStatus(@Auth() ctx: AuthContext, @Body() dto: SetAttendanceStatusDto) {
    return this.attendance.setStatus(ctx, dto);
  }

  @ApiOperation({
    summary: 'Correct an attendance record',
    description:
      'Amends a past attendance record after the fact. Uses the separate attendance:correct ' +
      'permission rather than checkin/checkout, and is what shows up in GET /corrections.',
  })
  @Post(':id/correct')
  @RequirePermissions('attendance:correct')
  correct(@Auth() ctx: AuthContext, @Param('id') id: string, @Body() dto: CorrectAttendanceDto) {
    return this.attendance.correct(ctx, id, dto);
  }
}
