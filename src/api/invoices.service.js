const db = require('./database');

const MAX_LINES = 100;
const MAX_AMOUNT_CENTS = Number.MAX_SAFE_INTEGER;

async function getOne(sql, params = [], connection = db) {
  const [rows] = await connection.execute(sql, params);
  return rows[0] || null;
}

async function getMany(sql, params = [], connection = db) {
  const [rows] = await connection.execute(sql, params);
  return rows;
}

async function execute(sql, params = [], connection = db) {
  const [result] = await connection.execute(sql, params);
  return result;
}

async function withTransaction(callback) {
  for (let attempt = 0; ; attempt += 1) {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const result = await callback(connection);
      await connection.commit();
      return result;
    } catch (error) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error('Invoice transaction rollback failed:', rollbackError.message);
      }

      const retryable = [
        'ER_CHECKREAD',
        'ER_LOCK_DEADLOCK',
        'ER_LOCK_WAIT_TIMEOUT',
      ].includes(error.code) || [1020, 1205, 1213].includes(error.errno);
      if (!retryable || attempt >= 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
    } finally {
      connection.release();
    }
  }
}

function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function dateOnly(value) {
  if (!value) return null;
  return value instanceof Date
    ? value.toISOString().slice(0, 10)
    : String(value).slice(0, 10);
}

function isDuplicateEntry(error) {
  return error?.code === 'ER_DUP_ENTRY' || error?.errno === 1062;
}

function normalizeText(value, maxLength) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text.slice(0, maxLength) : null;
}

function parsePositiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function parseCents(value, { allowZero = true } = {}) {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) return null;
  return value;
}

function parseQuantityMillis(value) {
  const text = String(value ?? '');
  const match = /^(0|[1-9]\d{0,7})(?:\.(\d{1,3}))?$/.exec(text);
  if (!match) return null;
  const whole = Number(match[1]);
  const fraction = Number((match[2] || '').padEnd(3, '0'));
  const quantity = whole * 1000 + fraction;
  return Number.isSafeInteger(quantity) && quantity > 0 ? quantity : null;
}

function safeNumber(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 && number <= MAX_AMOUNT_CENTS
    ? number
    : null;
}

function normalizeStoredInteger(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new Error('FINANCIAL_VALUE_OUT_OF_RANGE');
  }
  return number;
}

function normalizeInvoiceAmounts(invoice) {
  for (const field of [
    'subtotal_cents',
    'discount_cents',
    'tax_cents',
    'total_cents',
    'paid_cents',
    'credited_cents',
    'outstanding_cents',
  ]) {
    invoice[field] = normalizeStoredInteger(invoice[field]);
  }
  return invoice;
}

function roundDivide(numerator, denominator) {
  return (numerator + denominator / 2n) / denominator;
}

function calculateLine(line) {
  const quantityMillis = parseQuantityMillis(line.quantity);
  const unitPriceCents = parseCents(line.unitPriceCents);
  const discountCents = parseCents(line.discountCents ?? 0);
  const taxRateBps = Number(line.taxRateBps ?? 0);
  const taxInclusive = line.taxInclusive === true;

  if (
    !quantityMillis ||
    unitPriceCents === null ||
    discountCents === null ||
    !Number.isSafeInteger(taxRateBps) ||
    taxRateBps < 0 ||
    taxRateBps > 10000
  ) {
    throw new Error('INVALID_INVOICE');
  }

  const subtotal = roundDivide(
    BigInt(quantityMillis) * BigInt(unitPriceCents),
    1000n
  );
  const safeSubtotal = safeNumber(subtotal);
  if (safeSubtotal === null || discountCents > safeSubtotal) {
    throw new Error('INVALID_INVOICE');
  }

  const discounted = BigInt(safeSubtotal - discountCents);
  const rate = BigInt(taxRateBps);
  const tax = taxInclusive
    ? roundDivide(discounted * rate, 10000n + rate)
    : roundDivide(discounted * rate, 10000n);
  const total = taxInclusive ? discounted : discounted + tax;
  const taxCents = safeNumber(tax);
  const totalCents = safeNumber(total);

  if (taxCents === null || totalCents === null) {
    throw new Error('INVALID_INVOICE');
  }

  return {
    quantityMillis,
    unitPriceCents,
    discountCents,
    taxRateBps,
    taxInclusive,
    subtotalCents: safeSubtotal,
    taxCents,
    totalCents,
  };
}

