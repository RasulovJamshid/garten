import ExcelJS from 'exceljs';

export interface ReportColumn {
  key: string;
  header: string;
}

export interface ReportResult {
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
}

/**
 * Every value goes through String() first — BigInt (tiyin amounts) and
 * Date objects both throw or render unhelpfully if handed to exceljs raw,
 * and a report is read by an accountant in Excel, not machine-parsed, so
 * plain text is the right call over preserving native types.
 */
export async function buildWorkbookBuffer(
  sheetName: string,
  result: ReportResult,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName.slice(0, 31));
  sheet.columns = result.columns.map((c) => ({ key: c.key, header: c.header, width: 22 }));
  sheet.getRow(1).font = { bold: true };
  for (const row of result.rows) {
    const flat: Record<string, string> = {};
    for (const col of result.columns) {
      const v = row[col.key];
      flat[col.key] = v === null || v === undefined ? '' : String(v);
    }
    sheet.addRow(flat);
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
