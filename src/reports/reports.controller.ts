import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { ReportsService } from './reports.service';
import { ExportsService } from './exports.service';
import { buildWorkbookBuffer, ReportResult } from './xlsx-export';
import { buildReportPdfBuffer } from './pdf-export';
import { ReportParams } from './report-registry';
import { AppConfigService } from '../config/app-config.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Auth } from '../common/decorators/auth.decorator';
import { AuthContext } from '../common/auth-context';

type Format = 'json' | 'xlsx' | 'pdf';

const MIME: Record<'xlsx' | 'pdf', string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};

@ApiTags('reports')
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly exports: ExportsService,
    private readonly config: AppConfigService,
  ) {}

  /**
   * json always returns rows inline (api-spec §11). xlsx/pdf stream
   * synchronously under the row-count threshold; over it, hand off to
   * ExportsService and return 202 — the same query re-runs later in
   * ExportWorkerService via REPORT_REGISTRY, keyed by `reportKey`.
   */
  private async respond(
    res: Response,
    ctx: AuthContext,
    format: Format | undefined,
    reportKey: string,
    title: string,
    params: ReportParams,
    result: ReportResult,
  ) {
    if (format !== 'xlsx' && format !== 'pdf') {
      res.json(result.rows);
      return;
    }

    if (result.rows.length > this.config.get('REPORT_ASYNC_ROW_THRESHOLD')) {
      const job = await this.exports.create(ctx, reportKey, format, params);
      res.status(202).json(job);
      return;
    }

    const buffer =
      format === 'pdf'
        ? await buildReportPdfBuffer(title, result)
        : await buildWorkbookBuffer(title, result);
    res.setHeader('Content-Type', MIME[format]);
    res.setHeader('Content-Disposition', `attachment; filename="${title}.${format}"`);
    res.send(buffer);
  }

  @Get('attendance/daily')
  @RequirePermissions('report:read')
  async attendanceDaily(
    @Auth() ctx: AuthContext,
    @Res() res: Response,
    @Query('date') date: string,
    @Query('groupId') groupId?: string,
    @Query('format') format?: Format,
  ) {
    const result = await this.reports.attendanceDaily(ctx, date, groupId);
    return this.respond(
      res,
      ctx,
      format,
      'attendance/daily',
      'attendance-daily',
      { date, groupId },
      result,
    );
  }

  @Get('attendance/monthly')
  @RequirePermissions('report:read')
  async attendanceMonthly(
    @Auth() ctx: AuthContext,
    @Res() res: Response,
    @Query('year') year: string,
    @Query('month') month: string,
    @Query('groupId') groupId?: string,
    @Query('format') format?: Format,
  ) {
    const result = await this.reports.attendanceMonthly(ctx, Number(year), Number(month), groupId);
    return this.respond(
      res,
      ctx,
      format,
      'attendance/monthly',
      'attendance-monthly',
      { year, month, groupId },
      result,
    );
  }

  @Get('attendance/corrections')
  @RequirePermissions('report:read')
  async attendanceCorrections(
    @Auth() ctx: AuthContext,
    @Res() res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('format') format?: Format,
  ) {
    const result = await this.reports.attendanceCorrections({ from, to });
    return this.respond(
      res,
      ctx,
      format,
      'attendance/corrections',
      'attendance-corrections',
      { from, to },
      result,
    );
  }

  @Get('children/active')
  @RequirePermissions('report:read')
  async childrenActive(
    @Auth() ctx: AuthContext,
    @Res() res: Response,
    @Query('groupId') groupId?: string,
    @Query('format') format?: Format,
  ) {
    const result = await this.reports.childrenActive(groupId);
    return this.respond(
      res,
      ctx,
      format,
      'children/active',
      'children-active',
      { groupId },
      result,
    );
  }

  @Get('children/enrollments')
  @RequirePermissions('report:read')
  async childrenEnrollments(
    @Auth() ctx: AuthContext,
    @Res() res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('format') format?: Format,
  ) {
    const result = await this.reports.childrenEnrollments(from, to);
    return this.respond(
      res,
      ctx,
      format,
      'children/enrollments',
      'children-enrollments',
      { from, to },
      result,
    );
  }

  @Get('children/documents-expiring')
  @RequirePermissions('report:read')
  async childrenDocumentsExpiring(
    @Auth() ctx: AuthContext,
    @Res() res: Response,
    @Query('format') format?: Format,
  ) {
    const result = await this.reports.childrenDocumentsExpiring();
    return this.respond(
      res,
      ctx,
      format,
      'children/documents-expiring',
      'documents-expiring',
      {},
      result,
    );
  }

  @Get('children/medical-alerts')
  @RequirePermissions('report:read')
  async childrenMedicalAlerts(
    @Auth() ctx: AuthContext,
    @Res() res: Response,
    @Query('format') format?: Format,
  ) {
    const result = await this.reports.childrenMedicalAlerts();
    return this.respond(res, ctx, format, 'children/medical-alerts', 'medical-alerts', {}, result);
  }

  @Get('finance/charges')
  @RequirePermissions('report:read')
  async financeCharges(
    @Auth() ctx: AuthContext,
    @Res() res: Response,
    @Query('periodId') periodId?: string,
    @Query('format') format?: Format,
  ) {
    const result = await this.reports.financeCharges(periodId);
    return this.respond(
      res,
      ctx,
      format,
      'finance/charges',
      'finance-charges',
      { periodId },
      result,
    );
  }

  @Get('finance/payments')
  @RequirePermissions('report:read')
  async financePayments(
    @Auth() ctx: AuthContext,
    @Res() res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('method') method?: string,
    @Query('format') format?: Format,
  ) {
    const result = await this.reports.financePayments(from, to, method);
    return this.respond(
      res,
      ctx,
      format,
      'finance/payments',
      'finance-payments',
      { from, to, method },
      result,
    );
  }

  @Get('finance/debts')
  @RequirePermissions('report:read')
  async financeDebts(
    @Auth() ctx: AuthContext,
    @Res() res: Response,
    @Query('ageing') ageing?: string,
    @Query('format') format?: Format,
  ) {
    const result = await this.reports.financeDebts(ageing === 'true' || ageing === 'overdue');
    return this.respond(res, ctx, format, 'finance/debts', 'finance-debts', { ageing }, result);
  }

  @Get('finance/discounts')
  @RequirePermissions('report:read')
  async financeDiscounts(
    @Auth() ctx: AuthContext,
    @Res() res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('format') format?: Format,
  ) {
    const result = await this.reports.financeDiscounts(from, to);
    return this.respond(
      res,
      ctx,
      format,
      'finance/discounts',
      'finance-discounts',
      { from, to },
      result,
    );
  }

  @Get('finance/cancellations')
  @RequirePermissions('report:read')
  async financeCancellations(
    @Auth() ctx: AuthContext,
    @Res() res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('format') format?: Format,
  ) {
    const result = await this.reports.financeCancellations(from, to);
    return this.respond(
      res,
      ctx,
      format,
      'finance/cancellations',
      'finance-cancellations',
      { from, to },
      result,
    );
  }

  @Get('expenses/monthly')
  @RequirePermissions('report:read')
  async expensesMonthly(
    @Auth() ctx: AuthContext,
    @Res() res: Response,
    @Query('year') year: string,
    @Query('month') month?: string,
    @Query('format') format?: Format,
  ) {
    const result = await this.reports.expensesMonthly(
      Number(year),
      month ? Number(month) : undefined,
    );
    return this.respond(
      res,
      ctx,
      format,
      'expenses/monthly',
      'expenses-monthly',
      { year, month },
      result,
    );
  }
}
