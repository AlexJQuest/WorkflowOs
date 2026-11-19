const invoiceEmailService = require('./invoice-email.service');

const RATE_WINDOW_MS = 60 * 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 5;
const MAX_TRACKED_ADDRESSES = 5000;
const requestsByAddress = new Map();

function normalizeText(value, maxLength) {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[character]));
}

function enforceRateLimit(address) {
  const now = Date.now();
  for (const [key, record] of requestsByAddress) {
    if (now - record.startedAt >= RATE_WINDOW_MS) requestsByAddress.delete(key);
  }
  if (requestsByAddress.size >= MAX_TRACKED_ADDRESSES) {
    requestsByAddress.delete(requestsByAddress.keys().next().value);
  }
  const key = String(address || 'unknown').slice(0, 128);
  const record = requestsByAddress.get(key);
  if (record && record.count >= MAX_REQUESTS_PER_WINDOW) {
    throw new Error('CONTACT_RATE_LIMITED');
  }
  if (record) record.count += 1;
  else requestsByAddress.set(key, { startedAt: now, count: 1 });
}

async function submitContact(payload = {}, address) {
  if (payload.website) throw new Error('CONTACT_SPAM');
  const values = {
    name: normalizeText(payload.name, 100),
    businessName: normalizeText(payload.businessName, 191),
    email: normalizeText(payload.email, 191),
    phone: normalizeText(payload.phone, 50),
    subject: normalizeText(payload.subject, 120),
    message: normalizeText(payload.message, 5000),
  };
  if (!values.name || !values.subject || !values.message ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) {
    throw new Error('INVALID_CONTACT_MESSAGE');
  }
  const recipient = normalizeText(process.env.PUBLIC_CONTACT_EMAIL, 191);
  if (!recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient) ||
      !invoiceEmailService.isEmailConfigured()) {
    throw new Error('CONTACT_NOT_CONFIGURED');
  }
  enforceRateLimit(address);
  const lines = [
    ['Name', values.name],
    ['Business', values.businessName || 'Not provided'],
    ['Email', values.email],
    ['Phone', values.phone || 'Not provided'],
    ['Subject', values.subject],
    ['Message', values.message],
  ];
  try {
    return await invoiceEmailService.sendPlainEmail({
      to: recipient,
      replyTo: values.email,
      subject: 'WorkflowOS website enquiry',
      html: `<h1>Website enquiry</h1>${lines.map(([label, value]) =>
        `<p><strong>${label}</strong><br>${escapeHtml(value).replace(/\n/g, '<br>')}</p>`
      ).join('')}`,
    });
  } catch (error) {
    if (error.message === 'EMAIL_NOT_CONFIGURED') throw new Error('CONTACT_NOT_CONFIGURED');
    if (error.message.startsWith('EMAIL_PROVIDER_REJECTED:')) {
      throw new Error('CONTACT_DELIVERY_FAILED');
    }
    throw error;
  }
}

module.exports = { submitContact };