function addAmount(total, value) {
  const result = total + value;
  if (!Number.isSafeInteger(result)) throw new Error('INVALID_INVOICE');
  return result;
}

async function assertMembership(businessId, userId, connection) {
  const membership = await getOne(
    `SELECT id FROM business_memberships
     WHERE business_id = ? AND user_id = ?`,
    [businessId, userId],
    connection
  );
  if (!membership) throw new Error('FORBIDDEN');
}

async function loadCustomer(businessId, customerId, connection) {
  const customer = await getOne(
    `SELECT id, name, email, phone
     FROM customers
     WHERE id = ? AND business_id = ?`,
    [customerId, businessId],
    connection
  );
  if (!customer) throw new Error('INVALID_CUSTOMER');
  return customer;
}

async function normalizeLines(businessId, rawLines, connection) {
  if (!Array.isArray(rawLines) || rawLines.length === 0 || rawLines.length > MAX_LINES) {
    throw new Error('INVALID_INVOICE');
  }

  const lines = [];
  let subtotalCents = 0;
  let discountCents = 0;
  let taxCents = 0;
  let totalCents = 0;

  for (const rawLine of rawLines) {
    if (!rawLine || typeof rawLine !== 'object' || Array.isArray(rawLine)) {
      throw new Error('INVALID_INVOICE');
    }

    const productId = rawLine.productId === null || rawLine.productId === undefined || rawLine.productId === ''
      ? null
      : parsePositiveId(rawLine.productId);
    if (rawLine.productId && !productId) throw new Error('INVALID_INVOICE');

    let product = null;
    if (productId) {
      product = await getOne(
        `SELECT id, name, description, price_cents, is_active
         FROM products
         WHERE id = ? AND business_id = ?`,
        [productId, businessId],
        connection
      );
      if (!product || !Number(product.is_active)) throw new Error('INVALID_PRODUCT');
    }

    const itemType = rawLine.itemType || (product ? 'product' : 'custom');
    if (!['product', 'service', 'custom'].includes(itemType) || (product && itemType === 'custom')) {
      throw new Error('INVALID_INVOICE');
    }

    const itemName = normalizeText(rawLine.name || product?.name, 191);
    const description = normalizeText(
      rawLine.description ?? product?.description,
      2000
    );
    if (!itemName) throw new Error('INVALID_INVOICE');

    const unitPriceCents = product && rawLine.unitPriceCents === undefined
      ? safeNumber(product.price_cents)
      : parseCents(rawLine.unitPriceCents);
    if (unitPriceCents === null) throw new Error('INVALID_INVOICE');

    const line = calculateLine({
      quantity: rawLine.quantity,
      unitPriceCents,
      discountCents: rawLine.discountCents ?? 0,
      taxRateBps: rawLine.taxRateBps ?? 0,
      taxInclusive: rawLine.taxInclusive === true,
    });

    subtotalCents = addAmount(subtotalCents, line.subtotalCents);
    discountCents = addAmount(discountCents, line.discountCents);
    taxCents = addAmount(taxCents, line.taxCents);
    totalCents = addAmount(totalCents, line.totalCents);
    lines.push({
      businessId,
      productId,
      itemType,
      itemName,
      description,
      ...line,
    });
  }

  return { lines, subtotalCents, discountCents, taxCents, totalCents };
}

