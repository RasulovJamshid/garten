jest.mock('pg-boss', () => ({ PgBoss: class {} }));
import { AttendanceService } from './attendance.service';
import { PickupService } from '../pickup/pickup.service';
import { LookupsController } from '../lookups/lookups.controller';
import { todayInTashkent } from '../common/tashkent-date';

describe('guardian pickup authorization', () => {
  const childId = 'child-1',
    guardianId = 'guardian-1';
  function setup(link: any = { guardian: { id: guardianId, fullName: 'Parent', phone: '123' } }) {
    const db: any = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      childGuardian: {
        findFirst: jest.fn().mockResolvedValue(link),
        findMany: jest.fn().mockResolvedValue(link ? [{ ...link, relationship: 'mother' }] : []),
      },
      attendanceDay: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'day-1',
          childId,
          checkInAt: new Date(Date.now() - 60000),
          checkOutAt: null,
        }),
        update: jest.fn().mockImplementation(({ data }) => ({ id: 'day-1', childId, ...data })),
      },
      pickupPermission: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    db.$transaction = (work: any) => work(db);
    const prisma: any = {
      db,
      assertChild: jest
        .fn()
        .mockResolvedValue({ id: childId, firstName: 'Ali', lastName: 'Karimov' }),
    };
    const attendance = new AttendanceService(prisma, {} as any, {} as any, {} as any);
    jest.spyOn(attendance as any, 'notifyGuardians').mockResolvedValue(undefined);
    return { db, prisma, attendance, pickup: new PickupService(prisma, {} as any) };
  }
  const ctx: any = { userId: 'teacher', tenantId: 'tenant' };
  it('checks a linked parent without requiring a separate pickup permission and records their identity', async () => {
    const { attendance, pickup, db, prisma } = setup();
    expect(await pickup.verify(childId, undefined, undefined, guardianId)).toMatchObject({
      allowed: true,
      guardianId,
    });
    const result = await attendance.checkOut(ctx, { childId, guardianId });
    expect(result).toMatchObject({
      pickupGuardianId: guardianId,
      pickupPersonId: null,
      pickupPermissionId: null,
    });
    expect(db.pickupPermission.findFirst).not.toHaveBeenCalled();
    expect(prisma.assertChild).toHaveBeenCalledWith(
      childId,
      'attendance:checkout',
      undefined,
      todayInTashkent(),
    );
    expect(db.childGuardian.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { childId, guardianId, guardian: { deletedAt: null } } }),
    );
  });
  it('rejects an unrelated, deleted or unlinked parent during both verification and checkout', async () => {
    const { attendance, pickup, db } = setup(null);
    expect(await pickup.verify(childId, undefined, undefined, guardianId)).toMatchObject({
      allowed: false,
    });
    await expect(attendance.checkOut(ctx, { childId, guardianId })).rejects.toThrow();
    expect(db.attendanceDay.update).not.toHaveBeenCalled();
  });
  it('rechecks the link after verification and rejects removal before checkout', async () => {
    const { attendance, pickup, db } = setup();
    expect((await pickup.verify(childId, undefined, undefined, guardianId)).allowed).toBe(true);
    db.childGuardian.findFirst.mockResolvedValue(null);
    await expect(attendance.checkOut(ctx, { childId, guardianId })).rejects.toThrow();
    expect(db.attendanceDay.update).not.toHaveBeenCalled();
  });
  it('rejects ambiguous recipient types, missing authorization and already collected children', async () => {
    const { attendance, pickup, db } = setup();
    await expect(
      attendance.checkOut(ctx, { childId, guardianId, pickupPersonId: 'person' }),
    ).rejects.toThrow();
    await expect(pickup.verify(childId, undefined, 'permission', guardianId)).rejects.toThrow();
    await expect(attendance.checkOut(ctx, { childId })).rejects.toThrow();
    db.attendanceDay.findFirst.mockResolvedValue({ checkInAt: new Date(), checkOutAt: new Date() });
    expect((await pickup.verify(childId, undefined, undefined, guardianId)).allowed).toBe(false);
    await expect(attendance.checkOut(ctx, { childId, guardianId })).rejects.toThrow();
    expect(db.attendanceDay.update).not.toHaveBeenCalled();
  });
  it('restricts guardian lookup to the child and selected pickup permission scope', async () => {
    const { prisma, db } = setup();
    const controller = new LookupsController(prisma);
    expect(
      await controller.pickupGuardians(childId, { permission: 'pickup:manage' } as any),
    ).toEqual([{ id: guardianId, fullName: 'Parent', phone: '123', relationship: 'mother' }]);
    expect(prisma.assertChild).toHaveBeenCalledWith(childId, 'pickup:manage');
    expect(db.childGuardian.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { childId, guardian: { deletedAt: null } } }),
    );
    await expect(
      controller.pickupGuardians(childId, { permission: 'child:read' } as any),
    ).rejects.toThrow();
    prisma.assertChild.mockRejectedValue(new Error('out of scope'));
    db.childGuardian.findMany.mockClear();
    await expect(
      controller.pickupGuardians(childId, { permission: 'pickup:read' } as any),
    ).rejects.toThrow();
    expect(db.childGuardian.findMany).not.toHaveBeenCalled();
  });
});
