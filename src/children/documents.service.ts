import { Injectable } from '@nestjs/common';
import { TenantPrisma } from '../prisma/tenant-prisma.provider';
import { AuditService } from '../audit/audit.service';
import { AppErrors } from '../common/exceptions/app.exception';
import { AuthContext } from '../common/auth-context';
import { CreateChildDocumentDto, UpdateChildDocumentDto } from './dto/child-document.dto';

@Injectable()
export class DocumentsService {
  constructor(
    private readonly tenantPrisma: TenantPrisma,
    private readonly audit: AuditService,
  ) {}

  list(childId: string) {
    return this.tenantPrisma.db.childDocument.findMany({
      where: { childId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(ctx: AuthContext, childId: string, dto: CreateChildDocumentDto) {
    const doc = await this.tenantPrisma.db.childDocument.create({
      data: {
        tenantId: this.tenantPrisma.tenantId,
        childId,
        docType: dto.type,
        number: dto.number,
        issueDate: dto.issueDate ? new Date(dto.issueDate) : null,
        expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null,
        fileId: dto.fileId,
        note: dto.note,
        createdBy: ctx.userId,
      },
    });
    await this.audit.log({
      userId: ctx.userId,
      action: 'child.update',
      entityType: 'child_document',
      entityId: doc.id,
      newValue: { docType: doc.docType, childId },
    });
    return doc;
  }

  async update(ctx: AuthContext, childId: string, docId: string, dto: UpdateChildDocumentDto) {
    const doc = await this.tenantPrisma.db.childDocument.findFirst({
      where: { id: docId, childId },
    });
    if (!doc) throw AppErrors.notFound('Document not found');

    const updated = await this.tenantPrisma.db.childDocument.update({
      where: { id: docId },
      data: {
        number: dto.number,
        issueDate: dto.issueDate ? new Date(dto.issueDate) : undefined,
        expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : undefined,
        note: dto.note,
      },
    });

    await this.audit.log({
      userId: ctx.userId,
      action: 'child.update',
      entityType: 'child_document',
      entityId: docId,
      oldValue: { number: doc.number },
      newValue: { number: updated.number },
    });

    return updated;
  }

  async verify(ctx: AuthContext, childId: string, docId: string) {
    const doc = await this.tenantPrisma.db.childDocument.findFirst({
      where: { id: docId, childId },
    });
    if (!doc) throw AppErrors.notFound('Document not found');

    const updated = await this.tenantPrisma.db.childDocument.update({
      where: { id: docId },
      data: { verified: true, verifiedBy: ctx.userId, verifiedAt: new Date() },
    });

    await this.audit.log({
      userId: ctx.userId,
      action: 'child.update',
      entityType: 'child_document',
      entityId: docId,
      newValue: { verified: true },
    });

    return updated;
  }

  expiring(withinDays: number) {
    const now = new Date();
    const until = new Date(now.getTime() + withinDays * 86_400_000);
    return this.tenantPrisma.db.childDocument.findMany({
      where: { deletedAt: null, expiryDate: { not: null, gte: now, lte: until } },
      include: { child: { select: { firstName: true, lastName: true } } },
      orderBy: { expiryDate: 'asc' },
    });
  }
}
