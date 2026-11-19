const db = require('./database');
const invoiceService = require('./invoices.service');
const receivablesService = require('./accounts-receivable.service');
const financialDocuments = require('./financial-documents.service');
const { makeInvoicePdf } = require('./invoice-pdf.service');
const { makeReceiptPdf } = require('./financial-pdf.service');

async function getOne(sql, params = []) {
  const [rows] = await db.execute(sql, params);
  return rows[0] || null;
}

function isEmailConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[character]));
}

async function sendViaResend({ to, subject, html, filename, pdf, replyTo }) {
  if (!isEmailConfigured()) throw new Error('EMAIL_NOT_CONFIGURED');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM,
      to: [to],
      subject,
      html,
      ...(replyTo ? { reply_to: replyTo } : {}),
      ...(pdf ? { attachments: [{ filename, content: pdf.toString('base64') }] } : {}),
    }),
    signal: AbortSignal.timeout(30000),
  });
  const bodyText = await response.text();
  let body = {};
  try {
    body = bodyText ? JSON.parse(bodyText) : {};
  } catch {
    body = {};
  }
  if (!response.ok || !body.id) {
    const reason = String(body.message || body.error || `Provider returned HTTP ${response.status}`)
      .replace(/[\r\n]/g, ' ')
      .slice(0, 450);
    throw new Error(`EMAIL_PROVIDER_REJECTED:${reason}`);
  }
  return { provider: 'resend', messageId: String(body.id).slice(0, 191) };
}

async function sendWithResend({ to, subject, html, filename, pdf }) {
  return sendViaResend({ to, subject, html, filename, pdf });
}

async function sendPlainEmail({ to, subject, html, replyTo }) {
  return sendViaResend({ to, subject, html, replyTo });
}

async function recordAttempt({ businessId, userId, invoiceId, email, subject, filename, pdf, html }) {
  const previous = await getOne(
    `SELECT COUNT(*) AS attempts
     FROM invoice_email_logs
     WHERE business_id = ? AND invoice_id = ? AND recipient_email = ?`,
    [businessId, invoiceId, email]
  );
  const attemptNumber = Number(previous.attempts) + 1;
  const [insertResult] = await db.execute(
    `INSERT INTO invoice_email_logs
     (business_id, invoice_id, recipient_email, status, provider, attempt_number, created_by)
     VALUES (?, ?, ?, 'pending', 'resend', ?, ?)`,
    [businessId, invoiceId, email, attemptNumber, userId]
  );
  try {
    const result = await sendWithResend({ to: email, subject, html, filename, pdf });
    await db.execute(
      `UPDATE invoice_email_logs
       SET status = 'accepted', provider_message_id = ?
       WHERE id = ? AND business_id = ?`,
      [result.messageId, insertResult.insertId, businessId]
    );
    return { logId: insertResult.insertId, attemptNumber, ...result, status: 'accepted' };
  } catch (error) {
    const safeMessage = error.message.startsWith('EMAIL_PROVIDER_REJECTED:')
      ? error.message.slice('EMAIL_PROVIDER_REJECTED:'.length)
      : error.message === 'EMAIL_NOT_CONFIGURED'
        ? 'Email delivery is not configured. Set RESEND_API_KEY and EMAIL_FROM.'
        : 'Email provider request failed.';
    await db.execute(
      `UPDATE invoice_email_logs
       SET status = 'failed', error_message = ?
       WHERE id = ? AND business_id = ?`,
      [safeMessage.slice(0, 500), insertResult.insertId, businessId]
    );
    throw error;
  }
}

async function getBusinessBranding(businessId) {
  return getOne(
    `SELECT b.name, b.currency, s.contact_email, s.phone, s.address,
       cfg.bank_account_name, cfg.bank_name, cfg.bank_account_number,
       cfg.bank_branch_code, cfg.bank_account_type, cfg.payment_instructions
     FROM businesses b
     LEFT JOIN business_settings s ON s.business_id = b.id
     LEFT JOIN invoice_settings cfg ON cfg.business_id = b.id
     WHERE b.id = ?`,
    [businessId]
  );
}

