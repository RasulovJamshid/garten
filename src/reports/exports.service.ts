import { Injectable } from '@nestjs/common';
import { TenantPrisma } from '../prisma/tenant-prisma.provider';
import { AuthContext } from '../common/auth-context';
import { AppErrors } from '../common/exceptions/app.exception';
import { PgBossService } from '../jobs/pgboss.service';
import { EXPORT_GENERATE_QUEUE, ExportJobData } from './export-job.constants';
import { ReportParams } from './report-registry';

/**
 * The async half of api-spec §11: "xlsx/pdf returns 202 with a job id
 * when the row count is large." ReportsController decides sync-vs-async
 * (it already ran the query and knows the row count); this only creates
 * the row and enqueues the background regeneration.
 */
@Injectable()
export class ExportsService {
  constructor(
    private readonly tenantPrisma: TenantPrisma,
    private readonly boss: PgBossService,
  ) {}

  async create(ctx: AuthContext, reportKey: string, format: 'xlsx' | 'pdf', params: ReportParams) {
    const job = await this.tenantPrisma.db.exportJob.create({
      data: {
        tenantId: ctx.tenantId,
        reportKey,
        format,
        params: params as any,
        status: 'processing',
        createdBy: ctx.userId,
      },
    });
    await this.boss.send(
      EXPORT_GENERATE_QUEUE,
      { exportJobId: job.id, tenantId: ctx.tenantId } as ExportJobData,
      { retryLimit: 1 },
    );
    return { jobId: job.id, status: job.status };
  }

  async get(id: string) {
    const job = await this.tenantPrisma.db.exportJob.findFirst({ where: { id } });
    if (!job) throw AppErrors.notFound('Export job not found');
    return {
      status: job.status,
      downloadUrl: job.fileId ? `/files/${job.fileId}` : null,
      expiresAt: job.expiresAt,
      error: job.error,
    };
  }
}
