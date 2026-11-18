const PDFDocument = require('pdfkit');

function cleanText(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .trim();
}

function formatMoney(cents, currency) {
  try {
    return new Intl.NumberFormat('en-ZA', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(cents) / 100);
  } catch {
    return `${currency} ${(Number(cents) / 100).toFixed(2)}`;
  }
}

function dateOnly(value) {
  return value instanceof Date
    ? value.toISOString().slice(0, 10)
    : String(value ?? '').slice(0, 10);
}

function makeInvoicePdf({ invoice, business }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 44, bufferPages: true });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.once('error', reject);
    doc.once('end', () => resolve(Buffer.concat(chunks)));

    const left = 44;
    const right = 551;
    const descriptionWidth = 210;
    const columns = {
      quantity: 270,
      unit: 310,
      discount: 370,
      tax: 430,
      total: 480,
    };
    const bottom = 748;
    const isDraft = invoice.status === 'draft';

    function rule(y) {
      doc.moveTo(left, y).lineTo(right, y).lineWidth(0.6).strokeColor('#dce5df').stroke();
    }

    function drawTableHeader(y) {
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#526258');
      doc.text('Description', left, y, { width: descriptionWidth });
      doc.text('Qty', columns.quantity, y, { width: 35, align: 'right' });
      doc.text('Unit price', columns.unit, y, { width: 54, align: 'right' });
      doc.text('Discount', columns.discount, y, { width: 54, align: 'right' });
      doc.text('Tax', columns.tax, y, { width: 44, align: 'right' });
      doc.text('Total', columns.total, y, { width: 70, align: 'right' });
      rule(y + 15);
      return y + 23;
    }

    function drawPageHeading(continued = false) {
      if (business.logoBuffer) {
        doc.image(business.logoBuffer, left, 42, { fit: [50, 50] });
      }
      const businessTextX = business.logoBuffer ? 106 : left;
      doc.font('Helvetica-Bold').fontSize(15).fillColor('#153f32')
        .text(cleanText(business.name) || 'Business', businessTextX, 42, { width: 300 - (businessTextX - left) });
      doc.font('Helvetica').fontSize(8).fillColor('#68776e');
      const businessLines = [
        business.address,
        business.phone,
        business.contact_email,
      ].map(cleanText).filter(Boolean);
      if (businessLines.length) {
        doc.text(businessLines.join('\n'), businessTextX, 64, {
          width: 250 - (businessTextX - left),
          lineGap: 2,
        });
      }

      doc.font('Helvetica-Bold').fontSize(18).fillColor('#153f32')
        .text(isDraft ? 'DRAFT INVOICE' : 'INVOICE', 335, 43, { width: 216, align: 'right' });
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#38483e')
        .text(cleanText(invoice.invoice_number || `Draft ${invoice.id}`), 335, 68, { width: 216, align: 'right' });
      if (continued) {
        doc.font('Helvetica').fontSize(8).fillColor('#78827d')
          .text('Continued', 335, 83, { width: 216, align: 'right' });
      }
    }

    function drawContinuationHeader() {
      doc.addPage();
      drawPageHeading(true);
      return drawTableHeader(112);
    }

    doc.rect(left, 37, 4, 20).fill('#198257');
    drawPageHeading();
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#34443a')
      .text('Bill to', left, 129);
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#27382e')
      .text(cleanText(invoice.customer_name), left, 145, { width: 245 });
    doc.font('Helvetica').fontSize(8).fillColor('#65736a');
    const customerLines = [
      invoice.customer_billing_address,
      invoice.customer_email,
      invoice.customer_phone,
    ].map(cleanText).filter(Boolean);
    if (customerLines.length) {
      doc.text(customerLines.join('\n'), left, 160, { width: 245, lineGap: 2 });
    }

    const metaX = 337;
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#526258');
    doc.text('Invoice date', metaX, 128);
    doc.text('Due date', metaX, 148);
    if (invoice.reference_number) doc.text('Reference', metaX, 168);
    doc.font('Helvetica').fontSize(8).fillColor('#34443a');
    doc.text(dateOnly(invoice.invoice_date), 425, 128, { width: 126, align: 'right' });
    doc.text(dateOnly(invoice.due_date), 425, 148, { width: 126, align: 'right' });
    if (invoice.reference_number) {
      doc.text(cleanText(invoice.reference_number), 425, 168, { width: 126, align: 'right' });
    }

    let y = 206;
    if (invoice.description) {
      doc.font('Helvetica').fontSize(8).fillColor('#526258')
        .text(cleanText(invoice.description), left, y, { width: right - left });
      y = doc.y + 13;
    }
    y = drawTableHeader(Math.max(y, 216));

    for (const item of invoice.items) {
      const description = [cleanText(item.item_name), cleanText(item.description)]
        .filter(Boolean)
        .join('\n');
      doc.font('Helvetica').fontSize(8);
      const descriptionHeight = doc.heightOfString(description, {
        width: descriptionWidth,
        lineGap: 2,
      });
      const rowHeight = Math.max(19, descriptionHeight + 8);
      if (y + rowHeight > bottom) y = drawContinuationHeader();

      const rowY = y + 3;
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#35453b')
        .text(cleanText(item.item_name), left, rowY, { width: descriptionWidth });
      if (item.description) {
        doc.font('Helvetica').fontSize(7).fillColor('#78827d')
          .text(cleanText(item.description), left, rowY + 10, { width: descriptionWidth });
      }
      doc.font('Helvetica').fontSize(8).fillColor('#526258');
      doc.text((Number(item.quantity_millis) / 1000).toString(), columns.quantity, rowY, { width: 35, align: 'right' });
      doc.text(formatMoney(item.unit_price_cents, invoice.currency), columns.unit, rowY, { width: 54, align: 'right' });
      doc.text(formatMoney(item.discount_cents, invoice.currency), columns.discount, rowY, { width: 54, align: 'right' });
      doc.text(formatMoney(item.tax_cents, invoice.currency), columns.tax, rowY, { width: 44, align: 'right' });
      doc.font('Helvetica-Bold').fillColor('#35453b')
        .text(formatMoney(item.total_cents, invoice.currency), columns.total, rowY, { width: 70, align: 'right' });
      y += rowHeight;
      rule(y);
      y += 7;
    }

    if (y + 108 > bottom) {
      doc.addPage();
      drawPageHeading(true);
      y = 125;
    }
    y += 8;
    const totalsX = 350;
    const taxIncludedCents = invoice.items.reduce(
      (sum, item) => Number(item.tax_inclusive) === 1 ? sum + item.tax_cents : sum,
      0
    );
    const taxAddedCents = invoice.tax_cents - taxIncludedCents;
    const totalRows = [
      ['Subtotal', invoice.subtotal_cents],
      ['Discount', -invoice.discount_cents],
      ['Tax added', taxAddedCents],
    ];
    if (taxIncludedCents > 0) totalRows.push(['Tax included (in total)', taxIncludedCents]);
    for (const [label, cents] of totalRows) {
      doc.font('Helvetica').fontSize(8).fillColor('#526258')
        .text(label, totalsX, y, { width: 85 });
      doc.text(formatMoney(cents, invoice.currency), 435, y, { width: 116, align: 'right' });
      y += 17;
    }
    rule(y);
    y += 7;
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#153f32')
      .text('Total', totalsX, y, { width: 85 });
    doc.text(formatMoney(invoice.total_cents, invoice.currency), 435, y, { width: 116, align: 'right' });
    y += 22;
    if (invoice.paid_cents > 0) {
      doc.font('Helvetica').fontSize(8).fillColor('#526258')
        .text('Paid to date', totalsX, y, { width: 85 });
      doc.text(formatMoney(invoice.paid_cents, invoice.currency), 435, y, { width: 116, align: 'right' });
      y += 17;
      doc.font('Helvetica-Bold').fillColor('#34443a')
        .text('Balance due', totalsX, y, { width: 85 });
      doc.text(formatMoney(invoice.outstanding_cents, invoice.currency), 435, y, { width: 116, align: 'right' });
      y += 22;
    }

    const notes = [
      ['Payment terms', invoice.payment_terms],
      ['Notes', invoice.notes],
      ['Terms and conditions', invoice.terms_and_conditions],
      ['Payment instructions', business.payment_instructions],
      ['Bank account name', business.bank_account_name],
      ['Bank', business.bank_name],
      ['Account number', business.bank_account_number],
      ['Branch code', business.bank_branch_code],
      ['Account type', business.bank_account_type],
    ].filter(([, value]) => value);
    for (const [heading, value] of notes) {
      if (y + 45 > bottom) {
        doc.addPage();
        drawPageHeading(true);
        y = 120;
      }
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#34443a')
        .text(heading, left, y, { width: right - left });
      y += 12;
      doc.font('Helvetica').fontSize(8).fillColor('#65736a')
        .text(cleanText(value), left, y, { width: right - left, lineGap: 2 });
      y = doc.y + 12;
    }

    const range = doc.bufferedPageRange();
    for (let pageIndex = range.start; pageIndex < range.start + range.count; pageIndex += 1) {
      doc.switchToPage(pageIndex);
      doc.font('Helvetica').fontSize(7).fillColor('#98a39b')
        .text('Generated by WorkflowOS', left, 770, { width: right - left, align: 'center' });
    }
    doc.end();
  });
}

module.exports = { makeInvoicePdf };
