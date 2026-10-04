import { Inject, Injectable } from '@nestjs/common';
import { TenantPrisma } from '../prisma/tenant-prisma.provider';
import { AuditService } from '../audit/audit.service';
import { AppConfigService } from '../config/app-config.service';
import { AppErrors } from '../common/exceptions/app.exception';
import { AuthContext } from '../common/auth-context';
import { assertExportAccess } from '../reports/report-access';
import { STORAGE } from '../storage/storage.module';
import { StorageDriver, buildObjectKey } from '../storage/storage-driver.interface';

@Injectable()
export class FilesService {
  constructor(
    private readonly tenantPrisma: TenantPrisma,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
    @Inject(STORAGE) private readonly storage: StorageDriver,
  ) {}

  async upload(
    ctx: AuthContext,
    file: { buffer: Buffer; mimetype: string; size: number; originalname: string },
    entityType?: string,
    entityId?: string,
  ) {
    if (entityId || entityType) await this.assertEntity(ctx, entityType, entityId, true);
    const allowed = this.config.get('ALLOWED_MIME');
    if (!allowed.includes(file.mimetype)) {
      throw AppErrors.validationFailed(`UNSUPPORTED_MEDIA_TYPE: ${file.mimetype} is not allowed`);
    }
    const maxBytes = this.config.get('MAX_UPLOAD_MB') * 1024 * 1024;
    if (file.size > maxBytes) {
      throw AppErrors.validationFailed(
        `FILE_TOO_LARGE: exceeds ${this.config.get('MAX_UPLOAD_MB')}MB`,
      );
    }

    const objectKey = buildObjectKey(this.tenantPrisma.tenantId, file.mimetype);
    await this.storage.put(objectKey, file.buffer, { mime: file.mimetype, size: file.size });

    const record = await this.tenantPrisma.db.file.create({
      data: {
        tenantId: this.tenantPrisma.tenantId,
        bucket: this.storage.name,
        objectKey,
        originalName: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: BigInt(file.size),
        entityType,
        entityId,
        uploadedBy: ctx.userId,
      },
    });

    return { fileId: record.id, url: `/files/${record.id}`, size: file.size, mime: file.mimetype };
  }

  private async assertEntity(
    ctx: AuthContext,
    type?: string | null,
    id?: string | null,
    write = false,
  ) {
    if (!type || !id) throw AppErrors.validationFailed('Provide both entityType and entityId');
    if (type === 'child' || type === 'medical') {
      await this.tenantPrisma.assertChild(
        id,
        type === 'medical'
          ? write
            ? 'medical:write'
            : 'medical:read'
          : write
            ? 'child:update'
            : 'child:read',
      );
      return;
    }
    if (type === 'pickup_person') {
      const person = await this.tenantPrisma.db.pickupPerson.findFirst({ where: { id } });
      if (!person) throw AppErrors.notFound();
      await this.tenantPrisma.assertChild(person.childId, write ? 'pickup:manage' : 'pickup:read');
      return;
    }
    if (type === 'child_document') {
      const document = await this.tenantPrisma.db.childDocument.findFirst({
        where: { id, deletedAt: null },
      });
      if (!document) throw AppErrors.notFound();
      await this.tenantPrisma.assertChild(document.childId, write ? 'child:update' : 'child:read');
      return;
    }
    if (type === 'expense') {
      const expense = await this.tenantPrisma.db.expense.findFirst({
        where: { id, ...this.tenantPrisma.branchWhere(write ? 'expense:manage' : 'expense:read') },
      });
      if (!expense) throw AppErrors.notFound();
      return;
    }
    if (type === 'export_job') {
      if (write) throw AppErrors.forbidden('Export files cannot be modified through entity upload');
      const job = await this.tenantPrisma.db.exportJob.findFirst({ where: { id } });
      if (!job) throw AppErrors.notFound('Export job not found');
      assertExportAccess(ctx, job);
      return;
    }
    if (type === 'import_job') {
      if (!ctx.has('import:manage')) throw AppErrors.forbidden();
      return;
    }
    if (type === 'landing_page' || type === 'landing_block') {
      if (!ctx.has('landing:manage')) throw AppErrors.forbidden();
      return;
    }
    throw AppErrors.validationFailed('Unsupported file entityType');
  }

  async findForTenant(id: string) {
    const file = await this.tenantPrisma.db.file.findFirst({ where: { id, deletedAt: null } });
    if (!file) throw AppErrors.notFound('File not found');
    const ctx = this.tenantPrisma.context;
    if (file.entityType === 'export_job') {
      const job = await this.tenantPrisma.db.exportJob.findFirst({ where: { fileId: file.id } });
      if (!job) throw AppErrors.notFound('Export job not found');
      assertExportAccess(ctx, job);
    } else if (file.entityType && file.entityId)
      await this.assertEntity(ctx, file.entityType, file.entityId);
    else if (file.uploadedBy !== ctx.userId) {
      const child = await this.tenantPrisma.db.child.findFirst({
        where: { photoFileId: id, ...this.tenantPrisma.childWhere('file:read') },
      });
      const person = await this.tenantPrisma.db.pickupPerson.findFirst({
        where: { photoFileId: id, child: this.tenantPrisma.childWhere('file:read') },
      });
      const payment = ctx.has('payment:read')
        ? await this.tenantPrisma.db.payment.findFirst({
            where: { attachmentFileId: id, child: this.tenantPrisma.childWhere('payment:read') },
            select: { id: true },
          })
        : null;
      const expense = ctx.has('expense:read')
        ? await this.tenantPrisma.db.expense.findFirst({
            where: { attachmentFileId: id, ...this.tenantPrisma.branchWhere('expense:read') },
            select: { id: true },
          })
        : null;
      const document = ctx.has('child:read')
        ? await this.tenantPrisma.db.childDocument.findFirst({
            where: { fileId: id, child: this.tenantPrisma.childWhere('child:read') },
            select: { id: true },
          })
        : null;
      if (!child && !person && !payment && !expense && !document)
        throw AppErrors.notFound('File is not linked to an accessible record');
    }
    return file;
  }

  /**
   * The single download path — identical for both drivers, and the only
   * place file bytes are ever handed out. Two checks before any byte is
   * read: the row belongs to the caller's tenant (findForTenant), and
   * this download is audit-logged (`file.download`).
   */
  async download(ctx: AuthContext, id: string) {
    const file = await this.findForTenant(id);
    await this.audit.log({
      userId: ctx.userId,
      action: 'file.download',
      entityType: 'file',
      entityId: file.id,
    });
    const stream = await this.storage.getStream(file.objectKey);
    return { file, stream };
  }

  async remove(ctx: AuthContext, id: string) {
    const file = await this.findForTenant(id);
    if (file.entityType && file.entityId)
      await this.assertEntity(ctx, file.entityType, file.entityId, true);
    else if (file.uploadedBy !== ctx.userId) throw AppErrors.forbidden();
    await this.tenantPrisma.db.file.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({
      userId: ctx.userId,
      action: 'file.download', // no dedicated delete action in the registry; closest audited category
      entityType: 'file',
      entityId: file.id,
      newValue: { deleted: true },
    });
  }
}
