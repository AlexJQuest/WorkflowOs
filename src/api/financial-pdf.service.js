const PDFDocument = require('pdfkit');

function clean(value) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
}

function money(cents, currency) {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(cents) / 100);
}

function dateOnly(value) {
  return value instanceof Date
    ? value.toISOString().slice(0, 10)
    : String(value ?? '').slice(0, 10);
}

function collectPdf(render) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 44, bufferPages: true });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.once('error', reject);
    doc.once('end', () => resolve(Buffer.concat(chunks)));
    render(doc);
    doc.end();
  });
}

function heading(doc, title, business, customer) {
  doc.font('Helvetica-Bold').fontSize(18).fillColor('#153f32')
    .text(clean(business.name) || 'Business', 44, 44, { width: 300 });
  const businessLines = [
    business.address,
    business.phone,
    business.contact_email,
  ].map(clean).filter(Boolean);
  if (businessLines.length) {
    doc.font('Helvetica').fontSize(8).fillColor('#65736a')
      .text(businessLines.join('\n'), 44, 69, { width: 250 });
  }
  doc.font('Helvetica-Bold').fontSize(17).fillColor('#153f32')
    .text(title, 330, 45, { width: 220, align: 'right' });
  if (customer) {
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#34443a')
      .text('Customer', 44, 126);
    doc.font('Helvetica').fontSize(10).fillColor('#27382e')
      .text(clean(customer.name), 44, 141, { width: 260 });
    const details = [customer.email, customer.phone].map(clean).filter(Boolean);
    if (details.length) {
      doc.font('Helvetica').fontSize(8).fillColor('#65736a')
        .text(details.join('\n'), 44, 157, { width: 260 });
    }
  }
}

function makeReceiptPdf({ receipt }) {
  return collectPdf((doc) => {
    heading(doc, 'PAYMENT RECEIPT', {
      name: receipt.business_name,
      address: receipt.business_address,
      phone: receipt.business_phone,
      contact_email: receipt.business_email,
    }, {
      name: receipt.customer_name,
      email: receipt.customer_email,
    });
    const y = 225;
    const fields = [
      ['Receipt number', receipt.receipt_number],
      ['Invoice', receipt.invoice_number],
      ['Payment date', dateOnly(receipt.payment_date)],
      ['Payment method', receipt.payment_method],
      ['Reference', receipt.reference || '—'],
      ['Amount received', money(receipt.amount_cents, receipt.currency)],
      ['Invoice total', money(receipt.total_cents, receipt.currency)],
      ['Remaining balance', money(receipt.outstanding_cents, receipt.currency)],
    ];
    for (const [label, value] of fields) {
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#34443a')
        .text(label, 44, doc.y + 10, { continued: true, width: 180 });
      doc.font('Helvetica').fontSize(9).fillColor('#34443a')
        .text(clean(value), 235, doc.y - 11, { width: 310 });
      doc.moveTo(44, doc.y + 6).lineTo(551, doc.y + 6)
        .lineWidth(0.5).strokeColor('#dce5df').stroke();
    }
    if (receipt.notes) {
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#34443a')
        .text('Notes', 44, doc.y + 24);
      doc.font('Helvetica').fontSize(9).fillColor('#65736a')
        .text(clean(receipt.notes), 44, doc.y + 6, { width: 507 });
    }
    doc.font('Helvetica').fontSize(8).fillColor('#78827d')
      .text('Thank you for your payment.', 44, 740, { width: 507, align: 'center' });
  });
}

