const db = require('./database');
const documentService = require('./financial-documents.service');

const FIELD_LIMITS = {
  supplierName: 191,
  supplierInvoiceNumber: 100,
  invoiceDate: 10,
  dueDate: 10,
  subtotalCents: Number.MAX_SAFE_INTEGER,
  taxCents: Number.MAX_SAFE_INTEGER,
  totalCents: Number.MAX_SAFE_INTEGER,
};

function getProviderConfig() {
  const provider = String(process.env.DOCUMENT_EXTRACTION_PROVIDER || '').trim();
  const url = String(process.env.DOCUMENT_EXTRACTION_URL || '').trim();
  const apiKey = String(process.env.DOCUMENT_EXTRACTION_API_KEY || '').trim();
  if (!provider && !url && !apiKey) return null;
  if (!provider || !url || !apiKey) throw new Error('EXTRACTION_CONFIGURATION_INCOMPLETE');
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('EXTRACTION_CONFIGURATION_INVALID');
  }
  if (parsed.protocol !== 'https:') throw new Error('EXTRACTION_CONFIGURATION_INVALID');
  return { provider, url: parsed.toString(), apiKey };
}

function getProviderStatus() {
  const config = getProviderConfig();
  return config
    ? { configured: true, provider: config.provider }
    : { configured: false, provider: null };
}

function normalizeSuggestions(fields) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    throw new Error('EXTRACTION_RESPONSE_INVALID');
  }
  const suggestions = {};
  for (const [field, limit] of Object.entries(FIELD_LIMITS)) {
    const value = fields[field];
    if (value === undefined || value === null || value === '') continue;
    if (typeof limit === 'number' && field.endsWith('Cents')) {
      if (!Number.isSafeInteger(value) || value < 0 || value > limit) continue;
      suggestions[field] = value;
    } else if (typeof value === 'string') {
      suggestions[field] = value.trim().slice(0, limit);
    }
  }
  if (Array.isArray(fields.lineItems)) {
    suggestions.lineItems = fields.lineItems.slice(0, 100).flatMap((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
      const clean = {};
      if (typeof item.description === 'string') clean.description = item.description.trim().slice(0, 191);
      for (const key of ['quantity', 'unitPriceCents', 'taxCents']) {
        if (Number.isSafeInteger(item[key]) && item[key] >= 0) clean[key] = item[key];
      }
      return Object.keys(clean).length ? [clean] : [];
    });
  }
  return suggestions;
}

async function extractSuggestions({ businessId, userId, documentId, consentToExternalProcessing }) {
  if (consentToExternalProcessing !== true) throw new Error('EXTRACTION_CONSENT_REQUIRED');
  const config = getProviderConfig();
  if (!config) throw new Error('EXTRACTION_NOT_CONFIGURED');
  const { document, buffer } = await documentService.readDocument({ businessId, userId, documentId });
  if (!document) throw new Error('DOCUMENT_NOT_FOUND');
  if (!['supplier_invoice', 'supporting_document'].includes(document.document_type)) {
    throw new Error('DOCUMENT_NOT_EXTRACTABLE');
  }

  const form = new FormData();
  form.append(
    'file',
    new Blob([buffer], { type: document.mime_type }),
    document.original_filename
  );
  form.append('documentId', String(document.id));
  let response;
  try {
    response = await fetch(config.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}` },
      body: form,
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw new Error('EXTRACTION_PROVIDER_FAILED');
  }
  const responseText = await response.text();
  let body = {};
  try {
    body = responseText ? JSON.parse(responseText) : {};
  } catch {
    throw new Error('EXTRACTION_RESPONSE_INVALID');
  }
  if (!response.ok) throw new Error('EXTRACTION_PROVIDER_FAILED');
  const suggestions = normalizeSuggestions(body.fields);
  const [result] = await db.execute(
    `INSERT INTO document_extraction_suggestions
     (business_id, document_id, provider, status, suggested_fields, created_by)
     VALUES (?, ?, ?, 'suggested', ?, ?)`,
    [businessId, documentId, config.provider.slice(0, 80),
      JSON.stringify(suggestions), userId]
  );
  await db.execute(
    `INSERT INTO financial_audit_events
     (business_id, user_id, event_type, record_type, record_id, details)
     VALUES (?, ?, 'document_extraction_suggested', 'document', ?, ?)`,
    [businessId, userId, documentId, JSON.stringify({
      suggestionId: Number(result.insertId),
      provider: config.provider,
      externalProcessingConfirmed: true,
    })]
  );
  return {
    id: Number(result.insertId),
    status: 'suggested',
    provider: config.provider,
    fields: suggestions,
    requiresHumanReview: true,
  };
}

async function confirmSuggestions({
  businessId,
  userId,
  documentId,
  suggestionId,
  confirmed,
}) {
  if (confirmed !== true && confirmed !== false) throw new Error('INVALID_EXTRACTION_CONFIRMATION');
  const document = await documentService.getDocumentRecord({
    businessId,
    userId,
    documentId,
  });
  if (!document) throw new Error('DOCUMENT_NOT_FOUND');
  const [result] = await db.execute(
    `UPDATE document_extraction_suggestions
     SET status = ?, confirmed_by = ?, confirmed_at = CURRENT_TIMESTAMP
     WHERE id = ? AND business_id = ? AND document_id = ? AND status = 'suggested'`,
    [confirmed ? 'confirmed' : 'rejected', userId, suggestionId, businessId, documentId]
  );
  if (!result.affectedRows) throw new Error('EXTRACTION_SUGGESTION_NOT_FOUND');
  await db.execute(
    `INSERT INTO financial_audit_events
     (business_id, user_id, event_type, record_type, record_id, details)
     VALUES (?, ?, ?, 'document_extraction', ?, ?)`,
    [businessId, userId, confirmed ? 'document_extraction_confirmed' : 'document_extraction_rejected',
      suggestionId, JSON.stringify({ documentId })]
  );
  return { id: Number(suggestionId), status: confirmed ? 'confirmed' : 'rejected' };
}

module.exports = {
  confirmSuggestions,
  extractSuggestions,
  getProviderStatus,
};
