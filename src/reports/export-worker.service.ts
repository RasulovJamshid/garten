import { Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { ContextIdFactory, ModuleRef } from '@nestjs/core';
import type { JobWithMetadata } from 'pg-boss';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedRequest } from '../common/request-context';
import { AuthContext } from '../common/auth-context';
import { PermissionResolverService } from '../rbac/permission-resolver.service';
import { PgBossService } from '../jobs/pgboss.service';
import { STORAGE } from '../storage/storage.module';
import { StorageDriver, buildObjectKey } from '../storage/storage-driver.interface';
import { ReportsService } from './reports.service';
import { REPORT_REGISTRY } from './report-registry';
import { buildWorkbookBuffer } from './xlsx-export';
import { buildReportPdfBuffer } from './pdf-export';
import { EXPORT_GENERATE_QUEUE, ExportJobData } from './export-job.constants';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PDF_MIME = 'application/pdf';

/**
 * Background half of the large-report path. Runs outside any HTTP
 * request, so it can't use TenantPrisma (raw PrismaService instead — see
 * the .eslintrc.js exemption for this file) — but ReportsService and
 * everything under it *does* require TenantPrisma. Rather than duplicate
 * every report query for background use, this manufactures a synthetic
 * per-tenant request context via ModuleRef + ContextIdFactory (Nest's
 * documented mechanism for resolving request-scoped providers outside a
 * real request) and lets Nest wire the real ReportsService through it
 * unmodified.
 */
@Injectable()
export class ExportWorkerService implements OnApplicationBootstrap {
  constructor(
    private readonly prisma: PrismaService,
    private readonly boss: PgBossService,
    private readonly moduleRef: ModuleRef,
    private readonly permissionResolver: PermissionResolverService,
    @Inject(STORAGE) private readonly storage: StorageDriver,
  ) {}

  onApplicationBootstrap(): void {
    this.boss
      .work<ExportJobData>(EXPORT_GENERATE_QUEUE, { localConcurrency: 2 }, (job) =>
        this.process(job),
      )
      .catch((e: Error) => {
        // eslint-disable-next-line no-console
        console.error(`Failed to register ${EXPORT_GENERATE_QUEUE} worker: ${e.message}`);
      });
  }

  private async process(job: JobWithMetadata<ExportJobData>): Promise<void> {
    const exportJob = await this.prisma.exportJob.findFirst({
      where: { id: job.data.exportJobId, tenantId: job.data.tenantId },
    });
    if (!exportJob || exportJob.status !== 'processing') return;

    try {
      const definition = REPORT_REGISTRY[exportJob.reportKey];
      if (!definition) throw new Error(`Unknown report key "${exportJob.reportKey}"`);

      const contextId = ContextIdFactory.create();
      const fakeRequest = {
        user: { sub: exportJob.createdBy, tid: exportJob.tenantId, bid: [] },
      } as unknown as AuthenticatedRequest;
      this.moduleRef.registerRequestByContextId(fakeRequest, contextId);
      const reportsService = await this.moduleRef.resolve(ReportsService, contextId, {
        strict: false,
      });

      const [perms, branchIds, ownGroupIds] = await Promise.all([
        this.permissionResolver.resolve(exportJob.createdBy),
        this.permissionResolver.branchIds(exportJob.createdBy),
        this.permissionResolver.ownGroupIds(exportJob.createdBy),
      ]);
      const authContext = new AuthContext(
        exportJob.createdBy,
        exportJob.tenantId,
        branchIds,
        ownGroupIds,
        perms,
      );

      const params = (exportJob.params as Record<string, string | undefined> | null) ?? {};
      const result = await definition.run(reportsService, authContext, params);

      const isPdf = exportJob.format === 'pdf';
      const buffer = isPdf
        ? await buildReportPdfBuffer(definition.title, result)
        : await buildWorkbookBuffer(definition.title, result);
      const mime = isPdf ? PDF_MIME : XLSX_MIME;

      const objectKey = buildObjectKey(exportJob.tenantId, mime);
      await this.storage.put(objectKey, buffer, { mime, size: buffer.length });
      const fileRow = await this.prisma.file.create({
        data: {
          tenantId: exportJob.tenantId,
          bucket: this.storage.name,
          objectKey,
          originalName: `${definition.title}.${exportJob.format}`,
          mimeType: mime,
          sizeBytes: BigInt(buffer.length),
          entityType: 'export_job',
          uploadedBy: exportJob.createdBy,
        },
      });

      await this.prisma.exportJob.update({
        where: { id: exportJob.id },
        data: {
          status: 'completed',
          fileId: fileRow.id,
          expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
        },
      });
    } catch (e) {
      await this.prisma.exportJob.update({
        where: { id: exportJob.id },
        data: { status: 'failed', error: (e as Error).message },
      });
    }
  }
}
