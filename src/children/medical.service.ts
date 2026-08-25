import { Injectable } from '@nestjs/common';
import { TenantPrisma } from '../prisma/tenant-prisma.provider';
import { AuditService } from '../audit/audit.service';
import { AuthContext } from '../common/auth-context';
import { UpdateMedicalDto } from './dto/update-medical.dto';

@Injectable()
export class MedicalService {
  constructor(
    private readonly tenantPrisma: TenantPrisma,
    private readonly audit: AuditService,
  ) {}

  /**
   * Read access to health data is itself an auditable event — "who looked
   * at this child's record" (ops-reference §1, `medical.read`). Unlike
   * plain check-ins, this is deliberately logged on every read, not just
   * writes.
   */
  async get(ctx: AuthContext, childId: string) {
    const [record, allergies, medications] = await Promise.all([
      this.tenantPrisma.db.medicalRecord.findUnique({ where: { childId } }),
      this.tenantPrisma.db.allergy.findMany({ where: { childId, deletedAt: null } }),
      this.tenantPrisma.db.medication.findMany({ where: { childId, deletedAt: null } }),
    ]);

    await this.audit.log({
      userId: ctx.userId,
      action: 'medical.read',
      entityType: 'child',
      entityId: childId,
    });

    return { record, allergies, medications };
  }

  async alerts(childId: string) {
    const allergies = await this.tenantPrisma.db.allergy.findMany({
      where: { childId, deletedAt: null },
      select: { allergen: true, severity: true, instruction: true },
    });
    const record = await this.tenantPrisma.db.medicalRecord.findUnique({
      where: { childId },
      select: { emergencyInstructions: true },
    });
    return {
      allergies,
      emergencyInstructions: record?.emergencyInstructions ?? null,
    };
  }

  async update(ctx: AuthContext, childId: string, dto: UpdateMedicalDto) {
    await this.tenantPrisma.db.$transaction(async (tx) => {
      await tx.medicalRecord.upsert({
        where: { childId },
        create: {
          tenantId: this.tenantPrisma.tenantId,
          childId,
          bloodType: dto.bloodType,
          chronicConditions: dto.chronicConditions,
          emergencyInstructions: dto.emergencyInstructions,
          doctorName: dto.doctorName,
          doctorPhone: dto.doctorPhone,
          clinic: dto.clinic,
          note: dto.note,
          updatedBy: ctx.userId,
        },
        update: {
          bloodType: dto.bloodType,
          chronicConditions: dto.chronicConditions,
          emergencyInstructions: dto.emergencyInstructions,
          doctorName: dto.doctorName,
          doctorPhone: dto.doctorPhone,
          clinic: dto.clinic,
          note: dto.note,
          updatedBy: ctx.userId,
        },
      });

      if (dto.allergies) {
        await tx.allergy.deleteMany({ where: { childId } });
        if (dto.allergies.length > 0) {
          await tx.allergy.createMany({
            data: dto.allergies.map((a) => ({
              tenantId: this.tenantPrisma.tenantId,
              childId,
              allergen: a.allergen,
              severity: a.severity ?? 'moderate',
              reaction: a.reaction,
              instruction: a.instruction,
              createdBy: ctx.userId,
            })),
          });
        }
      }

      if (dto.medications) {
        await tx.medication.deleteMany({ where: { childId } });
        if (dto.medications.length > 0) {
          await tx.medication.createMany({
            data: dto.medications.map((m) => ({
              tenantId: this.tenantPrisma.tenantId,
              childId,
              name: m.name,
              dosage: m.dosage,
              schedule: m.schedule,
              validFrom: m.validFrom ? new Date(m.validFrom) : null,
              validTo: m.validTo ? new Date(m.validTo) : null,
              prescribedBy: m.prescribedBy,
              createdBy: ctx.userId,
            })),
          });
        }
      }
    });

    await this.audit.log({
      userId: ctx.userId,
      action: 'medical.update',
      entityType: 'child',
      entityId: childId,
    });

    return this.get(ctx, childId);
  }
}
