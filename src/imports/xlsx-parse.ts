import ExcelJS from 'exceljs';

/**
 * Row 1 = headers; every following row becomes {key: cellValue}, keyed by
 * the import handler's field `key` — not the literal header text. The
 * template's header cells carry a human-readable hint (e.g. "birthDate
 * (YYYY-MM-DD)"), which would never match a plain `raw.birthDate` lookup
 * in import-handlers.ts if rows were keyed by that literal text, so every
 * header is resolved back to its `key` via `columns` before returning.
 * Unrecognized headers are ignored; blank rows are skipped.
 */
export async function parseXlsxRows(
  buffer: Buffer,
  columns: { key: string; header: string }[],
): Promise<Record<string, string>[]> {
  const keyByHeader = new Map(columns.map((c) => [c.header.trim().toLowerCase(), c.key]));

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  const keyByColumn: string[] = [];
  sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const header = String(cell.value ?? '').trim();
    keyByColumn[colNumber] = keyByHeader.get(header.toLowerCase()) ?? header;
  });

  const rows: Record<string, string>[] = [];
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    if (row.cellCount === 0) continue;
    const obj: Record<string, string> = {};
    let hasValue = false;
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const key = keyByColumn[colNumber];
      if (!key) return;
      const value = cell.value;
      obj[key] = value === null || value === undefined ? '' : String(value).trim();
      if (obj[key]) hasValue = true;
    });
    if (hasValue) rows.push(obj);
  }
  return rows;
}

export async function buildTemplateBuffer(
  sheetName: string,
  columns: { key: string; header: string }[],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName.slice(0, 31));
  sheet.columns = columns.map((c) => ({ key: c.key, header: c.header, width: 22 }));
  sheet.getRow(1).font = { bold: true };
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
