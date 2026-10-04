import { Injectable } from '@nestjs/common';
import { TenantPrisma } from '../prisma/tenant-prisma.provider';
import { AuditService } from '../audit/audit.service';
import { AppErrors } from '../common/exceptions/app.exception';
import { AuthContext } from '../common/auth-context';
import { todayInTashkent } from '../common/tashkent-date';
import { CreatePickupPersonDto } from './dto/create-pickup-person.dto';
import { UpdatePickupPersonDto } from './dto/update-pickup-person.dto';
import { TemporaryPermissionDto } from './dto/temporary-permission.dto';

function dateOnly(isoDate: string): Date {
  return new Date(isoDate);
}

@Injectable()
export class PickupService {
  constructor(
    private readonly tenantPrisma: TenantPrisma,
    private readonly audit: AuditService,
  ) {}

  async personsOf(childId: string) {
    await this.tenantPrisma.assertChild(childId, 'pickup:read');
    return this.tenantPrisma.db.pickupPerson.findMany({
      where: { childId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Creating a pickup person also grants the accompanying permission in one call (api-spec §8). */
  async createPerson(ctx: AuthContext, childId: string, dto: CreatePickupPersonDto) {
    await this.tenantPrisma.assertChild(childId, 'pickup:manage');
    await this.assertGrant(childId, dto.grantedByGuardianId, dto.validFrom, dto.validTo);
    const child = await this.tenantPrisma.db.child.findUnique({ where: { id: childId } });
    if (!child) throw AppErrors.notFound('Child not found');

    const result = await this.tenantPrisma.db.$transaction(async (tx) => {
      const person = await tx.pickupPerson.create({
        data: {
          tenantId: this.tenantPrisma.tenantId,
          childId,
          fullName: dto.fullName,
          relationship: dto.relationship,
          phone: dto.phone,
          photoFileId: dto.photoFileId,
          idDocType: dto.idDocType,
          idDocNumber: dto.idDocNumber,
          note: dto.note,
          grantedByGuardianId: dto.grantedByGuardianId,
          createdBy: ctx.userId,
        },
      });

      const permission = await tx.pickupPermission.create({
        data: {
          tenantId: this.tenantPrisma.tenantId,
          childId,
          pickupPersonId: person.id,
          permissionType: dto.permissionType,
          validFrom: dateOnly(dto.validFrom),
          validTo: dto.validTo ? dateOnly(dto.validTo) : null,
          grantedByGuardianId: dto.grantedByGuardianId,
          createdBy: ctx.userId,
        },
      });

      return { person, permission };
    });

    await this.audit.log({
      userId: ctx.userId,
      action: 'pickup.person_add',
      entityType: 'pickup_person',
      entityId: result.person.id,
      newValue: { childId, fullName: dto.fullName, permissionType: dto.permissionType },
    });

    return result;
  }

  async updatePerson(ctx: AuthContext, id: string, dto: UpdatePickupPersonDto) {
    const person = await this.tenantPrisma.db.pickupPerson.findUnique({ where: { id } });
    if (!person) throw AppErrors.notFound('Pickup person not found');
    await this.tenantPrisma.assertChild(person.childId, 'pickup:manage');

    const updated = await this.tenantPrisma.db.pickupPerson.update({ where: { id }, data: dto });

    await this.audit.log({
      userId: ctx.userId,
      action: 'pickup.person_add',
      entityType: 'pickup_person',
      entityId: id,
      newValue: { ...dto },
    });

    return updated;
  }

  async removePerson(ctx: AuthContext, id: string) {
    return this.revokePerson(ctx, id, 'Removed by staff');
  }

  async revokePerson(ctx: AuthContext, id: string, reason: string) {
    const person = await this.tenantPrisma.db.pickupPerson.findUnique({ where: { id } });
    if (!person) throw AppErrors.notFound('Pickup person not found');
    await this.tenantPrisma.assertChild(person.childId, 'pickup:manage');

    await this.tenantPrisma.db.$transaction(async (tx) => {
      await tx.pickupPerson.update({
        where: { id },
        data: { revokedAt: new Date(), revokeReason: reason },
      });
      await tx.pickupPermission.updateMany({
        where: { pickupPersonId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });

    await this.audit.log({
      userId: ctx.userId,
      action: 'pickup.person_revoke',
      entityType: 'pickup_person',
      entityId: id,
      newValue: { reason },
    });
  }

  async activePermissions(childId: string, date?: string) {
    await this.tenantPrisma.assertChild(childId, 'pickup:read');
    const d = dateOnly(date ?? todayInTashkent());
    return this.tenantPrisma.db.pickupPermission.findMany({
      where: {
        childId,
        revokedAt: null,
        validFrom: { lte: d },
        OR: [{ validTo: null }, { validTo: { gte: d } }],
      },
      include: { pickupPerson: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createTemporary(ctx: AuthContext, dto: TemporaryPermissionDto) {
    await this.tenantPrisma.assertChild(dto.childId, 'pickup:temporary');
    await this.assertGrant(dto.childId, dto.grantedByGuardianId, dto.validFrom, dto.validTo);
    if (
      dto.pickupPersonId &&
      !(await this.tenantPrisma.db.pickupPerson.findFirst({
        where: { id: dto.pickupPersonId, childId: dto.childId, revokedAt: null },
      }))
    ) {
      throw AppErrors.notFound('Pickup person not found for this child');
    }
    if (!dto.pickupPersonId && !dto.fullName) {
      throw AppErrors.validationFailed('Either pickupPersonId or fullName (ad-hoc) is required');
    }
    const child = await this.tenantPrisma.db.child.findUnique({ where: { id: dto.childId } });
    if (!child) throw AppErrors.notFound('Child not found');

    const permission = await this.tenantPrisma.db.pickupPermission.create({
      data: {
        tenantId: this.tenantPrisma.tenantId,
        childId: dto.childId,
        pickupPersonId: dto.pickupPersonId,
        permissionType: 'temporary',
        adhocFullName: dto.pickupPersonId ? undefined : dto.fullName,
        adhocPhone: dto.pickupPersonId ? undefined : dto.phone,
        adhocIdNumber: dto.pickupPersonId ? undefined : dto.idDocNumber,
        validFrom: dateOnly(dto.validFrom),
        validTo: dateOnly(dto.validTo),
        grantedByGuardianId: dto.grantedByGuardianId,
        reason: dto.reason,
        createdBy: ctx.userId,
      },
    });

    await this.audit.log({
      userId: ctx.userId,
      action: 'pickup.temporary_grant',
      entityType: 'pickup_permission',
      entityId: permission.id,
      newValue: {
        childId: dto.childId,
        validFrom: dto.validFrom,
        validTo: dto.validTo,
        reason: dto.reason,
      },
    });

    return permission;
  }

  async history(childId: string) {
    await this.tenantPrisma.assertChild(childId, 'pickup:read');
    return this.tenantPrisma.db.pickupPermission.findMany({
      where: { childId },
      include: { pickupPerson: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * The endpoint reception hits before releasing a child (api-spec §8).
   * Checks: person linked to this child, permission not expired/revoked,
   * child currently checked in. All-or-nothing boolean, not a data leak —
   * an unauthenticated attempt learns only `allowed: false`.
   */
  async verify(
    childId: string,
    pickupPersonId?: string,
    pickupPermissionId?: string,
    guardianId?: string,
  ) {
    await this.tenantPrisma.assertChild(childId, 'pickup:read');
    if (guardianId) {
      if (pickupPersonId || pickupPermissionId)
        throw AppErrors.validationFailed('Choose either a guardian or an authorized pickup person');
      const link = await this.tenantPrisma.db.childGuardian.findFirst({
        where: { childId, guardianId, guardian: { deletedAt: null } },
        select: { guardian: { select: { id: true, fullName: true, phone: true } } },
      });
      if (!link)
        return { allowed: false, reason: 'PICKUP_NOT_AUTHORIZED', person: null, pickupName: null };
      const attendance = await this.tenantPrisma.db.attendanceDay.findFirst({
        where: { childId, attendanceDate: dateOnly(todayInTashkent()) },
      });
      const inside = Boolean(attendance?.checkInAt && !attendance.checkOutAt);
      return {
        allowed: inside,
        reason: inside ? null : 'NOT_CHECKED_IN',
        person: link.guardian,
        guardianId,
        pickupName: link.guardian.fullName,
      };
    }
    if (!pickupPersonId && !pickupPermissionId)
      throw AppErrors.validationFailed('Provide pickupPersonId or pickupPermissionId');
    const today = dateOnly(todayInTashkent());
    const permission = await this.tenantPrisma.db.pickupPermission.findFirst({
      where: {
        childId,
        ...(pickupPersonId ? { pickupPersonId } : {}),
        ...(pickupPermissionId ? { id: pickupPermissionId } : {}),
        revokedAt: null,
        validFrom: { lte: today },
        OR: [{ validTo: null }, { validTo: { gte: today } }],
      },
      include: { pickupPerson: true },
      orderBy: { createdAt: 'desc' },
    });
    const person = permission?.pickupPerson ?? null;
    if (!permission || person?.revokedAt)
      return {
        allowed: false,
        reason: 'PICKUP_NOT_AUTHORIZED',
        person: null,
        permissionId: null,
        pickupName: null,
        photoUrl: null,
        expiresAt: null,
      };
    const attendance = await this.tenantPrisma.db.attendanceDay.findFirst({
      where: { childId, attendanceDate: today },
    });
    const inside = Boolean(attendance?.checkInAt && !attendance.checkOutAt);
    return {
      allowed: inside,
      reason: inside ? null : 'NOT_CHECKED_IN',
      person,
      permissionId: permission.id,
      pickupName: person?.fullName ?? permission.adhocFullName,
      photoUrl: person?.photoFileId ? '/files/' + person.photoFileId : null,
      expiresAt: permission.validTo,
    };
  }

  private async assertGrant(
    childId: string,
    guardianId: string | undefined,
    from: string,
    to?: string,
  ) {
    if (to && new Date(to) < new Date(from))
      throw AppErrors.validationFailed('validTo must not precede validFrom');
    if (
      guardianId &&
      !(await this.tenantPrisma.db.childGuardian.findFirst({ where: { childId, guardianId } }))
    ) {
      throw AppErrors.notFound('Granting guardian is not linked to this child');
    }
  }
}
