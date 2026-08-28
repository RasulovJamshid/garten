import { Injectable, Logger } from '@nestjs/common';
import { TenantPrisma } from '../prisma/tenant-prisma.provider';
import { AuditService } from '../audit/audit.service';
import { AppErrors } from '../common/exceptions/app.exception';
import { AuthContext } from '../common/auth-context';
import { todayInTashkent, currentTimeInTashkent } from '../common/tashkent-date';
import { NotificationsService } from '../notifications/notifications.service';
import { CheckInDto } from './dto/check-in.dto';
import { CheckOutDto } from './dto/check-out.dto';
import { SetAttendanceStatusDto } from './dto/set-attendance-status.dto';
import { CorrectAttendanceDto } from './dto/correct-attendance.dto';

const NON_BILLABLE_STATUSES = new Set(['absent', 'sick', 'vacation', 'excused']);

function hhmm(at: Date): string {
  const { hour, minute } = currentTimeInTashkent(at);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * `attendance_date` is a Postgres DATE column, but Prisma's client
 * validator for `@db.Date` fields rejects a bare "YYYY-MM-DD" string as a
 * filter/write value — it wants a `Date` object (or full ISO datetime).
 * Every date-only string that reaches attendanceDate must go through this.
 */
function dateOnly(isoDate: string): Date {
  return new Date(isoDate);
}

@Injectable()
export class AttendanceService {
  private readonly logger = new Logger(AttendanceService.name);

  constructor(
    private readonly tenantPrisma: TenantPrisma,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Best-effort: a template misconfiguration or a transient DB hiccup on
   * the notification insert must never fail the attendance action itself
   * (§4 "Never send inside the request that triggered it" — the same
   * spirit applies to not letting the *queueing* step become a hard
   * dependency of check-in/check-out).
   */
  private async notifyGuardians(
    childId: string,
    templateKey: string,
    data: Record<string, string>,
    entityId: string,
  ): Promise<void> {
    try {
      const links = await this.tenantPrisma.db.childGuardian.findMany({
        where: { childId },
        select: { guardianId: true },
      });
      if (links.length === 0) return;
      await this.notifications.send({
        templateKey,
        recipients: links.map((l) => ({ guardianId: l.guardianId })),
        channel: 'telegram',
        data,
        entityId,
      });
    } catch (e) {
      this.logger.warn(`notifyGuardians(${templateKey}) failed: ${(e as Error).message}`);
    }
  }

  private scopedWhere(ctx: AuthContext, date?: string): Record<string, unknown> {
    const scope = ctx.scopeFor('attendance:read');
    if (!scope) throw AppErrors.forbidden("Missing permission: 'attendance:read'");

    switch (scope) {
      case 'all':
        return {};
      case 'branch':
        return { branchId: { in: ctx.branchIds } };
      case 'own_group':
        return { groupId: { in: ctx.ownGroupIds } };
      case 'today':
        return { attendanceDate: dateOnly(date ?? todayInTashkent()) };
      default:
        throw AppErrors.invalidScope(`Unsupported scope '${scope}' for attendance:read`);
    }
  }

  private childSelect = {
    select: { id: true, firstName: true, lastName: true },
  } as const;

  async today(ctx: AuthContext, groupId?: string, branchId?: string) {
    const date = todayInTashkent();
    const where: Record<string, unknown> = {
      ...this.scopedWhere(ctx, date),
      attendanceDate: dateOnly(date),
    };
    if (groupId) where.groupId = groupId;
    if (branchId) where.branchId = branchId;
    return this.tenantPrisma.db.attendanceDay.findMany({
      where,
      include: { child: this.childSelect },
      orderBy: { checkInAt: 'asc' },
    });
  }

  async list(
    ctx: AuthContext,
    filters: {
      date?: string;
      groupId?: string;
      childId?: string;
      from?: string;
      to?: string;
      status?: string;
    },
  ) {
    const where: Record<string, unknown> = { ...this.scopedWhere(ctx, filters.date) };
    if (filters.date) where.attendanceDate = dateOnly(filters.date);
    if (filters.groupId) where.groupId = filters.groupId;
    if (filters.childId) where.childId = filters.childId;
    if (filters.status) where.status = filters.status;
    if (filters.from || filters.to) {
      where.attendanceDate = {
        ...(filters.from && { gte: dateOnly(filters.from) }),
        ...(filters.to && { lte: dateOnly(filters.to) }),
      };
    }
    return this.tenantPrisma.db.attendanceDay.findMany({
      where,
      include: { child: this.childSelect },
      orderBy: { attendanceDate: 'desc' },
      take: 500,
    });
  }

  /** "Currently inside" = checked in, not checked out, today. */
  async inside(ctx: AuthContext) {
    const date = todayInTashkent();
    const where: Record<string, unknown> = {
      ...this.scopedWhere(ctx, date),
      attendanceDate: dateOnly(date),
      checkInAt: { not: null },
      checkOutAt: null,
    };
    return this.tenantPrisma.db.attendanceDay.findMany({
      where,
      include: { child: this.childSelect },
      orderBy: { checkInAt: 'asc' },
    });
  }

  async absent(ctx: AuthContext, date?: string) {
    const d = date ?? todayInTashkent();
    const where: Record<string, unknown> = {
      ...this.scopedWhere(ctx, d),
      attendanceDate: dateOnly(d),
      status: { in: ['absent', 'sick', 'vacation', 'excused'] },
    };
    return this.tenantPrisma.db.attendanceDay.findMany({
      where,
      include: { child: this.childSelect },
    });
  }

  async notPickedUp(ctx: AuthContext) {
    const date = todayInTashkent();
    const setting = await this.tenantPrisma.db.setting.findUnique({
      where: { tenantId: ctx.tenantId },
    });
    const closeTime = (setting?.workingHours as { close?: string } | null)?.close ?? '19:00';
    const [closeHour, closeMinute] = closeTime.split(':').map(Number);

    const { hour, minute } = currentTimeInTashkent();
    const pastClosing = hour > closeHour || (hour === closeHour && minute >= closeMinute);
    if (!pastClosing) return [];

    const where: Record<string, unknown> = {
      ...this.scopedWhere(ctx, date),
      attendanceDate: dateOnly(date),
      checkInAt: { not: null },
      checkOutAt: null,
    };
    return this.tenantPrisma.db.attendanceDay.findMany({
      where,
      include: { child: this.childSelect },
    });
  }

  async calendar(ctx: AuthContext, childId: string, year: number, month: number) {
    const from = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const to = `${year}-${String(month).padStart(2, '0')}-${lastDay}`;
    const where: Record<string, unknown> = {
      ...this.scopedWhere(ctx),
      childId,
      attendanceDate: { gte: dateOnly(from), lte: dateOnly(to) },
    };
    return this.tenantPrisma.db.attendanceDay.findMany({
      where,
      orderBy: { attendanceDate: 'asc' },
    });
  }

  async summary(ctx: AuthContext, groupId: string | undefined, from: string, to: string) {
    const where: Record<string, unknown> = {
      ...this.scopedWhere(ctx),
      attendanceDate: { gte: dateOnly(from), lte: dateOnly(to) },
    };
    if (groupId) where.groupId = groupId;

    const rows = await this.tenantPrisma.db.attendanceDay.findMany({
      where,
      select: { childId: true, status: true, child: this.childSelect },
    });

    const byChild = new Map<
      string,
      { child: unknown; present: number; absent: number; other: number }
    >();
    for (const row of rows) {
      if (!byChild.has(row.childId)) {
        byChild.set(row.childId, { child: row.child, present: 0, absent: 0, other: 0 });
      }
      const entry = byChild.get(row.childId)!;
      if (row.status === 'present' || row.status === 'late' || row.status === 'early_departure')
        entry.present++;
      else if (row.status === 'absent') entry.absent++;
      else entry.other++;
    }
    return [...byChild.values()];
  }

  async checkIn(ctx: AuthContext, dto: CheckInDto) {
    const child = await this.tenantPrisma.db.child.findUnique({ where: { id: dto.childId } });
    if (!child) throw AppErrors.notFound('Child not found');

    const at = dto.at ? new Date(dto.at) : new Date();
    const attendanceDate = dateOnly(todayInTashkent(at));

    const existing = await this.tenantPrisma.db.attendanceDay.findUnique({
      where: {
        tenantId_childId_attendanceDate: {
          tenantId: ctx.tenantId,
          childId: dto.childId,
          attendanceDate,
        },
      },
    });
    if (existing) throw AppErrors.conflict('ALREADY_CHECKED_IN');

    const currentGroup = await this.tenantPrisma.db.groupAssignment.findFirst({
      where: { childId: dto.childId, effectiveTo: null },
    });

    const row = await this.tenantPrisma.db.attendanceDay.create({
      data: {
        tenantId: ctx.tenantId,
        branchId: child.branchId,
        childId: dto.childId,
        groupId: currentGroup?.groupId,
        attendanceDate,
        status: 'present',
        checkInAt: at,
        checkInBy: ctx.userId,
        checkInNote: dto.note,
        healthObservation: dto.healthObservation,
      },
    });

    // Check-in triggers a parent notification asynchronously (pg-boss),
    // never blocking this response (api-spec §7, §363).
    void this.notifyGuardians(
      dto.childId,
      'child_arrived',
      { child: `${child.firstName} ${child.lastName}`, time: hhmm(at) },
      row.id,
    );

    return row;
  }

  async checkOut(ctx: AuthContext, dto: CheckOutDto) {
    // Must derive attendanceDate from dto.at, the same way checkIn does —
    // using today's date unconditionally here means a backdated checkout
    // (dto.at set to an earlier day, e.g. entering a forgotten checkout
    // the next morning) can never find the row checkIn created under that
    // earlier date, and fails with a confusing NOT_CHECKED_IN even though
    // the child genuinely was checked in.
    const at = dto.at ? new Date(dto.at) : new Date();
    const attendanceDate = dateOnly(todayInTashkent(at));
    const row = await this.tenantPrisma.db.attendanceDay.findUnique({
      where: {
        tenantId_childId_attendanceDate: {
          tenantId: ctx.tenantId,
          childId: dto.childId,
          attendanceDate,
        },
      },
    });
    if (!row || !row.checkInAt) throw AppErrors.conflict('NOT_CHECKED_IN');
    if (row.checkOutAt) throw AppErrors.conflict('NOT_CHECKED_IN'); // already checked out today

    const updated = await this.tenantPrisma.db.attendanceDay.update({
      where: { id: row.id },
      data: {
        checkOutAt: at,
        checkOutBy: ctx.userId,
        checkOutNote: dto.note,
        pickupPersonId: dto.pickupPersonId,
      },
    });

    const [child, pickupPerson] = await Promise.all([
      this.tenantPrisma.db.child.findUnique({
        where: { id: dto.childId },
        select: { firstName: true, lastName: true },
      }),
      dto.pickupPersonId
        ? this.tenantPrisma.db.pickupPerson.findUnique({
            where: { id: dto.pickupPersonId },
            select: { fullName: true },
          })
        : Promise.resolve(null),
    ]);

    // Check-out triggers a parent notification asynchronously (pg-boss),
    // never blocking this response (api-spec §7, §363).
    if (child) {
      void this.notifyGuardians(
        dto.childId,
        'child_departed',
        {
          child: `${child.firstName} ${child.lastName}`,
          pickup: pickupPerson?.fullName ?? '—',
          time: hhmm(at),
        },
        updated.id,
      );
    }

    return updated;
  }

  async setStatus(ctx: AuthContext, dto: SetAttendanceStatusDto) {
    const child = await this.tenantPrisma.db.child.findUnique({ where: { id: dto.childId } });
    if (!child) throw AppErrors.notFound('Child not found');

    const currentGroup = await this.tenantPrisma.db.groupAssignment.findFirst({
      where: { childId: dto.childId, effectiveTo: null },
    });

    const row = await this.tenantPrisma.db.attendanceDay.upsert({
      where: {
        tenantId_childId_attendanceDate: {
          tenantId: ctx.tenantId,
          childId: dto.childId,
          attendanceDate: dateOnly(dto.date),
        },
      },
      create: {
        tenantId: ctx.tenantId,
        branchId: child.branchId,
        childId: dto.childId,
        groupId: currentGroup?.groupId,
        attendanceDate: dateOnly(dto.date),
        status: dto.status,
        billable: !NON_BILLABLE_STATUSES.has(dto.status),
        checkInNote: dto.note,
      },
      update: {
        status: dto.status,
        billable: !NON_BILLABLE_STATUSES.has(dto.status),
        checkInNote: dto.note,
      },
    });

    return row;
  }

  async correct(ctx: AuthContext, id: string, dto: CorrectAttendanceDto) {
    const row = await this.tenantPrisma.db.attendanceDay.findUnique({ where: { id } });
    if (!row) throw AppErrors.notFound('Attendance record not found');

    const oldValue = String((row as Record<string, unknown>)[dto.field] ?? '');
    const data: Record<string, unknown> = {};
    if (dto.field === 'checkInAt' || dto.field === 'checkOutAt') {
      data[dto.field] = new Date(dto.newValue);
    } else {
      data[dto.field] = dto.newValue;
    }

    await this.tenantPrisma.db.$transaction([
      this.tenantPrisma.db.attendanceDay.update({ where: { id }, data }),
      this.tenantPrisma.db.attendanceCorrection.create({
        data: {
          tenantId: ctx.tenantId,
          attendanceDayId: id,
          field: dto.field,
          oldValue,
          newValue: dto.newValue,
          reason: dto.reason,
          correctedBy: ctx.userId,
        },
      }),
    ]);

    await this.audit.log({
      userId: ctx.userId,
      action: 'attendance.correct',
      entityType: 'attendance_day',
      entityId: id,
      oldValue: { [dto.field]: oldValue },
      newValue: { [dto.field]: dto.newValue, reason: dto.reason },
    });

    return this.tenantPrisma.db.attendanceDay.findUnique({ where: { id } });
  }

  async corrections(filters: { from?: string; to?: string; userId?: string }) {
    const where: Record<string, unknown> = {};
    if (filters.userId) where.correctedBy = filters.userId;
    if (filters.from || filters.to) {
      where.correctedAt = {
        ...(filters.from && { gte: new Date(filters.from) }),
        ...(filters.to && { lte: new Date(filters.to) }),
      };
    }
    return this.tenantPrisma.db.attendanceCorrection.findMany({
      where,
      // A correction with no visible child/date is unreadable to whoever
      // is reviewing it — include the parent attendance_day row rather
      // than making every caller do a second lookup.
      include: {
        attendanceDay: { select: { attendanceDate: true, child: this.childSelect } },
      },
      orderBy: { correctedAt: 'desc' },
      take: 200,
    });
  }
}
