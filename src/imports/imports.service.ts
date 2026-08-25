import { Inject, Injectable } from '@nestjs/common';
import { TenantPrisma } from '../prisma/tenant-prisma.provider';
import { AuthContext } from '../common/auth-context';
import { AppErrors } from '../common/exceptions/app.exception';
import { STORAGE } from '../storage/storage.module';
import { StorageDriver, buildObjectKey } from '../storage/storage-driver.interface';
import { ChildrenService } from '../children/children.service';
import { GuardiansService } from '../guardians/guardians.service';
import { GroupsService } from '../groups/groups.service';
import { UsersService } from '../users/users.service';
import { ExpensesService } from '../expenses/expenses.service';
import {
  IMPORT_HANDLERS,
  ImportEntity,
  ImportLookup,
  OpeningBalanceRow,
  UserImportRow,
} from './import-handlers';
import { buildTemplateBuffer, parseXlsxRows } from './xlsx-parse';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export interface RowError {
  row: number;
  errors: string[];
}

/**
 * Validate/commit as two separate passes (api-spec §12): validate parses
 * and checks every row without writing anything; commit re-parses the
 * same stored file and only then creates records. Re-parsing at commit
 * time (rather than trusting the validate-time result) means a branch or
 * role deleted in between is caught again, not silently trusted.
 */
@Injectable()
export class ImportsService {
  constructor(
    private readonly tenantPrisma: TenantPrisma,
    @Inject(STORAGE) private readonly storage: StorageDriver,
    private readonly children: ChildrenService,
    private readonly guardians: GuardiansService,
    private readonly groups: GroupsService,
    private readonly users: UsersService,
    private readonly expenses: ExpensesService,
  ) {}

  private handlerFor(entity: string) {
    const handler = IMPORT_HANDLERS[entity as ImportEntity];
    if (!handler) {
      throw AppErrors.validationFailed(
        `Unknown import entity "${entity}". Valid: ${Object.keys(IMPORT_HANDLERS).join(', ')}`,
      );
    }
    return handler;
  }

  async template(entity: string): Promise<Buffer> {
    const handler = this.handlerFor(entity);
    return buildTemplateBuffer(entity, handler.templateColumns);
  }

  private async buildLookup(): Promise<ImportLookup> {
    const [branches, roles] = await Promise.all([
      this.tenantPrisma.db.branch.findMany({ select: { id: true, code: true } }),
      this.tenantPrisma.db.role.findMany({ select: { id: true, code: true } }),
    ]);
    return {
      branchIdByCode: new Map(branches.map((b) => [b.code, b.id])),
      roleIdByCode: new Map(roles.map((r) => [r.code, r.id])),
    };
  }

  private async parseAndValidate(entity: string, buffer: Buffer) {
    const handler = this.handlerFor(entity);
    const lookup = await this.buildLookup();
    const rawRows = await parseXlsxRows(buffer, handler.templateColumns);

    const parsed: { row: number; data?: unknown }[] = [];
    const errors: RowError[] = [];
    rawRows.forEach((raw, i) => {
      const result = handler.parseRow(raw, lookup);
      if (result.errors.length > 0) {
        errors.push({ row: i + 2, errors: result.errors }); // +2: header row + 1-index
      } else {
        parsed.push({ row: i + 2, data: result.data });
      }
    });

    return { totalRows: rawRows.length, parsed, errors };
  }

  async validate(
    ctx: AuthContext,
    entity: string,
    file: { buffer: Buffer; originalname: string; size: number },
  ) {
    const { totalRows, parsed, errors } = await this.parseAndValidate(entity, file.buffer);

    const objectKey = buildObjectKey(this.tenantPrisma.tenantId, XLSX_MIME);
    await this.storage.put(objectKey, file.buffer, { mime: XLSX_MIME, size: file.size });
    const fileRow = await this.tenantPrisma.db.file.create({
      data: {
        tenantId: this.tenantPrisma.tenantId,
        bucket: this.storage.name,
        objectKey,
        originalName: file.originalname,
        mimeType: XLSX_MIME,
        sizeBytes: BigInt(file.size),
        entityType: 'import_job',
        uploadedBy: ctx.userId,
      },
    });

    const job = await this.tenantPrisma.db.importJob.create({
      data: {
        tenantId: this.tenantPrisma.tenantId,
        entity,
        fileId: fileRow.id,
        status: 'validated',
        totalRows,
        validRows: parsed.length,
        failedRows: errors.length,
        errors: errors as any,
        createdBy: ctx.userId,
      },
    });

    return {
      importJobId: job.id,
      totalRows,
      validRows: parsed.length,
      failedRows: errors.length,
      errors,
    };
  }

