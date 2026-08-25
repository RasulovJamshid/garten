import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
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

  @Get('today')
  @RequirePermissions('attendance:read')
  today(
    @Auth() ctx: AuthContext,
    @Query('groupId') groupId?: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.attendance.today(ctx, groupId, branchId);
  }

  @Get('inside')
  @RequirePermissions('attendance:read')
  inside(@Auth() ctx: AuthContext) {
    return this.attendance.inside(ctx);
  }

  @Get('absent')
  @RequirePermissions('attendance:read')
  absent(@Auth() ctx: AuthContext, @Query('date') date?: string) {
    return this.attendance.absent(ctx, date);
  }

  @Get('not-picked-up')
  @RequirePermissions('attendance:read')
  notPickedUp(@Auth() ctx: AuthContext) {
    return this.attendance.notPickedUp(ctx);
  }

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

  @Get('corrections')
  @RequirePermissions('attendance:correct')
  corrections(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('userId') userId?: string,
  ) {
    return this.attendance.corrections({ from, to, userId });
  }

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

  @Post('check-in')
  @RequirePermissions('attendance:checkin')
  checkIn(@Auth() ctx: AuthContext, @Body() dto: CheckInDto) {
    return this.attendance.checkIn(ctx, dto);
  }

  @Post('check-out')
  @RequirePermissions('attendance:checkout')
  checkOut(@Auth() ctx: AuthContext, @Body() dto: CheckOutDto) {
    return this.attendance.checkOut(ctx, dto);
  }

  @Post('status')
  @RequirePermissions('attendance:checkin')
  setStatus(@Auth() ctx: AuthContext, @Body() dto: SetAttendanceStatusDto) {
    return this.attendance.setStatus(ctx, dto);
  }

  @Post(':id/correct')
  @RequirePermissions('attendance:correct')
  correct(@Auth() ctx: AuthContext, @Param('id') id: string, @Body() dto: CorrectAttendanceDto) {
    return this.attendance.correct(ctx, id, dto);
  }
}