async function insertLines(invoiceId, businessId, lines, connection) {
  for (const line of lines) {
    await execute(
      `INSERT INTO invoice_items
       (business_id, invoice_id, product_id, item_type, item_name, description,
        quantity_millis, unit_price_cents, discount_cents, tax_rate_bps,
        tax_inclusive, subtotal_cents, tax_cents, total_cents)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        businessId,
        invoiceId,
        line.productId,
        line.itemType,
        line.itemName,
        line.description,
        line.quantityMillis,
        line.unitPriceCents,
        line.discountCents,
        line.taxRateBps,
        line.taxInclusive ? 1 : 0,
        line.subtotalCents,
        line.taxCents,
        line.totalCents,
      ],
      connection
    );
  }
}

async function insertAuditEvent(businessId, invoiceId, userId, action, details, connection) {
  await execute(
    `INSERT INTO invoice_audit_events
     (business_id, invoice_id, user_id, action, details)
     VALUES (?, ?, ?, ?, ?)`,
    [businessId, invoiceId, userId, action, details ? JSON.stringify(details) : null],
    connection
  );
}

async function getInvoiceDetails(businessId, invoiceId, connection = db) {
  const invoice = await getOne(
    `SELECT i.*,
       COALESCE(payments.paid_cents, 0) AS paid_cents,
       COALESCE(credits.credited_cents, 0) AS credited_cents,
       GREATEST(i.total_cents - COALESCE(payments.paid_cents, 0)
         - COALESCE(credits.credited_cents, 0), 0) AS outstanding_cents,
       CASE
         WHEN i.status = 'credited' THEN 'credited'
         WHEN i.status IN ('issued', 'sent', 'partially_paid')
           AND i.due_date < UTC_DATE()
           AND i.total_cents > COALESCE(payments.paid_cents, 0)
             + COALESCE(credits.credited_cents, 0) THEN 'overdue'
         ELSE i.status
       END AS display_status
     FROM invoices i
     LEFT JOIN (
       SELECT business_id, invoice_id, SUM(amount_cents) AS paid_cents
       FROM invoice_payments
       GROUP BY business_id, invoice_id
     ) payments
       ON payments.business_id = i.business_id
       AND payments.invoice_id = i.id
     LEFT JOIN (
       SELECT business_id, invoice_id, SUM(total_cents) AS credited_cents
       FROM invoice_credit_notes
       GROUP BY business_id, invoice_id
     ) credits
       ON credits.business_id = i.business_id
       AND credits.invoice_id = i.id
     WHERE i.business_id = ? AND i.id = ?`,
    [businessId, invoiceId],
    connection
  );
  if (!invoice) return null;

  const [items, payments, auditEvents, creditNotes] = await Promise.all([
    getMany(
      `SELECT id, product_id, item_type, item_name, description, quantity_millis,
         unit_price_cents, discount_cents, tax_rate_bps, tax_inclusive,
         subtotal_cents, tax_cents, total_cents
       FROM invoice_items
       WHERE business_id = ? AND invoice_id = ?
       ORDER BY id`,
      [businessId, invoiceId],
      connection
    ),
    getMany(
      `SELECT id, amount_cents, payment_date, payment_method, reference, notes,
         receipt_number, recorded_by, created_at
       FROM invoice_payments
       WHERE business_id = ? AND invoice_id = ?
       ORDER BY payment_date, id`,
      [businessId, invoiceId],
      connection
    ),
    getMany(
      `SELECT action, details, user_id, created_at
       FROM invoice_audit_events
       WHERE business_id = ? AND invoice_id = ?
       ORDER BY id`,
      [businessId, invoiceId],
      connection
    ),
    getMany(
      `SELECT id, credit_number, credit_date, reason, subtotal_cents, discount_cents,
         tax_cents, total_cents
       FROM invoice_credit_notes
       WHERE business_id = ? AND invoice_id = ?
       ORDER BY credit_date DESC, id DESC`,
      [businessId, invoiceId],
      connection
    ),
  ]);
  return {
    ...normalizeInvoiceAmounts(invoice),
    items: items.map((item) => ({
      ...item,
      quantity_millis: normalizeStoredInteger(item.quantity_millis),
      unit_price_cents: normalizeStoredInteger(item.unit_price_cents),
      discount_cents: normalizeStoredInteger(item.discount_cents),
      tax_rate_bps: Number(item.tax_rate_bps),
      tax_inclusive: Number(item.tax_inclusive),
      subtotal_cents: normalizeStoredInteger(item.subtotal_cents),
      tax_cents: normalizeStoredInteger(item.tax_cents),
      total_cents: normalizeStoredInteger(item.total_cents),
    })),
    payments: payments.map((payment) => ({
      ...payment,
      amount_cents: normalizeStoredInteger(payment.amount_cents),
    })),
    creditNotes: creditNotes.map((credit) => ({
      ...credit,
      subtotal_cents: normalizeStoredInteger(credit.subtotal_cents),
      discount_cents: normalizeStoredInteger(credit.discount_cents),
      tax_cents: normalizeStoredInteger(credit.tax_cents),
      total_cents: normalizeStoredInteger(credit.total_cents),
    })),
    auditEvents,
  };
}

async function getInvoiceSettings(businessId, userId) {
  await assertMembership(businessId, userId, db);
  const settings = await getOne(
    `SELECT number_prefix, logo_document_id, bank_account_name, bank_name,
       bank_account_number, bank_branch_code, bank_account_type, payment_instructions
     FROM invoice_settings WHERE business_id = ?`,
    [businessId]
  );
  return {
    numberPrefix: settings?.number_prefix || 'INV',
    logoDocumentId: settings?.logo_document_id || null,
    bankAccountName: settings?.bank_account_name || '',
    bankName: settings?.bank_name || '',
    bankAccountNumber: settings?.bank_account_number || '',
    bankBranchCode: settings?.bank_branch_code || '',
    bankAccountType: settings?.bank_account_type || '',
    paymentInstructions: settings?.payment_instructions || '',
  };
}

async function updateInvoiceSettings({ businessId, userId, numberPrefix, payload = {} }) {
  const prefix = normalizeText(numberPrefix, 20);
  if (!prefix || !/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(prefix)) {
    throw new Error('INVALID_INVOICE_SETTINGS');
  }
  const bankDetails = {
    bankAccountName: normalizeText(payload.bankAccountName, 191),
    bankName: normalizeText(payload.bankName, 191),
    bankAccountNumber: normalizeText(payload.bankAccountNumber, 100),
    bankBranchCode: normalizeText(payload.bankBranchCode, 40),
    bankAccountType: normalizeText(payload.bankAccountType, 80),
    paymentInstructions: normalizeText(payload.paymentInstructions, 1000),
  };
  const logoDocumentId = payload.logoDocumentId === null || payload.logoDocumentId === undefined ||
    payload.logoDocumentId === '' ? null : parsePositiveId(payload.logoDocumentId);
  if (payload.logoDocumentId && !logoDocumentId) throw new Error('INVALID_INVOICE_SETTINGS');

  await withTransaction(async (connection) => {
    await assertMembership(businessId, userId, connection);
    if (logoDocumentId) {
      const logo = await getOne(
        `SELECT id FROM financial_documents
         WHERE id = ? AND business_id = ? AND document_type = 'business_logo'
           AND deleted_at IS NULL`,
        [logoDocumentId, businessId],
        connection
      );
      if (!logo) throw new Error('INVALID_INVOICE_SETTINGS');
    }
    await execute(
      `INSERT INTO invoice_settings
       (business_id, number_prefix, logo_document_id, bank_account_name, bank_name,
        bank_account_number, bank_branch_code, bank_account_type, payment_instructions)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         number_prefix = VALUES(number_prefix),
         logo_document_id = COALESCE(VALUES(logo_document_id), logo_document_id),
         bank_account_name = COALESCE(VALUES(bank_account_name), bank_account_name),
         bank_name = COALESCE(VALUES(bank_name), bank_name),
         bank_account_number = COALESCE(VALUES(bank_account_number), bank_account_number),
         bank_branch_code = COALESCE(VALUES(bank_branch_code), bank_branch_code),
         bank_account_type = COALESCE(VALUES(bank_account_type), bank_account_type),
         payment_instructions = COALESCE(VALUES(payment_instructions), payment_instructions)`,
      [
        businessId,
        prefix,
        logoDocumentId,
        bankDetails.bankAccountName,
        bankDetails.bankName,
        bankDetails.bankAccountNumber,
        bankDetails.bankBranchCode,
        bankDetails.bankAccountType,
        bankDetails.paymentInstructions,
      ],
      connection
    );
  });
  return getInvoiceSettings(businessId, userId);
}

function validateHeader(payload) {
  const customerId = parsePositiveId(payload.customerId);
  const invoiceDate = payload.invoiceDate;
  const dueDate = payload.dueDate;
  if (
    !customerId ||
    !isValidDate(invoiceDate) ||
    !isValidDate(dueDate) ||
    dueDate < invoiceDate
  ) {
    throw new Error('INVALID_INVOICE');
  }

  return {
    customerId,
    invoiceDate,
    dueDate,
    referenceNumber: normalizeText(payload.referenceNumber, 100),
    description: normalizeText(payload.description, 2000),
    customerBillingAddress: normalizeText(payload.customerBillingAddress, 2000),
    paymentTerms: normalizeText(payload.paymentTerms, 500),
    notes: normalizeText(payload.notes, 4000),
    termsAndConditions: normalizeText(payload.termsAndConditions, 4000),
  };
}

async function createDraft({ businessId, userId, payload = {} }) {
  const header = validateHeader(payload);
  const invoiceId = await withTransaction(async (connection) => {
    await assertMembership(businessId, userId, connection);
    const customer = await loadCustomer(businessId, header.customerId, connection);
    const totals = await normalizeLines(businessId, payload.items, connection);
    const business = await getOne(
      'SELECT currency FROM businesses WHERE id = ?',
      [businessId],
      connection
    );
    if (!business) throw new Error('INVALID_BUSINESS');

    const result = await execute(
      `INSERT INTO invoices
       (business_id, customer_id, customer_name, customer_email, customer_phone,
        customer_billing_address, invoice_date, due_date, reference_number,
        description, subtotal_cents, discount_cents, tax_cents, total_cents,
        currency, payment_terms, notes, terms_and_conditions, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        businessId,
        customer.id,
        customer.name,
        customer.email,
        customer.phone,
        header.customerBillingAddress,
        header.invoiceDate,
        header.dueDate,
        header.referenceNumber,
        header.description,
        totals.subtotalCents,
        totals.discountCents,
        totals.taxCents,
        totals.totalCents,
        business.currency,
        header.paymentTerms,
        header.notes,
        header.termsAndConditions,
        userId,
      ],
      connection
    );
    await insertLines(result.insertId, businessId, totals.lines, connection);
    await insertAuditEvent(businessId, result.insertId, userId, 'draft_created', null, connection);
    return result.insertId;
  });

  return getInvoiceDetails(businessId, invoiceId);
}

