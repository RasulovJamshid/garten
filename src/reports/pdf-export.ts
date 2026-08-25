import PDFDocument from 'pdfkit';
import { ReportResult } from './xlsx-export';

/**
 * A plain tabular PDF — one row per line, columns clipped to a fixed
 * width. No charting/branding: this is Stage 1's "generate something a
 * director can print," not a designed document. Paginates automatically
 * (pdfkit adds a page when content overflows `doc.page.height`).
 */
export function buildReportPdfBuffer(title: string, result: ReportResult): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 36, size: 'A4', layout: 'landscape' });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c as Buffer));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const colWidth = pageWidth / Math.max(result.columns.length, 1);

    doc.fontSize(14).text(title, { underline: true });
    doc.moveDown(0.5);

    const drawRow = (values: string[], bold: boolean) => {
      const y = doc.y;
      doc.fontSize(9).font(bold ? 'Helvetica-Bold' : 'Helvetica');
      values.forEach((v, i) => {
        doc.text(v, doc.page.margins.left + i * colWidth, y, {
          width: colWidth - 4,
          ellipsis: true,
          lineBreak: false,
        });
      });
      doc.moveDown(1.2);
    };

    drawRow(
      result.columns.map((c) => c.header),
      true,
    );
    for (const row of result.rows) {
      if (doc.y > doc.page.height - doc.page.margins.bottom - 20) {
        doc.addPage();
      }
      drawRow(
        result.columns.map((c) => {
          const v = row[c.key];
          return v === null || v === undefined ? '' : String(v);
        }),
        false,
      );
    }

    doc.end();
  });
}
