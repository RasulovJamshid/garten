import PDFDocument from 'pdfkit';

export interface ReceiptData {
  kindergartenName: string;
  receiptNo: string;
  childName: string;
  paidAt: Date;
  amountTiyin: string;
  method: string;
  allocations: { chargeKind: string; amountTiyin: string }[];
}

/** Same content as PaymentsService.receiptHtml(), rendered as a single-page PDF instead of HTML. */
export function buildReceiptPdfBuffer(data: ReceiptData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A5' });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c as Buffer));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(16).font('Helvetica-Bold').text(data.kindergartenName);
    doc.moveDown(0.5);
    doc.fontSize(11).font('Helvetica');
    doc.text(`Receipt: ${data.receiptNo}`);
    doc.text(`Child: ${data.childName}`);
    doc.text(`Date: ${data.paidAt.toISOString().slice(0, 10)}`);
    doc.text(`Method: ${data.method}`);
    doc.text(`Amount: ${data.amountTiyin} tiyin`);
    doc.moveDown();

    doc.font('Helvetica-Bold').text('Allocated to:');
    doc.font('Helvetica');
    for (const a of data.allocations) {
      doc.text(`${a.chargeKind} — ${a.amountTiyin} tiyin`);
    }

    doc.end();
  });
}