async function updateDraft({ businessId, userId, invoiceId, payload = {} }) {
  const header = validateHeader(payload);
  await withTransaction(async (connection) => {
    await assertMembership(businessId, userId, connection);
    const invoice = await getOne(
      `SELECT id, status FROM invoices
       WHERE id = ? AND business_id = ?
       FOR UPDATE`,
      [invoiceId, businessId],
      connection
    );
    if (!invoice) throw new Error('INVOICE_NOT_FOUND');
    if (invoice.status !== 'draft') throw new Error('INVOICE_NOT_EDITABLE');

    const customer = await loadCustomer(businessId, header.customerId, connection);
    const totals = await normalizeLines(businessId, payload.items, connection);
    await execute(
      `UPDATE invoices
       SET customer_id = ?, customer_name = ?, customer_email = ?, customer_phone = ?,
           customer_billing_address = ?, invoice_date = ?, due_date = ?,
           reference_number = ?, description = ?, subtotal_cents = ?,
           discount_cents = ?, tax_cents = ?, total_cents = ?, payment_terms = ?,
           notes = ?, terms_and_conditions = ?
       WHERE id = ? AND business_id = ?`,
      [
        customer.id,
        customer.name,
        customer.email,
        customer.phone,
        header.customerBillingAddress,
        header.invoiceDate,
        header.dueDate,
        header.referenceNumber,
        header.description,
        totals.subtotalCents,
        totals.discountCents,
        totals.taxCents,
        totals.totalCents,
        header.paymentTerms,
        header.notes,
        header.termsAndConditions,
        invoiceId,
        businessId,
      ],
      connection
    );
    await execute(
      'DELETE FROM invoice_items WHERE invoice_id = ? AND business_id = ?',
      [invoiceId, businessId],
      connection
    );
    await insertLines(invoiceId, businessId, totals.lines, connection);
    await insertAuditEvent(businessId, invoiceId, userId, 'draft_updated', null, connection);
  });
  return getInvoiceDetails(businessId, invoiceId);
}

