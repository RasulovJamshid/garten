import { Inject, Injectable } from '@nestjs/common';
import { TenantPrisma } from '../prisma/tenant-prisma.provider';
import { AuditService } from '../audit/audit.service';
import { AppConfigService } from '../config/app-config.service';
import { AppErrors } from '../common/exceptions/app.exception';
import { AuthContext } from '../common/auth-context';
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

  async findForTenant(id: string) {
    const file = await this.tenantPrisma.db.file.findFirst({ where: { id, deletedAt: null } });
    if (!file) throw AppErrors.notFound('File not found');
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
