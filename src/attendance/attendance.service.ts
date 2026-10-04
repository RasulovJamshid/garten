import { Injectable, Logger } from '@nestjs/common';
import { TenantPrisma } from '../prisma/tenant-prisma.provider';
import { AuditService } from '../audit/audit.service';
import { AppErrors } from '../common/exceptions/app.exception';
import { AuthContext } from '../common/auth-context';
import { andWhere } from '../common/prisma-where';
import { todayInTashkent, currentTimeInTashkent } from '../common/tashkent-date';
import { NotificationsService } from '../notifications/notifications.service';
import { RecalculateBillingService } from '../billing/recalculate-billing.service';
import { effectiveOn, timestampRange } from '../common/tashkent-date';
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
    private readonly billing: RecalculateBillingService,
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

  private scopedWhere(ctx: AuthContext): Record<string, unknown> {
    const scope = ctx.scopeFor('attendance:read');
    if (!scope) throw AppErrors.forbidden("Missing permission: 'attendance:read'");

    switch (scope) {
      case 'all':
        return {};
      case 'branch':
        return { branchId: { in: ctx.requireBranchIds('attendance:read') } };
      case 'own_group':
        return {
          groupId: { in: ctx.requireOwnGroupIds() },
          branchId: { in: ctx.requireBranchIds('attendance:read') },
        };
      case 'today':
        return {
          attendanceDate: dateOnly(todayInTashkent()),
          branchId: { in: ctx.requireBranchIds('attendance:read') },
        };
      default:
        throw AppErrors.invalidScope(`Unsupported scope '${scope}' for attendance:read`);
    }
  }

  private childSelect = {
    select: { id: true, firstName: true, lastName: true },
  } as const;

  async board(ctx: AuthContext, groupId?: string, branchId?: string) {
    const date = todayInTashkent();
    const children = await this.tenantPrisma.db.child.findMany({
      where: {
        AND: [
          {
            deletedAt: null,
            status: 'active',
            ...(branchId ? { branchId } : {}),
            ...(groupId ? { groupAssignment: { some: { groupId, ...effectiveOn(date) } } } : {}),
          },
          this.tenantPrisma.childWhere('attendance:read', date),
        ],
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        branchId: true,
        photoFileId: true,
        groupAssignment: {
          where: effectiveOn(date),
          select: { groupId: true, childGroup: { select: { name: true } } },
        },
      },
      orderBy: [{ lastName: 'asc' }, { id: 'asc' }],
    });
    const rows = await this.today(ctx, groupId, branchId);
    const attendance = new Map(rows.map((row) => [row.childId, row]));
    return {
      date,
      data: children.map((child) => ({
        child,
        attendance: attendance.get(child.id) ?? null,
        recorded: attendance.has(child.id),
      })),
    };
  }

  async today(ctx: AuthContext, groupId?: string, branchId?: string) {
    const date = todayInTashkent();
    // andWhere, not assignment: `groupId`/`branchId` collide head-on with
    // the own_group/branch scope clauses (prisma-where.ts).
    let where: Record<string, unknown> = { attendanceDate: dateOnly(date) };
    where = andWhere(where, this.scopedWhere(ctx));
    if (groupId) where = andWhere(where, { groupId });
    if (branchId) where = andWhere(where, { branchId });
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
    let where: Record<string, unknown> = {};
    where = andWhere(where, this.scopedWhere(ctx));
    if (filters.date) where = andWhere(where, { attendanceDate: dateOnly(filters.date) });
    if (filters.groupId) where = andWhere(where, { groupId: filters.groupId });
    if (filters.childId) where = andWhere(where, { childId: filters.childId });
    if (filters.status) where = andWhere(where, { status: filters.status });
    if (filters.from || filters.to) {
      where = andWhere(where, {
        attendanceDate: {
          ...(filters.from && { gte: dateOnly(filters.from) }),
          ...(filters.to && { lte: dateOnly(filters.to) }),
        },
      });
    }
    return this.tenantPrisma.db.attendanceDay.findMany({
      where,
      include: { child: this.childSelect },
      orderBy: { attendanceDate: 'desc' },
    });
  }

  /** "Currently inside" = checked in, not checked out, today. */
  async inside(ctx: AuthContext) {
    const date = todayInTashkent();
    const where = andWhere(
      { attendanceDate: dateOnly(date), checkInAt: { not: null }, checkOutAt: null },
      this.scopedWhere(ctx),
    );
    return this.tenantPrisma.db.attendanceDay.findMany({
      where,
      include: { child: this.childSelect },
      orderBy: { checkInAt: 'asc' },
    });
  }

  async absent(ctx: AuthContext, date?: string) {
    const d = date ?? todayInTashkent();
    const where = andWhere(
      { attendanceDate: dateOnly(d), status: { in: ['absent', 'sick', 'vacation', 'excused'] } },
      this.scopedWhere(ctx),
    );
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

    const where = andWhere(
      { attendanceDate: dateOnly(date), checkInAt: { not: null }, checkOutAt: null },
      this.scopedWhere(ctx),
    );
    return this.tenantPrisma.db.attendanceDay.findMany({
      where,
      include: { child: this.childSelect },
    });
  }

  async calendar(ctx: AuthContext, childId: string, year: number, month: number) {
    const from = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const to = `${year}-${String(month).padStart(2, '0')}-${lastDay}`;
    const where = andWhere(
      { childId, attendanceDate: { gte: dateOnly(from), lte: dateOnly(to) } },
      this.scopedWhere(ctx),
    );
    return this.tenantPrisma.db.attendanceDay.findMany({
      where,
      include: { child: this.childSelect },
      orderBy: { attendanceDate: 'asc' },
    });
  }

  async summary(ctx: AuthContext, groupId: string | undefined, from: string, to: string) {
    let where = andWhere(
      { attendanceDate: { gte: dateOnly(from), lte: dateOnly(to) } },
      this.scopedWhere(ctx),
    );
    if (groupId) where = andWhere(where, { groupId });

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

  private assertOperationalDate(ctx: AuthContext, date: string) {
    if (date !== todayInTashkent())
      throw AppErrors.conflict(
        'USE_ATTENDANCE_CORRECTION: operational attendance must be recorded today',
      );
  }

  private async authorizedPickup(
    tx: any,
    childId: string,
    at: Date,
    personId?: string,
    permissionId?: string,
    guardianId?: string,
  ) {
    if (guardianId) {
      if (personId || permissionId)
        throw AppErrors.validationFailed('Choose either a guardian or an authorized pickup person');
      const link = await tx.childGuardian.findFirst({
        where: { childId, guardianId, guardian: { deletedAt: null } },
        include: { guardian: true },
      });
      if (!link) throw AppErrors.conflict('PICKUP_NOT_AUTHORIZED');
      return {
        id: null,
        pickupPersonId: null,
        pickupGuardianId: guardianId,
        pickupPerson: null,
        adhocFullName: link.guardian.fullName,
      };
    }
    if (!personId && !permissionId) throw AppErrors.conflict('PICKUP_AUTHORIZATION_REQUIRED');
    const date = dateOnly(todayInTashkent(at));
    const permission = await tx.pickupPermission.findFirst({
      where: {
        childId,
        ...(permissionId ? { id: permissionId } : {}),
        ...(personId ? { pickupPersonId: personId } : {}),
        revokedAt: null,
        validFrom: { lte: date },
        OR: [{ validTo: null }, { validTo: { gte: date } }],
      },
      include: { pickupPerson: true },
      orderBy: { createdAt: 'desc' },
    });
    if (
      !permission ||
      permission.pickupPerson?.revokedAt ||
      (permission.pickupPerson && permission.pickupPerson.childId !== childId)
    ) {
      throw AppErrors.conflict('PICKUP_NOT_AUTHORIZED');
    }
    return permission;
  }

  async checkIn(ctx: AuthContext, dto: CheckInDto) {
    const at = dto.at ? new Date(dto.at) : new Date();
    const date = todayInTashkent(at);
    this.assertOperationalDate(ctx, date);
    const child = await this.tenantPrisma.assertChild(
      dto.childId,
      'attendance:checkin',
      undefined,
      date,
    );
    if (
      child.status !== 'active' ||
      (child.enrollmentDate && child.enrollmentDate > dateOnly(date)) ||
      (child.withdrawalDate && child.withdrawalDate < dateOnly(date))
    )
      throw AppErrors.conflict('CHILD_NOT_ACTIVE');
    const row = await this.tenantPrisma.db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM child WHERE id = ${dto.childId}::uuid AND tenant_id = ${ctx.tenantId}::uuid FOR UPDATE`;
        const existing = await tx.attendanceDay.findFirst({
          where: { childId: dto.childId, attendanceDate: dateOnly(date) },
        });
        if (existing?.checkInAt) throw AppErrors.conflict('ALREADY_CHECKED_IN');
        const active = await this.tenantPrisma.assertChild(
          dto.childId,
          'attendance:checkin',
          tx,
          date,
        );
        if (active.status !== 'active') throw AppErrors.conflict('CHILD_NOT_ACTIVE');
        const group = await tx.groupAssignment.findFirst({
          where: { childId: dto.childId, ...effectiveOn(date) },
        });
        const data = {
          tenantId: ctx.tenantId,
          branchId: child.branchId,
          childId: dto.childId,
          groupId: group?.groupId,
          attendanceDate: dateOnly(date),
          status: 'present',
          billable: true,
          checkInAt: at,
          checkInBy: ctx.userId,
          checkInNote: dto.note,
          healthObservation: dto.healthObservation,
        };
        const result = existing
          ? await tx.attendanceDay.update({
              where: { id: existing.id },
              data,
              include: { child: this.childSelect },
            })
          : await tx.attendanceDay.create({ data, include: { child: this.childSelect } });
        const resolution = await this.billing.recalculate(ctx, child.id, dateOnly(date), tx);
        if (existing || resolution.status === 'manual_required')
          await tx.attendanceCorrection.create({
            data: {
              tenantId: ctx.tenantId,
              attendanceDayId: result.id,
              field: 'status',
              oldValue: existing?.status ?? '',
              newValue: 'present',
              reason: 'Actual arrival recorded by staff',
              correctedBy: ctx.userId,
              billingResolution: resolution.status,
            },
          });
        return result;
      },
      { timeout: 60000 },
    );
    void this.notifyGuardians(
      child.id,
      'child_arrived',
      { child: child.firstName + ' ' + child.lastName, time: hhmm(at) },
      row.id,
    );
    return row;
  }

  async checkOut(ctx: AuthContext, dto: CheckOutDto) {
    const at = dto.at ? new Date(dto.at) : new Date();
    const date = todayInTashkent(at);
    this.assertOperationalDate(ctx, date);
    const child = await this.tenantPrisma.assertChild(
      dto.childId,
      'attendance:checkout',
      undefined,
      date,
    );
    const result = await this.tenantPrisma.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM child WHERE id = ${dto.childId}::uuid AND tenant_id = ${ctx.tenantId}::uuid FOR UPDATE`;
      const row = await tx.attendanceDay.findFirst({
        where: { childId: dto.childId, attendanceDate: dateOnly(date) },
      });
      if (!row?.checkInAt) throw AppErrors.conflict('NOT_CHECKED_IN');
      if (row.checkOutAt) throw AppErrors.conflict('ALREADY_CHECKED_OUT');
      if (at < row.checkInAt) throw AppErrors.validationFailed('Checkout must be after check-in');
      const permission = await this.authorizedPickup(
        tx,
        child.id,
        at,
        dto.pickupPersonId,
        dto.pickupPermissionId,
        dto.guardianId,
      );
      const updated = await tx.attendanceDay.update({
        where: { id: row.id },
        data: {
          checkOutAt: at,
          checkOutBy: ctx.userId,
          checkOutNote: dto.note,
          pickupPersonId: permission.pickupPersonId,
          pickupPermissionId: permission.id,
          pickupGuardianId: permission.pickupGuardianId ?? null,
        },
        include: { child: this.childSelect },
      });
      return {
        updated,
        pickup: permission.pickupPerson?.fullName ?? permission.adhocFullName ?? '',
      };
    });
    void this.notifyGuardians(
      child.id,
      'child_departed',
      { child: child.firstName + ' ' + child.lastName, pickup: result.pickup, time: hhmm(at) },
      result.updated.id,
    );
    return result.updated;
  }

  async setStatus(ctx: AuthContext, dto: SetAttendanceStatusDto) {
    const date = dto.date.slice(0, 10);
    if (date > todayInTashkent())
      throw AppErrors.validationFailed('Future attendance is not supported');
    const permission = date === todayInTashkent() ? 'attendance:checkin' : 'attendance:correct';
    const child = await this.tenantPrisma.assertChild(dto.childId, permission, undefined, date);
    const existing = await this.tenantPrisma.db.attendanceDay.findFirst({
      where: { childId: dto.childId, attendanceDate: dateOnly(date) },
    });
    if (existing)
      return this.correct(ctx, existing.id, {
        field: 'status',
        newValue: dto.status,
        reason: dto.reason ?? '',
      });
    if (date !== todayInTashkent() && (dto.reason?.trim().length ?? 0) < 10)
      throw AppErrors.validationFailed(
        'Historical attendance requires a reason of at least 10 characters',
      );
    return this.tenantPrisma.db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM child WHERE id = ${child.id}::uuid AND tenant_id = ${ctx.tenantId}::uuid FOR UPDATE`;
        const group = await tx.groupAssignment.findFirst({
          where: { childId: child.id, ...effectiveOn(date) },
        });
        const row = await tx.attendanceDay.create({
          data: {
            tenantId: ctx.tenantId,
            childId: child.id,
            branchId: child.branchId,
            groupId: group?.groupId,
            attendanceDate: dateOnly(date),
            status: dto.status,
            billable: false,
            checkInNote: dto.note,
          },
          include: { child: this.childSelect },
        });
        const resolution = await this.billing.recalculate(ctx, child.id, dateOnly(date), tx);
        if (date !== todayInTashkent() || resolution.status === 'manual_required')
          await tx.attendanceCorrection.create({
            data: {
              tenantId: ctx.tenantId,
              attendanceDayId: row.id,
              field: 'status',
              oldValue: '',
              newValue: dto.status,
              reason: dto.reason ?? 'Attendance added after billing',
              correctedBy: ctx.userId,
              billingResolution: resolution.status,
            },
          });
        await this.audit.log(
          {
            userId: ctx.userId,
            action: 'attendance.status',
            entityType: 'attendance_day',
            entityId: row.id,
            newValue: { status: dto.status, reason: dto.reason },
          },
          tx,
        );
        return row;
      },
      { timeout: 60000 },
    );
  }

  async correct(ctx: AuthContext, id: string, dto: CorrectAttendanceDto) {
    if (dto.reason.trim().length < 10)
      throw AppErrors.validationFailed('Correction reason must contain at least 10 characters');
    const initial = await this.tenantPrisma.db.attendanceDay.findUnique({ where: { id } });
    if (!initial) throw AppErrors.notFound('Attendance record not found');
    await this.tenantPrisma.assertChild(
      initial.childId,
      'attendance:correct',
      undefined,
      initial.attendanceDate.toISOString().slice(0, 10),
    );
    return this.tenantPrisma.db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM child WHERE id = ${initial.childId}::uuid AND tenant_id = ${ctx.tenantId}::uuid FOR UPDATE`;
        const row = (await tx.attendanceDay.findUnique({ where: { id } }))!;
        const data: Record<string, any> = {};
        if (dto.field === 'status') {
          if (
            !['present', 'late', 'early_departure', ...NON_BILLABLE_STATUSES].includes(dto.newValue)
          )
            throw AppErrors.validationFailed('Invalid attendance status');
          data.status = dto.newValue;
          data.billable = !NON_BILLABLE_STATUSES.has(dto.newValue);
          if (!data.billable && row.checkInAt)
            throw AppErrors.conflict(
              'ATTENDANCE_HAS_CHECK_IN: clear check-in and checkout before marking non-attendance',
            );
        } else if (dto.field === 'checkInAt' || dto.field === 'checkOutAt') {
          const at = dto.newValue ? new Date(dto.newValue) : null;
          if (
            at &&
            (!Number.isFinite(at.getTime()) ||
              todayInTashkent(at) !== row.attendanceDate.toISOString().slice(0, 10))
          )
            throw AppErrors.validationFailed(
              'Timestamp must belong to the attendance date in Asia/Tashkent',
            );
          data[dto.field] = at;
          const checkIn = dto.field === 'checkInAt' ? at : row.checkInAt;
          const checkOut = dto.field === 'checkOutAt' ? at : row.checkOutAt;
          if (checkOut && (!checkIn || checkOut < checkIn))
            throw AppErrors.validationFailed('Checkout requires an earlier check-in');
          if (checkIn && NON_BILLABLE_STATUSES.has(row.status)) {
            data.status = 'present';
            data.billable = true;
          }
          if (dto.field === 'checkOutAt' && at)
            await this.authorizedPickup(
              tx,
              row.childId,
              at,
              row.pickupPersonId ?? undefined,
              row.pickupPermissionId ?? undefined,
              row.pickupGuardianId ?? undefined,
            );
        } else {
          const permission = await this.authorizedPickup(
            tx,
            row.childId,
            row.checkOutAt ?? new Date(row.attendanceDate.getTime() + 36000000),
            dto.newValue,
          );
          data.pickupPersonId = permission.pickupPersonId;
          data.pickupPermissionId = permission.id;
          data.pickupGuardianId = null;
        }
        const updated = await tx.attendanceDay.update({
          where: { id },
          data,
          include: { child: this.childSelect },
        });
        const resolution = await this.billing.recalculate(ctx, row.childId, row.attendanceDate, tx);
        const oldValue = String((row as any)[dto.field] ?? '');
        await tx.attendanceCorrection.create({
          data: {
            tenantId: ctx.tenantId,
            attendanceDayId: id,
            field: dto.field,
            oldValue,
            newValue: dto.newValue,
            reason: dto.reason,
            correctedBy: ctx.userId,
            billingResolution: resolution.status,
          },
        });
        await this.audit.log(
          {
            userId: ctx.userId,
            action: 'attendance.correct',
            entityType: 'attendance_day',
            entityId: id,
            oldValue: { [dto.field]: oldValue },
            newValue: { ...data, reason: dto.reason, billingResolution: resolution.status },
          },
          tx,
        );
        return updated;
      },
      { timeout: 60000 },
    );
  }

  async corrections(filters: { from?: string; to?: string; userId?: string }) {
    const where: Record<string, unknown> = {
      attendanceDay: { child: this.tenantPrisma.childWhere('attendance:correct') },
    };
    if (filters.userId) where.correctedBy = filters.userId;
    if (filters.from || filters.to) {
      where.correctedAt = timestampRange(filters.from, filters.to);
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
    });
  }
}