async function issueInvoice({ businessId, userId, invoiceId }) {
  await withTransaction(async (connection) => {
    await assertMembership(businessId, userId, connection);
    const invoice = await getOne(
      `SELECT id, status, total_cents
       FROM invoices
       WHERE id = ? AND business_id = ?
       FOR UPDATE`,
      [invoiceId, businessId],
      connection
    );
    if (!invoice) throw new Error('INVOICE_NOT_FOUND');
    if (invoice.status !== 'draft') throw new Error('INVOICE_NOT_ISSUABLE');

    const itemCount = await getOne(
      'SELECT COUNT(*) AS count FROM invoice_items WHERE business_id = ? AND invoice_id = ?',
      [businessId, invoiceId],
      connection
    );
    if (Number(itemCount.count) === 0) throw new Error('INVALID_INVOICE');

    const issuedYear = new Date().getUTCFullYear();
    await execute(
      `INSERT INTO invoice_sequences (business_id, sequence_year, last_number)
       VALUES (?, ?, LAST_INSERT_ID(1))
       ON DUPLICATE KEY UPDATE last_number = LAST_INSERT_ID(last_number + 1)`,
      [businessId, issuedYear],
      connection
    );
    const sequence = await getOne(
      'SELECT LAST_INSERT_ID() AS last_number',
      [],
      connection
    );
    const nextNumber = Number(sequence.last_number);
    if (!Number.isSafeInteger(nextNumber)) throw new Error('INVOICE_SEQUENCE_EXHAUSTED');

    const settings = await getOne(
      'SELECT number_prefix FROM invoice_settings WHERE business_id = ?',
      [businessId],
      connection
    );
    const prefix = settings?.number_prefix || 'INV';
    const invoiceNumber = `${prefix}-${issuedYear}-${String(nextNumber).padStart(6, '0')}`;
    await execute(
      `UPDATE invoices
       SET invoice_number = ?, status = 'issued', issued_at = CURRENT_TIMESTAMP
       WHERE id = ? AND business_id = ? AND status = 'draft'`,
      [invoiceNumber, invoiceId, businessId],
      connection
    );
    await insertAuditEvent(
      businessId,
      invoiceId,
      userId,
      'issued',
      { invoiceNumber },
      connection
    );
  });
  return getInvoiceDetails(businessId, invoiceId);
}