async function sendInvoiceEmail({ businessId, userId, invoiceId }) {
  const invoice = await invoiceService.getInvoice({ businessId, userId, invoiceId });
  if (!invoice) throw new Error('INVOICE_NOT_FOUND');
  if (!invoice.customer_email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(invoice.customer_email)) {
    throw new Error('INVALID_CUSTOMER_EMAIL');
  }
  if (!['issued', 'sent', 'partially_paid', 'paid', 'overdue'].includes(invoice.status)) {
    throw new Error('INVOICE_NOT_SENDABLE');
  }
  const previous = await getOne(
    `SELECT COUNT(*) AS attempts FROM invoice_email_logs
     WHERE business_id = ? AND invoice_id = ? AND recipient_email = ?`,
    [businessId, invoiceId, invoice.customer_email]
  );
  if (Number(previous.attempts) >= 3) throw new Error('EMAIL_RETRY_LIMIT');
  const business = await getBusinessBranding(businessId);
  const settings = await invoiceService.getInvoiceSettings(businessId, userId);
  let logoBuffer = null;
  if (settings.logoDocumentId) {
    const logo = await financialDocuments.readDocument({
      businessId,
      userId,
      documentId: settings.logoDocumentId,
    });
    if (!logo) throw new Error('BUSINESS_LOGO_NOT_FOUND');
    logoBuffer = logo.buffer;
  }
  const pdf = await makeInvoicePdf({
    invoice,
    business: {
      ...business,
      payment_instructions: settings.paymentInstructions,
      bank_account_name: settings.bankAccountName,
      bank_name: settings.bankName,
      bank_account_number: settings.bankAccountNumber,
      bank_branch_code: settings.bankBranchCode,
      bank_account_type: settings.bankAccountType,
      logoBuffer,
    },
  });
  const result = await recordAttempt({
    businessId,
    userId,
    invoiceId,
    email: invoice.customer_email,
    subject: `Invoice ${invoice.invoice_number} from ${business.name}`,
    filename: `invoice-${invoice.invoice_number}.pdf`,
    pdf,
    html: `<p>Hello ${escapeHtml(invoice.customer_name)},</p><p>Please find invoice <strong>${escapeHtml(invoice.invoice_number)}</strong> attached. The amount due is ${escapeHtml(invoice.currency)} ${(Number(invoice.outstanding_cents) / 100).toFixed(2)}.</p><p>Regards,<br>${escapeHtml(business.name)}</p>`,
  });
  await db.execute(
    `UPDATE invoices SET status = CASE WHEN status = 'issued' THEN 'sent' ELSE status END
     WHERE id = ? AND business_id = ?`,
    [invoiceId, businessId]
  );
  await db.execute(
    `INSERT INTO invoice_audit_events (business_id, invoice_id, user_id, action, details)
     VALUES (?, ?, ?, 'email_accepted', ?)`,
    [
      businessId,
      invoiceId,
      userId,
      JSON.stringify({
        recipient: invoice.customer_email,
        provider: result.provider,
        providerMessageId: result.messageId,
      }),
    ]
  );
  return result;
}

async function sendReceiptEmail({ businessId, userId, paymentId }) {
  const receipt = await receivablesService.getReceipt({ businessId, userId, paymentId });
  if (!receipt) throw new Error('RECEIPT_NOT_FOUND');
  if (!receipt.customer_email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(receipt.customer_email)) {
    throw new Error('INVALID_CUSTOMER_EMAIL');
  }
  const prior = await getOne(
    `SELECT COUNT(*) AS attempts FROM invoice_email_logs
     WHERE business_id = ? AND invoice_id = ? AND recipient_email = ?`,
    [businessId, receipt.invoice_id, receipt.customer_email]
  );
  if (Number(prior.attempts) >= 6) throw new Error('EMAIL_RETRY_LIMIT');
  const pdf = await makeReceiptPdf({ receipt });
  const result = await recordAttempt({
    businessId,
    userId,
    invoiceId: receipt.invoice_id,
    email: receipt.customer_email,
    subject: `Receipt ${receipt.receipt_number} from ${receipt.business_name}`,
    filename: `receipt-${receipt.receipt_number}.pdf`,
    pdf,
    html: `<p>Hello ${escapeHtml(receipt.customer_name)},</p><p>We received your payment of ${escapeHtml(receipt.currency)} ${(Number(receipt.amount_cents) / 100).toFixed(2)}. Receipt ${escapeHtml(receipt.receipt_number)} is attached.</p><p>Regards,<br>${escapeHtml(receipt.business_name)}</p>`,
  });
  return result;
}

async function listInvoiceEmailLogs({ businessId, userId, invoiceId }) {
  await invoiceService.getInvoice({ businessId, userId, invoiceId }).then((invoice) => {
    if (!invoice) throw new Error('INVOICE_NOT_FOUND');
  });
  return db.execute(
    `SELECT recipient_email, status, provider, provider_message_id,
       error_message, attempt_number, created_at
     FROM invoice_email_logs
     WHERE business_id = ? AND invoice_id = ?
     ORDER BY id DESC`,
    [businessId, invoiceId]
  ).then(([rows]) => rows);
}

module.exports = {
  isEmailConfigured,
  listInvoiceEmailLogs,
  sendInvoiceEmail,
  sendReceiptEmail,
  sendPlainEmail,
};