function makeCreditNotePdf({ creditNote }) {
  return collectPdf((doc) => {
    heading(doc, 'CREDIT NOTE', { name: creditNote.business_name }, {
      name: creditNote.customer_name,
      email: creditNote.customer_email,
    });
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#34443a')
      .text(`Credit note: ${clean(creditNote.credit_number)}`, 340, 128, { width: 211, align: 'right' });
    doc.font('Helvetica').fontSize(9)
      .text(`Invoice: ${clean(creditNote.invoice_number)}\nDate: ${dateOnly(creditNote.credit_date)}`, 340, 146, { width: 211, align: 'right' });
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#34443a').text('Reason', 44, 210);
    doc.font('Helvetica').fontSize(9).fillColor('#65736a')
      .text(clean(creditNote.reason), 44, 224, { width: 507 });

    let y = 273;
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#526258');
    doc.text('Credited item', 44, y, { width: 280 });
    doc.text('Qty', 332, y, { width: 50, align: 'right' });
    doc.text('Tax', 397, y, { width: 65, align: 'right' });
    doc.text('Credit', 470, y, { width: 81, align: 'right' });
    y += 18;
    doc.moveTo(44, y).lineTo(551, y).strokeColor('#dce5df').stroke();
    for (const item of creditNote.items) {
      y += 9;
      if (y > 710) {
        doc.addPage();
        y = 60;
      }
      doc.font('Helvetica').fontSize(8).fillColor('#34443a');
      doc.text(clean(item.item_name), 44, y, { width: 280 });
      doc.text((Number(item.quantity_millis) / 1000).toString(), 332, y, { width: 50, align: 'right' });
      doc.text(money(item.tax_cents, creditNote.currency), 397, y, { width: 65, align: 'right' });
      doc.font('Helvetica-Bold').text(money(item.total_cents, creditNote.currency), 470, y, { width: 81, align: 'right' });
      y = Math.max(y + 17, doc.y + 3);
      doc.moveTo(44, y).lineTo(551, y).strokeColor('#dce5df').stroke();
    }
    y += 16;
    doc.font('Helvetica').fontSize(9).fillColor('#526258')
      .text('Subtotal', 375, y, { width: 85 });
    doc.text(money(creditNote.subtotal_cents, creditNote.currency), 460, y, { width: 91, align: 'right' });
    y += 17;
    doc.text('Discount', 375, y, { width: 85 });
    doc.text(money(-creditNote.discount_cents, creditNote.currency), 460, y, { width: 91, align: 'right' });
    y += 17;
    doc.text('Tax adjustment', 375, y, { width: 85 });
    doc.text(money(creditNote.tax_cents, creditNote.currency), 460, y, { width: 91, align: 'right' });
    y += 19;
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#153f32')
      .text('Credit total', 375, y, { width: 85 });
    doc.text(money(creditNote.total_cents, creditNote.currency), 460, y, { width: 91, align: 'right' });
  });
}

function makeStatementPdf({
  statement,
  business,
  accountLabel = 'CUSTOMER STATEMENT',
  counterparty = statement.customer,
}) {
  return collectPdf((doc) => {
    heading(doc, accountLabel, business, counterparty);
    doc.font('Helvetica').fontSize(9).fillColor('#65736a')
      .text(`Period: ${statement.range.startDate} to ${statement.range.endDate}`, 44, 195);
    let y = 226;
    function tableHeader() {
      doc.font('Helvetica-Bold').fontSize(7).fillColor('#526258');
      doc.text('Date', 44, y, { width: 62 });
      doc.text('Type / reference', 112, y, { width: 160 });
      doc.text('Debit', 300, y, { width: 70, align: 'right' });
      doc.text('Credit', 378, y, { width: 70, align: 'right' });
      doc.text('Balance', 456, y, { width: 95, align: 'right' });
      y += 15;
      doc.moveTo(44, y).lineTo(551, y).strokeColor('#dce5df').stroke();
      y += 8;
    }
    tableHeader();
    doc.font('Helvetica').fontSize(8).fillColor('#34443a')
      .text('Opening balance', 112, y, { width: 160 });
    doc.text(money(statement.openingBalanceCents, business.currency), 456, y, { width: 95, align: 'right' });
    y += 18;
    for (const row of statement.rows) {
      if (y > 715) {
        doc.addPage();
        y = 54;
        tableHeader();
      }
      doc.font('Helvetica').fontSize(8).fillColor('#34443a');
      doc.text(dateOnly(row.transaction_date), 44, y, { width: 62 });
      doc.text(`${clean(row.type)} · ${clean(row.reference)}`, 112, y, { width: 180 });
      doc.text(row.debit_cents ? money(row.debit_cents, business.currency) : '—', 300, y, { width: 70, align: 'right' });
      doc.text(row.credit_cents ? money(row.credit_cents, business.currency) : '—', 378, y, { width: 70, align: 'right' });
      doc.text(money(row.balance_cents, business.currency), 456, y, { width: 95, align: 'right' });
      y += 18;
    }
    if (y > 715) {
      doc.addPage();
      y = 54;
    }
    doc.moveTo(44, y).lineTo(551, y).strokeColor('#dce5df').stroke();
    y += 12;
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#153f32')
      .text('Closing balance', 112, y, { width: 180 });
    doc.text(money(statement.closingBalanceCents, business.currency), 456, y, { width: 95, align: 'right' });
  });
}

module.exports = {
  makeCreditNotePdf,
  makeReceiptPdf,
  makeStatementPdf,
};