async function cancelInvoice({ businessId, userId, invoiceId }) {
  await withTransaction(async (connection) => {
    await assertMembership(businessId, userId, connection);
    const invoice = await getOne(
      `SELECT id, status FROM invoices
       WHERE id = ? AND business_id = ?
       FOR UPDATE`,
      [invoiceId, businessId],
      connection
    );
    if (!invoice) throw new Error('INVOICE_NOT_FOUND');
    if (!['issued', 'sent'].includes(invoice.status)) {
      throw new Error('INVOICE_NOT_CANCELLABLE');
    }
    const payment = await getOne(
      `SELECT COUNT(*) AS count FROM invoice_payments
       WHERE invoice_id = ? AND business_id = ?`,
      [invoiceId, businessId],
      connection
    );
    if (Number(payment.count) > 0) throw new Error('INVOICE_NOT_CANCELLABLE');
    await execute(
      `UPDATE invoices SET status = 'cancelled'
       WHERE id = ? AND business_id = ?`,
      [invoiceId, businessId],
      connection
    );
    await insertAuditEvent(businessId, invoiceId, userId, 'cancelled', null, connection);
  });
  return getInvoiceDetails(businessId, invoiceId);
}

async function recordPayment({
  businessId,
  userId,
  invoiceId,
  payload = {},
  idempotencyKey,
}) {
  const amountCents = parseCents(payload.amountCents, { allowZero: false });
  const paymentDate = payload.paymentDate;
  const paymentMethod = normalizeText(payload.paymentMethod, 40);
  const reference = normalizeText(payload.reference, 100);
  const notes = normalizeText(payload.notes, 2000);
  const key = normalizeText(idempotencyKey, 191);
  if (
    amountCents === null ||
    !isValidDate(paymentDate) ||
    !paymentMethod ||
    !/^[a-zA-Z0-9 _-]+$/.test(paymentMethod) ||
    !key
  ) {
    throw new Error('INVALID_PAYMENT');
  }

  let outcome;
  try {
    outcome = await withTransaction(async (connection) => {
      await assertMembership(businessId, userId, connection);
      const invoice = await getOne(
        `SELECT id, status, total_cents
         FROM invoices
         WHERE id = ? AND business_id = ?
         FOR UPDATE`,
        [invoiceId, businessId],
        connection
      );
      if (!invoice) throw new Error('INVOICE_NOT_FOUND');

      const existing = await getOne(
        `SELECT id, invoice_id, amount_cents, payment_date, payment_method, reference, notes
         FROM invoice_payments
         WHERE business_id = ? AND idempotency_key = ?
         FOR UPDATE`,
        [businessId, key],
        connection
      );
      if (existing) {
        if (
          Number(existing.invoice_id) !== invoiceId ||
          Number(existing.amount_cents) !== amountCents ||
          dateOnly(existing.payment_date) !== paymentDate ||
          existing.payment_method !== paymentMethod ||
          (existing.reference || null) !== reference ||
          (existing.notes || null) !== notes
        ) {
          throw new Error('IDEMPOTENCY_CONFLICT');
        }
        return { replayed: true, paymentId: Number(existing.id) };
      }

      if (!['issued', 'sent', 'partially_paid', 'overdue'].includes(invoice.status)) {
        throw new Error('INVOICE_NOT_PAYABLE');
      }

      const paid = await getOne(
        `SELECT COALESCE(SUM(amount_cents), 0) AS paid_cents
         FROM invoice_payments
         WHERE invoice_id = ? AND business_id = ?`,
        [invoiceId, businessId],
        connection
      );
      const credits = await getOne(
        `SELECT COALESCE(SUM(total_cents), 0) AS credited_cents
         FROM invoice_credit_notes WHERE invoice_id = ? AND business_id = ?`,
        [invoiceId, businessId],
        connection
      );
      const outstanding = Number(invoice.total_cents) - Number(paid.paid_cents) -
        Number(credits.credited_cents);
      if (amountCents > outstanding) throw new Error('PAYMENT_EXCEEDS_BALANCE');

      const year = Number(paymentDate.slice(0, 4));
      await execute(
        `INSERT INTO receipt_sequences (business_id, sequence_year, last_number)
         VALUES (?, ?, LAST_INSERT_ID(1))
         ON DUPLICATE KEY UPDATE last_number = LAST_INSERT_ID(last_number + 1)`,
        [businessId, year],
        connection
      );
      const sequence = await getOne(
        'SELECT LAST_INSERT_ID() AS last_number',
        [],
        connection
      );
      const receiptNumber = `RCPT-${year}-${String(Number(sequence.last_number)).padStart(6, '0')}`;
      const result = await execute(
        `INSERT INTO invoice_payments
         (business_id, invoice_id, amount_cents, payment_date, payment_method,
          reference, notes, idempotency_key, receipt_number, recorded_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          businessId,
          invoiceId,
          amountCents,
          paymentDate,
          paymentMethod,
          reference,
          notes,
          key,
          receiptNumber,
          userId,
        ],
        connection
      );

      const nextPaid = Number(paid.paid_cents) + amountCents;
      const nextStatus = nextPaid + Number(credits.credited_cents) >= Number(invoice.total_cents)
        ? 'paid'
        : 'partially_paid';
      await execute(
        'UPDATE invoices SET status = ? WHERE id = ? AND business_id = ?',
        [nextStatus, invoiceId, businessId],
        connection
      );
      await insertAuditEvent(
        businessId,
        invoiceId,
        userId,
        'payment_recorded',
        { amountCents, paymentDate, paymentMethod },
        connection
      );
      return { replayed: false, paymentId: Number(result.insertId) };
    });
  } catch (error) {
    if (!isDuplicateEntry(error)) throw error;
    const existing = await getOne(
      `SELECT id, invoice_id, amount_cents, payment_date, payment_method, reference, notes
       FROM invoice_payments
       WHERE business_id = ? AND idempotency_key = ?`,
      [businessId, key]
    );
    if (!existing) throw error;
    if (
      Number(existing.invoice_id) !== invoiceId ||
      Number(existing.amount_cents) !== amountCents ||
      dateOnly(existing.payment_date) !== paymentDate ||
      existing.payment_method !== paymentMethod ||
      (existing.reference || null) !== reference ||
      (existing.notes || null) !== notes
    ) {
      throw new Error('IDEMPOTENCY_CONFLICT');
    }
    outcome = { replayed: true, paymentId: Number(existing.id) };
  }

  const updatedInvoice = await getInvoiceDetails(businessId, invoiceId);
  return {
    invoice: updatedInvoice,
    replayed: outcome.replayed,
    payment: updatedInvoice.payments.find((payment) => Number(payment.id) === outcome.paymentId),
  };
}

async function getInvoice({ businessId, userId, invoiceId }) {
  await assertMembership(businessId, userId, db);
  return getInvoiceDetails(businessId, invoiceId);
}

async function listInvoices({ businessId, userId, filters = {} }) {
  await assertMembership(businessId, userId, db);
  const page = Number(filters.page || 1);
  const pageSize = Number(filters.pageSize || 20);
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 100
  ) {
    throw new Error('INVALID_INVOICE_FILTER');
  }

  const conditions = ['i.business_id = ?'];
  const params = [businessId];
  if (filters.status) {
    const allowed = ['draft', 'issued', 'sent', 'partially_paid', 'paid', 'overdue', 'cancelled', 'credited'];
    if (!allowed.includes(filters.status)) throw new Error('INVALID_INVOICE_FILTER');
    if (filters.status === 'overdue') {
      conditions.push(`i.status IN ('issued', 'sent', 'partially_paid') AND i.due_date < UTC_DATE()`);
    } else {
      conditions.push('i.status = ?');
      params.push(filters.status);
    }
  }
  if (filters.customerId) {
    const customerId = parsePositiveId(filters.customerId);
    if (!customerId) throw new Error('INVALID_INVOICE_FILTER');
    conditions.push('i.customer_id = ?');
    params.push(customerId);
  }
  if (filters.search) {
    const search = normalizeText(filters.search, 100);
    if (search) {
      conditions.push('(i.invoice_number LIKE ? OR i.customer_name LIKE ? OR i.reference_number LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
  }
  if (filters.startDate || filters.endDate) {
    if (
      (filters.startDate && !isValidDate(filters.startDate)) ||
      (filters.endDate && !isValidDate(filters.endDate)) ||
      (filters.startDate && filters.endDate && filters.endDate < filters.startDate)
    ) {
      throw new Error('INVALID_INVOICE_FILTER');
    }
    if (filters.startDate) {
      conditions.push('i.invoice_date >= ?');
      params.push(filters.startDate);
    }
    if (filters.endDate) {
      conditions.push('i.invoice_date <= ?');
      params.push(filters.endDate);
    }
  }

  const where = conditions.join(' AND ');
  const count = await getOne(
    `SELECT COUNT(*) AS total FROM invoices i WHERE ${where}`,
    params
  );
  const invoices = await getMany(
    `SELECT i.id, i.invoice_number, i.customer_id, i.customer_name,
       i.reference_number,
       i.invoice_date, i.due_date, i.status,
       i.subtotal_cents, i.discount_cents, i.tax_cents, i.total_cents,
       i.currency, COALESCE(paid.paid_cents, 0) AS paid_cents,
       COALESCE(credits.credited_cents, 0) AS credited_cents,
       GREATEST(i.total_cents - COALESCE(paid.paid_cents, 0)
         - COALESCE(credits.credited_cents, 0), 0) AS outstanding_cents,
       CASE
         WHEN i.status = 'credited' THEN 'credited'
         WHEN i.status IN ('issued', 'sent', 'partially_paid')
           AND i.due_date < UTC_DATE()
           AND i.total_cents > COALESCE(paid.paid_cents, 0)
             + COALESCE(credits.credited_cents, 0) THEN 'overdue'
         ELSE i.status
       END AS display_status
     FROM invoices i
     LEFT JOIN (
       SELECT business_id, invoice_id, SUM(amount_cents) AS paid_cents
       FROM invoice_payments
       GROUP BY business_id, invoice_id
     ) paid
       ON paid.business_id = i.business_id AND paid.invoice_id = i.id
     LEFT JOIN (
       SELECT business_id, invoice_id, SUM(total_cents) AS credited_cents
       FROM invoice_credit_notes GROUP BY business_id, invoice_id
     ) credits
       ON credits.business_id = i.business_id AND credits.invoice_id = i.id
     WHERE ${where}
     ORDER BY i.invoice_date DESC, i.id DESC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize]
  );

  return {
    invoices: invoices.map((invoice) => normalizeInvoiceAmounts(invoice)),
    total: Number(count.total),
    page,
    pageSize,
  };
}

module.exports = {
  calculateLine,
  cancelInvoice,
  createDraft,
  getInvoice,
  getInvoiceSettings,
  issueInvoice,
  listInvoices,
  parseQuantityMillis,
  recordPayment,
  updateDraft,
  updateInvoiceSettings,
};