  async get(id: string) {
    const job = await this.tenantPrisma.db.importJob.findFirst({ where: { id } });
    if (!job) throw AppErrors.notFound('Import job not found');
    return job;
  }

  async commit(ctx: AuthContext, importJobId: string, skipInvalid: boolean) {
    const job = await this.get(importJobId);
    if (job.status !== 'validated') {
      throw AppErrors.conflict(`Import job status is "${job.status}", expected "validated"`);
    }

    const fileRow = job.fileId
      ? await this.tenantPrisma.db.file.findFirst({ where: { id: job.fileId } })
      : null;
    if (!fileRow) throw AppErrors.notFound('Source file for this import job is missing');
    const stream = await this.storage.getStream(fileRow.objectKey);
    const buffer = await streamToBuffer(stream);

    const { parsed, errors: parseErrors } = await this.parseAndValidate(job.entity, buffer);

    if (parseErrors.length > 0 && !skipInvalid) {
      throw AppErrors.validationFailed(
        `${parseErrors.length} row(s) still fail validation — pass skipInvalid:true to commit the rest, or fix and re-validate`,
      );
    }

    const commitErrors: RowError[] = [...parseErrors];
    let committed = 0;

    for (const { row, data } of parsed) {
      try {
        await this.commitRow(ctx, job.entity, data);
        committed++;
      } catch (e) {
        commitErrors.push({ row, errors: [(e as Error).message] });
      }
    }

    const updated = await this.tenantPrisma.db.importJob.update({
      where: { id: importJobId },
      data: {
        status: committed > 0 ? 'completed' : 'failed',
        validRows: committed,
        failedRows: commitErrors.length,
        errors: commitErrors as any,
        completedAt: new Date(),
      },
    });

    return updated;
  }

  private async commitRow(ctx: AuthContext, entity: string, data: unknown): Promise<void> {
    switch (entity) {
      case 'children':
        await this.children.create(ctx, data as any);
        return;
      case 'guardians':
        await this.guardians.create(ctx, data as any);
        return;
      case 'groups':
        await this.groups.create(ctx, data as any);
        return;
      case 'users':
        await this.users.create(ctx, (data as UserImportRow).dto);
        return;
      case 'expenses':
        await this.expenses.create(ctx, data as any);
        return;
      case 'opening_balances':
        await this.commitOpeningBalance(ctx, data as OpeningBalanceRow);
        return;
      default:
        throw new Error(`No committer registered for entity "${entity}"`);
    }
  }

  /**
   * "opening_balance" isn't one of charge.kind's allowed values in
   * 01-schema.sql — 'adjustment' is the closest fit (a manual correction
   * carrying forward pre-system debt, not tied to attendance/tariffs), so
   * that's what's stored; the description keeps it identifiable in
   * finance/charges reports.
   */
  private async commitOpeningBalance(ctx: AuthContext, row: OpeningBalanceRow): Promise<void> {
    const child = await this.tenantPrisma.db.child.findFirst({ where: { id: row.childId } });
    if (!child) throw new Error(`Child ${row.childId} not found`);

    const asOf = new Date(row.asOfDate);
    const year = asOf.getFullYear();
    const month = asOf.getMonth() + 1;
    const period = await this.tenantPrisma.db.accountingPeriod.upsert({
      where: { tenantId_year_month: { tenantId: this.tenantPrisma.tenantId, year, month } },
      create: { tenantId: this.tenantPrisma.tenantId, year, month, status: 'open' },
      update: {},
    });

    await this.tenantPrisma.db.charge.create({
      data: {
        tenantId: this.tenantPrisma.tenantId,
        branchId: child.branchId,
        childId: row.childId,
        periodId: period.id,
        kind: 'adjustment',
        amountTiyin: BigInt(row.amountTiyin),
        sign: 1,
        description: row.note ? `Opening balance: ${row.note}` : 'Opening balance',
        issuedAt: asOf,
        createdBy: ctx.userId,
      },
    });
  }
}

function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (c) => chunks.push(c as Buffer));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}
