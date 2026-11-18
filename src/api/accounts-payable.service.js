const crypto = require('node:crypto');
const db = require('./database');
const invoiceMath = require('./invoices.service');
const documentService = require('./financial-documents.service');

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
  const connection = await db.getConnection();
  try {
    await connection.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    try {
      await connection.rollback();
    } catch (rollbackError) {
      console.error('Accounts payable rollback failed:', rollbackError.message);
    }
    throw error;
  } finally {
    connection.release();
  }
}

function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function parseId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function dateOnly(value) {
  return value instanceof Date
    ? value.toISOString().slice(0, 10)
    : String(value || '').slice(0, 10);
}

function normalizeText(value, maxLength) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text.slice(0, maxLength) : null;
}

function serialize(row, today) {
  if (!row) return null;
  const paidCents = Number(row.paid_cents || 0);
  const totalCents = Number(row.total_cents);
  const outstandingCents = Math.max(0, totalCents - paidCents);
  const dueDate = row.due_date instanceof Date
    ? row.due_date.toISOString().slice(0, 10)
    : String(row.due_date).slice(0, 10);
  const status = row.status === 'cancelled'
    ? 'cancelled'
    : outstandingCents === 0
      ? 'paid'
      : paidCents > 0
        ? dueDate < today ? 'overdue' : 'partially_paid'
        : dueDate < today ? 'overdue' : 'received';
  return {
    ...row,
    subtotal_cents: Number(row.subtotal_cents),
    discount_cents: Number(row.discount_cents),
    tax_cents: Number(row.tax_cents),
    total_cents: totalCents,
    paid_cents: paidCents,
    outstanding_cents: outstandingCents,
    status,
  };
}

async function assertMembership(businessId, userId, connection = db) {
  const membership = await getOne(
    'SELECT id FROM business_memberships WHERE business_id = ? AND user_id = ?',
    [businessId, userId],
    connection
  );
  if (!membership) throw new Error('FORBIDDEN');
}

async function getBusinessToday(businessId) {
  const business = await getOne('SELECT timezone FROM businesses WHERE id = ?', [businessId]);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: business?.timezone || 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
    .filter((part) => part.type !== 'literal')
    .map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

async function calculateLines(businessId, rawLines, connection) {
  if (!Array.isArray(rawLines) || !rawLines.length || rawLines.length > 100) {
    throw new Error('INVALID_SUPPLIER_INVOICE');
  }
  const items = [];
  const total = { subtotal: 0, discount: 0, tax: 0, total: 0 };
  for (const raw of rawLines) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('INVALID_SUPPLIER_INVOICE');
    }
    const productId = raw.productId === null || raw.productId === undefined || raw.productId === ''
      ? null
      : parseId(raw.productId);
    if (raw.productId && !productId) throw new Error('INVALID_SUPPLIER_INVOICE');
    let product = null;
    if (productId) {
      product = await getOne(
        'SELECT id, name, description, is_active FROM products WHERE id = ? AND business_id = ?',
        [productId, businessId],
        connection
      );
      if (!product || !Number(product.is_active)) throw new Error('INVALID_PRODUCT');
    }
    const itemType = raw.itemType || (product ? 'product' : 'custom');
    const name = normalizeText(raw.name || product?.name, 191);
    const description = normalizeText(raw.description ?? product?.description, 2000);
    if (!['product', 'service', 'custom'].includes(itemType) || (product && itemType === 'custom') || !name) {
      throw new Error('INVALID_SUPPLIER_INVOICE');
    }
    let line;
    try {
      line = invoiceMath.calculateLine({
        quantity: raw.quantity,
        unitPriceCents: raw.unitPriceCents,
        discountCents: raw.discountCents ?? 0,
        taxRateBps: raw.taxRateBps ?? 0,
        taxInclusive: raw.taxInclusive === true,
      });
    } catch {
      throw new Error('INVALID_SUPPLIER_INVOICE');
    }
    total.subtotal += line.subtotalCents;
    total.discount += line.discountCents;
    total.tax += line.taxCents;
    total.total += line.totalCents;
    for (const value of Object.values(total)) {
      if (!Number.isSafeInteger(value)) throw new Error('INVALID_SUPPLIER_INVOICE');
    }
    items.push({ productId, itemType, name, description, ...line });
  }
  return { items, totals: total };
}

async function getSupplierInvoice({ businessId, userId, supplierInvoiceId }) {
  await assertMembership(businessId, userId);
  const today = await getBusinessToday(businessId);
  const row = await getOne(
    `SELECT si.*, s.name AS supplier_current_name, s.email AS supplier_email,
       COALESCE(p.paid_cents, 0) AS paid_cents,
       e.title AS expense_title, e.id AS linked_expense_id
     FROM supplier_invoices si
     JOIN expense_suppliers s ON s.id = si.supplier_id AND s.business_id = si.business_id
     LEFT JOIN (
       SELECT business_id, supplier_invoice_id, SUM(amount_cents) AS paid_cents
       FROM supplier_invoice_payments GROUP BY business_id, supplier_invoice_id
     ) p ON p.business_id = si.business_id AND p.supplier_invoice_id = si.id
     LEFT JOIN expenses e ON e.id = si.expense_id AND e.business_id = si.business_id
     WHERE si.business_id = ? AND si.id = ?`,
    [businessId, supplierInvoiceId]
  );
  if (!row) return null;
  const [items, payments, documents, stockReceipts] = await Promise.all([
    getMany(
      `SELECT id, product_id, item_type, item_name, description, quantity_millis,
         received_quantity_millis, unit_price_cents, discount_cents, tax_rate_bps,
         tax_inclusive, subtotal_cents, tax_cents, total_cents
       FROM supplier_invoice_items
       WHERE business_id = ? AND supplier_invoice_id = ? ORDER BY id`,
      [businessId, supplierInvoiceId]
    ),
    getMany(
      `SELECT id, amount_cents, payment_date, payment_method, reference, notes, created_at
       FROM supplier_invoice_payments
       WHERE business_id = ? AND supplier_invoice_id = ?
       ORDER BY payment_date DESC, id DESC`,
      [businessId, supplierInvoiceId]
    ),
    documentService.listDocuments({
      businessId,
      supplierInvoiceId,
      includeDeleted: false,
    }),
    getMany(
      `SELECT r.id, r.received_at, r.notes, r.received_by,
         SUM(ri.quantity) AS units_received
       FROM supplier_stock_receipts r
       JOIN supplier_stock_receipt_items ri
         ON ri.stock_receipt_id = r.id AND ri.business_id = r.business_id
       WHERE r.business_id = ? AND r.supplier_invoice_id = ?
       GROUP BY r.id ORDER BY r.received_at DESC, r.id DESC`,
      [businessId, supplierInvoiceId]
    ),
  ]);
  const result = serialize(row, today);
  return {
    ...result,
    invoice_date: dateOnly(row.invoice_date),
    received_date: dateOnly(row.received_date),
    due_date: dateOnly(row.due_date),
    items: items.map((item) => ({
      ...item,
      quantity_millis: Number(item.quantity_millis),
      received_quantity_millis: Number(item.received_quantity_millis),
      unit_price_cents: Number(item.unit_price_cents),
      discount_cents: Number(item.discount_cents),
      subtotal_cents: Number(item.subtotal_cents),
      tax_cents: Number(item.tax_cents),
      total_cents: Number(item.total_cents),
      tax_rate_bps: Number(item.tax_rate_bps),
      tax_inclusive: Number(item.tax_inclusive),
    })),
    payments: payments.map((payment) => ({ ...payment, amount_cents: Number(payment.amount_cents) })),
    documents,
    stockReceipts,
  };
}

async function listSupplierInvoices({ businessId, userId, filters = {} }) {
  await assertMembership(businessId, userId);
  const today = await getBusinessToday(businessId);
  const conditions = ['si.business_id = ?'];
  const params = [businessId];
  if (filters.supplierId) {
    const supplierId = parseId(filters.supplierId);
    if (!supplierId) throw new Error('INVALID_SUPPLIER_INVOICE_FILTER');
    conditions.push('si.supplier_id = ?');
    params.push(supplierId);
  }
  if (filters.status) {
    const allowed = ['received', 'partially_paid', 'paid', 'overdue', 'cancelled'];
    if (!allowed.includes(filters.status)) throw new Error('INVALID_SUPPLIER_INVOICE_FILTER');
    if (filters.status === 'overdue') {
      conditions.push(`si.status <> 'cancelled' AND si.due_date < ?
        AND si.total_cents > COALESCE((
          SELECT SUM(payment.amount_cents) FROM supplier_invoice_payments payment
          WHERE payment.business_id = si.business_id
            AND payment.supplier_invoice_id = si.id
        ), 0)`);
      params.push(today);
    } else {
      conditions.push('si.status = ?');
      params.push(filters.status);
    }
  }
  if (filters.search) {
    const search = normalizeText(filters.search, 100);
    conditions.push('(si.supplier_invoice_number LIKE ? OR si.supplier_name LIKE ? OR si.reference LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (filters.startDate && !isValidDate(filters.startDate)) throw new Error('INVALID_SUPPLIER_INVOICE_FILTER');
  if (filters.endDate && !isValidDate(filters.endDate)) throw new Error('INVALID_SUPPLIER_INVOICE_FILTER');
  if (filters.startDate && filters.endDate && filters.startDate > filters.endDate) {
    throw new Error('INVALID_SUPPLIER_INVOICE_FILTER');
  }
  if (filters.startDate) {
    conditions.push('si.invoice_date >= ?');
    params.push(filters.startDate);
  }
  if (filters.endDate) {
    conditions.push('si.invoice_date <= ?');
    params.push(filters.endDate);
  }
  const page = Number(filters.page || 1);
  const pageSize = Number(filters.pageSize || 50);
  if (!Number.isSafeInteger(page) || page < 1 ||
      !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new Error('INVALID_SUPPLIER_INVOICE_FILTER');
  }
  const where = conditions.join(' AND ');
  const [rows, count] = await Promise.all([
    getMany(
      `SELECT si.id, si.supplier_id, si.expense_id, si.supplier_invoice_number,
         si.supplier_name, si.invoice_date, si.received_date, si.due_date, si.status,
         si.total_cents, si.currency, COALESCE(p.paid_cents, 0) AS paid_cents,
         GREATEST(si.total_cents - COALESCE(p.paid_cents, 0), 0) AS outstanding_cents
       FROM supplier_invoices si
       LEFT JOIN (
         SELECT business_id, supplier_invoice_id, SUM(amount_cents) AS paid_cents
         FROM supplier_invoice_payments GROUP BY business_id, supplier_invoice_id
       ) p ON p.business_id = si.business_id AND p.supplier_invoice_id = si.id
       WHERE ${where}
       ORDER BY si.invoice_date DESC, si.id DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize]
    ),
    getOne(`SELECT COUNT(*) AS total FROM supplier_invoices si WHERE ${where}`, params),
  ]);
  return {
    supplierInvoices: rows.map((row) => ({
      ...serialize(row, today),
      invoice_date: dateOnly(row.invoice_date),
      received_date: dateOnly(row.received_date),
      due_date: dateOnly(row.due_date),
    })),
    total: Number(count.total),
    page,
    pageSize,
  };
}

async function createSupplierInvoice({ businessId, userId, payload = {} }) {
  const supplierId = parseId(payload.supplierId);
  const number = normalizeText(payload.supplierInvoiceNumber, 100);
  const invoiceDate = payload.invoiceDate;
  const receivedDate = payload.receivedDate || new Date().toISOString().slice(0, 10);
  const dueDate = payload.dueDate;
  if (!supplierId || !number || !isValidDate(invoiceDate) ||
      !isValidDate(receivedDate) || !isValidDate(dueDate) ||
      dueDate < invoiceDate || !Array.isArray(payload.items)) {
    throw new Error('INVALID_SUPPLIER_INVOICE');
  }
  let createdId;
  try {
    createdId = await withTransaction(async (connection) => {
    await assertMembership(businessId, userId, connection);
    const supplier = await getOne(
      `SELECT id, name FROM expense_suppliers
       WHERE id = ? AND business_id = ? AND is_active = 1`,
      [supplierId, businessId],
      connection
    );
    if (!supplier) throw new Error('INVALID_SUPPLIER');
    const totals = await calculateLines(businessId, payload.items, connection);
    const business = await getOne(
      'SELECT currency FROM businesses WHERE id = ?',
      [businessId],
      connection
    );
    const result = await execute(
      `INSERT INTO supplier_invoices
       (business_id, supplier_id, supplier_invoice_number, supplier_name,
        invoice_date, received_date, due_date, reference, description,
        subtotal_cents, discount_cents, tax_cents, total_cents, currency, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        businessId,
        supplierId,
        number,
        supplier.name,
        invoiceDate,
        receivedDate,
        dueDate,
        normalizeText(payload.reference, 100),
        normalizeText(payload.description, 2000),
        totals.totals.subtotal,
        totals.totals.discount,
        totals.totals.tax,
        totals.totals.total,
        business.currency || 'ZAR',
        normalizeText(payload.notes, 4000),
        userId,
      ],
      connection
    );
    for (const item of totals.items) {
      await execute(
        `INSERT INTO supplier_invoice_items
         (business_id, supplier_invoice_id, product_id, item_type, item_name,
          description, quantity_millis, unit_price_cents, discount_cents,
          tax_rate_bps, tax_inclusive, subtotal_cents, tax_cents, total_cents)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          businessId, result.insertId, item.productId, item.itemType, item.name,
          item.description, item.quantityMillis, item.unitPriceCents, item.discountCents,
          item.taxRateBps, item.taxInclusive ? 1 : 0, item.subtotalCents, item.taxCents,
          item.totalCents,
        ],
        connection
      );
    }
    await execute(
      `INSERT INTO supplier_invoice_audit_events
       (business_id, supplier_invoice_id, user_id, action, details)
       VALUES (?, ?, ?, 'invoice_received', ?)`,
      [businessId, result.insertId, userId, JSON.stringify({ supplierInvoiceNumber: number })],
      connection
    );
      return result.insertId;
    });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY' || error.errno === 1062) {
      const duplicate = await getOne(
        `SELECT id FROM supplier_invoices
         WHERE business_id = ? AND supplier_id = ? AND supplier_invoice_number = ?`,
        [businessId, supplierId, number]
      );
      if (duplicate) throw new Error('SUPPLIER_INVOICE_DUPLICATE');
    }
    throw error;
  }
  return getSupplierInvoice({ businessId, userId, supplierInvoiceId: createdId });
}

async function linkSupplierInvoiceExpense({ businessId, userId, supplierInvoiceId, payload = {} }) {
  const expenseId = payload.expenseId ? parseId(payload.expenseId) : null;
  if (payload.expenseId && !expenseId) throw new Error('INVALID_EXPENSE');
  return withTransaction(async (connection) => {
    await assertMembership(businessId, userId, connection);
    const invoice = await getOne(
      `SELECT * FROM supplier_invoices
       WHERE id = ? AND business_id = ? FOR UPDATE`,
      [supplierInvoiceId, businessId],
      connection
    );
    if (!invoice) throw new Error('SUPPLIER_INVOICE_NOT_FOUND');
    if (invoice.expense_id) throw new Error('SUPPLIER_INVOICE_ALREADY_LINKED');
    const payments = await getOne(
      `SELECT COUNT(*) AS count FROM supplier_invoice_payments
       WHERE business_id = ? AND supplier_invoice_id = ?`,
      [businessId, supplierInvoiceId],
      connection
    );
    if (Number(payments.count)) throw new Error('SUPPLIER_INVOICE_ALREADY_PAID');
    let linkedExpenseId = expenseId;
    if (expenseId) {
      const expense = await getOne(
        `SELECT id, supplier_id, total_cents FROM expenses
         WHERE id = ? AND business_id = ? AND status <> 'cancelled'
         FOR UPDATE`,
        [expenseId, businessId],
        connection
      );
      if (!expense) throw new Error('EXPENSE_NOT_FOUND');
      const existingPayments = await getOne(
        `SELECT COUNT(*) AS count FROM expense_payments
         WHERE business_id = ? AND expense_id = ?`,
        [businessId, expenseId],
        connection
      );
      if (Number(expense.total_cents) !== Number(invoice.total_cents) ||
          Number(expense.supplier_id) !== Number(invoice.supplier_id) ||
          Number(existingPayments.count)) {
        throw new Error('EXPENSE_LINK_MISMATCH');
      }
    } else {
      const matchingExpense = await getOne(
        `SELECT id FROM expenses
         WHERE business_id = ? AND supplier_id = ?
           AND reference_number = ? AND status <> 'cancelled'
         FOR UPDATE`,
        [businessId, invoice.supplier_id, invoice.supplier_invoice_number],
        connection
      );
      if (matchingExpense) throw new Error('MATCHING_EXPENSE_EXISTS');
      const result = await execute(
        `INSERT INTO expenses
         (business_id, supplier_id, title, description, reference_number, expense_date,
          due_date, subtotal_cents, tax_cents, total_cents, currency, status, notes, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unpaid', ?, ?)`,
        [
          businessId,
          invoice.supplier_id,
          `Supplier invoice ${invoice.supplier_invoice_number}`,
          invoice.description,
          invoice.supplier_invoice_number,
          invoice.invoice_date,
          invoice.due_date,
          Number(invoice.total_cents) - Number(invoice.tax_cents),
          invoice.tax_cents,
          invoice.total_cents,
          invoice.currency,
          invoice.notes,
          userId,
        ],
        connection
      );
      linkedExpenseId = Number(result.insertId);
    }
    await execute(
      `UPDATE supplier_invoices SET expense_id = ?
       WHERE id = ? AND business_id = ? AND expense_id IS NULL`,
      [linkedExpenseId, supplierInvoiceId, businessId],
      connection
    );
    await execute(
      `INSERT INTO supplier_invoice_audit_events
       (business_id, supplier_invoice_id, user_id, action, details)
       VALUES (?, ?, ?, 'expense_linked', ?)`,
      [businessId, supplierInvoiceId, userId, JSON.stringify({ expenseId: linkedExpenseId })],
      connection
    );
    return { expenseId: linkedExpenseId };
  });
}

async function recordSupplierPayment({
  businessId,
  userId,
  supplierInvoiceId,
  payload = {},
  idempotencyKey,
}) {
  const amountCents = payload.amountCents;
  const paymentDate = payload.paymentDate;
  const paymentMethod = normalizeText(payload.paymentMethod, 40);
  const reference = normalizeText(payload.reference, 100);
  const notes = normalizeText(payload.notes, 2000);
  const key = normalizeText(idempotencyKey, 191);
  if (!parseId(supplierInvoiceId) || !Number.isSafeInteger(amountCents) || amountCents <= 0 ||
      !isValidDate(paymentDate) || !['eft', 'cash', 'card', 'other'].includes(paymentMethod) || !key) {
    throw new Error('INVALID_SUPPLIER_PAYMENT');
  }
  let paymentId;
  let replayed = false;
  try {
    await withTransaction(async (connection) => {
      await assertMembership(businessId, userId, connection);
      const invoice = await getOne(
        `SELECT id, expense_id, total_cents, status
         FROM supplier_invoices WHERE id = ? AND business_id = ? FOR UPDATE`,
        [supplierInvoiceId, businessId],
        connection
      );
      if (!invoice) throw new Error('SUPPLIER_INVOICE_NOT_FOUND');
      const existing = await getOne(
        `SELECT id, supplier_invoice_id, amount_cents, payment_date,
           payment_method, reference, notes
         FROM supplier_invoice_payments
         WHERE business_id = ? AND idempotency_key = ? FOR UPDATE`,
        [businessId, key],
        connection
      );
      if (existing) {
        if (Number(existing.supplier_invoice_id) !== supplierInvoiceId ||
            Number(existing.amount_cents) !== amountCents ||
            dateOnly(existing.payment_date) !== paymentDate ||
            existing.payment_method !== paymentMethod ||
            (existing.reference || null) !== reference || (existing.notes || null) !== notes) {
          throw new Error('IDEMPOTENCY_CONFLICT');
        }
        paymentId = Number(existing.id);
        replayed = true;
        return;
      }
      if (invoice.status === 'cancelled') throw new Error('SUPPLIER_INVOICE_NOT_PAYABLE');
      const paid = await getOne(
        `SELECT COALESCE(SUM(amount_cents), 0) AS paid_cents
         FROM supplier_invoice_payments
         WHERE business_id = ? AND supplier_invoice_id = ?`,
        [businessId, supplierInvoiceId],
        connection
      );
      if (amountCents > Number(invoice.total_cents) - Number(paid.paid_cents)) {
        throw new Error('PAYMENT_EXCEEDS_BALANCE');
      }
      const result = await execute(
        `INSERT INTO supplier_invoice_payments
         (business_id, supplier_invoice_id, amount_cents, payment_date, payment_method,
          reference, notes, idempotency_key, recorded_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [businessId, supplierInvoiceId, amountCents, paymentDate, paymentMethod,
          reference, notes, key, userId],
        connection
      );
      paymentId = Number(result.insertId);
      const newPaid = Number(paid.paid_cents) + amountCents;
      await execute(
        `UPDATE supplier_invoices SET status = ?
         WHERE id = ? AND business_id = ?`,
        [newPaid >= Number(invoice.total_cents) ? 'paid' : 'partially_paid',
          supplierInvoiceId, businessId],
        connection
      );
      if (invoice.expense_id) {
        await execute(
          `INSERT INTO expense_payments
           (business_id, expense_id, amount_cents, payment_date, payment_method,
            reference, notes, idempotency_key, source_supplier_payment_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [businessId, invoice.expense_id, amountCents, paymentDate, paymentMethod,
            reference, notes, `supplier-payment-${paymentId}`, paymentId],
          connection
        );
      }
      await execute(
        `INSERT INTO supplier_invoice_audit_events
         (business_id, supplier_invoice_id, user_id, action, details)
         VALUES (?, ?, ?, 'payment_recorded', ?)`,
        [businessId, supplierInvoiceId, userId,
          JSON.stringify({ amountCents, paymentDate, paymentMethod, reference })],
        connection
      );
    });
  } catch (error) {
    if (error.code !== 'ER_DUP_ENTRY' && error.errno !== 1062) throw error;
    const existing = await getOne(
      `SELECT id, supplier_invoice_id, amount_cents, payment_date,
         payment_method, reference, notes
       FROM supplier_invoice_payments
       WHERE business_id = ? AND idempotency_key = ?`,
      [businessId, key]
    );
    if (!existing || Number(existing.supplier_invoice_id) !== supplierInvoiceId ||
        Number(existing.amount_cents) !== amountCents ||
        dateOnly(existing.payment_date) !== paymentDate ||
        existing.payment_method !== paymentMethod ||
        (existing.reference || null) !== reference || (existing.notes || null) !== notes) {
      throw new Error('IDEMPOTENCY_CONFLICT');
    }
    paymentId = Number(existing.id);
    replayed = true;
  }
  const invoice = await getSupplierInvoice({ businessId, userId, supplierInvoiceId });
  return {
    invoice,
    payment: invoice.payments.find((payment) => Number(payment.id) === paymentId),
    replayed,
  };
}

async function receiveSupplierStock({
  businessId,
  userId,
  supplierInvoiceId,
  payload = {},
  idempotencyKey,
}) {
  const key = normalizeText(idempotencyKey, 191);
  if (!key || !Array.isArray(payload.items) || !payload.items.length || payload.items.length > 100) {
    throw new Error('INVALID_STOCK_RECEIPT');
  }
  const items = payload.items.map((item) => {
    const invoiceItemId = parseId(item?.supplierInvoiceItemId);
    const quantity = item?.quantity;
    if (!invoiceItemId || !Number.isSafeInteger(quantity) || quantity <= 0 ||
        (item.updateCost !== undefined && typeof item.updateCost !== 'boolean')) {
      throw new Error('INVALID_STOCK_RECEIPT');
    }
    return { invoiceItemId, quantity, updateCost: item.updateCost === true };
  }).sort((a, b) => a.invoiceItemId - b.invoiceItemId);
  if (new Set(items.map((item) => item.invoiceItemId)).size !== items.length) {
    throw new Error('INVALID_STOCK_RECEIPT');
  }
  const requestHash = crypto.createHash('sha256').update(JSON.stringify({
    supplierInvoiceId,
    items,
    notes: normalizeText(payload.notes, 1000),
  })).digest('hex');
  let receiptId;
  let replayed = false;
  try {
    receiptId = await withTransaction(async (connection) => {
      await assertMembership(businessId, userId, connection);
      const invoice = await getOne(
        `SELECT id, status FROM supplier_invoices
         WHERE id = ? AND business_id = ? FOR UPDATE`,
        [supplierInvoiceId, businessId],
        connection
      );
      if (!invoice || invoice.status === 'cancelled') throw new Error('SUPPLIER_INVOICE_NOT_FOUND');
      const receipt = await execute(
        `INSERT INTO supplier_stock_receipts
         (business_id, supplier_invoice_id, idempotency_key, payload_hash, received_by, notes)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [businessId, supplierInvoiceId, key, requestHash, userId, normalizeText(payload.notes, 1000)],
        connection
      );
      for (const item of items) {
        const line = await getOne(
          `SELECT id, product_id, item_type, quantity_millis, received_quantity_millis,
             unit_price_cents
           FROM supplier_invoice_items
           WHERE id = ? AND business_id = ? AND supplier_invoice_id = ? FOR UPDATE`,
          [item.invoiceItemId, businessId, supplierInvoiceId],
          connection
        );
        if (!line || line.item_type !== 'product' || !line.product_id) {
          throw new Error('INVALID_STOCK_RECEIPT_ITEM');
        }
        const leftToReceive = Number(line.quantity_millis) -
          Number(line.received_quantity_millis);
        const requestedMillis = item.quantity * 1000;
        if (requestedMillis > leftToReceive) throw new Error('RECEIPT_EXCEEDS_ORDERED');
        const product = await getOne(
          `SELECT p.cost_cents, p.cost_is_known, i.quantity_on_hand
           FROM products p
           JOIN inventory i ON i.product_id = p.id AND i.business_id = p.business_id
           WHERE p.id = ? AND p.business_id = ? FOR UPDATE`,
          [line.product_id, businessId],
          connection
        );
        if (!product) throw new Error('INVALID_PRODUCT');
        const movement = await execute(
          `INSERT INTO inventory_movements
           (business_id, product_id, movement_type, quantity, reference_type, reference_id, notes, created_at)
           VALUES (?, ?, 'receipt', ?, 'supplier_invoice', ?, ?, CURRENT_TIMESTAMP)`,
          [businessId, line.product_id, item.quantity, supplierInvoiceId,
            `Supplier stock receipt ${receipt.insertId}`],
          connection
        );
        await execute(
          `UPDATE inventory
           SET quantity_on_hand = quantity_on_hand + ?, updated_at = CURRENT_TIMESTAMP
           WHERE business_id = ? AND product_id = ?`,
          [item.quantity, businessId, line.product_id],
          connection
        );
        await execute(
          `UPDATE supplier_invoice_items
           SET received_quantity_millis = received_quantity_millis + ?
           WHERE id = ? AND business_id = ?`,
          [requestedMillis, line.id, businessId],
          connection
        );
        await execute(
          `INSERT INTO supplier_stock_receipt_items
           (business_id, stock_receipt_id, supplier_invoice_item_id, product_id,
            quantity, unit_cost_cents, inventory_movement_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [businessId, receipt.insertId, line.id, line.product_id,
            item.quantity, line.unit_price_cents, movement.insertId],
          connection
        );
        if (item.updateCost) {
          await execute(
            `INSERT INTO product_cost_history
             (business_id, product_id, previous_cost_cents, new_cost_cents,
              source_supplier_invoice_id, changed_by)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [businessId, line.product_id,
              Number(product.cost_is_known) ? Number(product.cost_cents) : null,
              Number(line.unit_price_cents), supplierInvoiceId, userId],
            connection
          );
          await execute(
            `UPDATE products SET cost_cents = ?, cost_is_known = 1
             WHERE id = ? AND business_id = ?`,
            [line.unit_price_cents, line.product_id, businessId],
            connection
          );
        }
      }
      await execute(
        `INSERT INTO supplier_invoice_audit_events
         (business_id, supplier_invoice_id, user_id, action, details)
         VALUES (?, ?, ?, 'stock_received', ?)`,
        [businessId, supplierInvoiceId, userId,
          JSON.stringify({ receiptId: Number(receipt.insertId), itemCount: items.length })],
        connection
      );
      return Number(receipt.insertId);
    });
  } catch (error) {
    if (error.code !== 'ER_DUP_ENTRY' && error.errno !== 1062) throw error;
    const prior = await getOne(
      `SELECT id, payload_hash FROM supplier_stock_receipts
       WHERE business_id = ? AND idempotency_key = ?`,
      [businessId, key]
    );
    if (!prior || prior.payload_hash !== requestHash) throw new Error('IDEMPOTENCY_CONFLICT');
    receiptId = Number(prior.id);
    replayed = true;
  }
  return {
    receipt: await getOne(
      `SELECT id, supplier_invoice_id, received_at, notes
       FROM supplier_stock_receipts
       WHERE id = ? AND business_id = ?`,
      [receiptId, businessId]
    ),
    replayed,
  };
}

async function getPayablesSummary(businessId, userId) {
  await assertMembership(businessId, userId);
  const business = await getOne(
    'SELECT timezone FROM businesses WHERE id = ?',
    [businessId]
  );
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: business?.timezone || 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const dateParts = Object.fromEntries(
    parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value])
  );
  const today = `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
  const monthStart = `${today.slice(0, 7)}-01`;
  const [result, monthlyPayments] = await Promise.all([
    getOne(
    `SELECT
       COUNT(CASE WHEN si.status <> 'cancelled' THEN 1 END) AS invoice_count,
       COALESCE(SUM(CASE WHEN si.status <> 'cancelled'
         THEN si.total_cents - COALESCE(p.paid_cents, 0) ELSE 0 END), 0) AS outstanding_cents,
       COUNT(CASE WHEN si.status <> 'cancelled' AND si.due_date < ?
         AND si.total_cents > COALESCE(p.paid_cents, 0) THEN 1 END) AS overdue_count,
       COALESCE(SUM(CASE WHEN si.status <> 'cancelled' AND si.due_date < ?
         THEN GREATEST(si.total_cents - COALESCE(p.paid_cents, 0), 0) ELSE 0 END), 0) AS overdue_cents,
       COUNT(CASE WHEN si.status <> 'cancelled'
         AND COALESCE(p.paid_cents, 0) > 0 AND p.paid_cents < si.total_cents THEN 1 END) AS partially_paid_count
     FROM supplier_invoices si
     LEFT JOIN (
       SELECT business_id, supplier_invoice_id, SUM(amount_cents) AS paid_cents
       FROM supplier_invoice_payments GROUP BY business_id, supplier_invoice_id
     ) p ON p.business_id = si.business_id AND p.supplier_invoice_id = si.id
     WHERE si.business_id = ?`,
    [today, today, businessId]
    ),
    getOne(
      `SELECT COALESCE(SUM(amount_cents), 0) AS paid_cents
       FROM supplier_invoice_payments
       WHERE business_id = ? AND payment_date >= ? AND payment_date <= ?`,
      [businessId, monthStart, today]
    ),
  ]);
  return {
    invoiceCount: Number(result.invoice_count),
    outstandingCents: Number(result.outstanding_cents),
    overdueCount: Number(result.overdue_count),
    overdueCents: Number(result.overdue_cents),
    partiallyPaidCount: Number(result.partially_paid_count),
    paidThisMonthCents: Number(monthlyPayments.paid_cents),
  };
}

async function getSupplierStatement({
  businessId,
  userId,
  supplierId,
  startDate,
  endDate,
}) {
  await assertMembership(businessId, userId);
  if (!parseId(supplierId) || !isValidDate(startDate) || !isValidDate(endDate) ||
      startDate > endDate) {
    throw new Error('INVALID_STATEMENT_RANGE');
  }
  const supplier = await getOne(
    `SELECT id, name, email, phone
     FROM expense_suppliers WHERE id = ? AND business_id = ?`,
    [supplierId, businessId]
  );
  if (!supplier) return null;
  const opening = await getOne(
    `SELECT
       COALESCE((SELECT SUM(total_cents) FROM supplier_invoices
         WHERE business_id = ? AND supplier_id = ? AND status <> 'cancelled'
           AND invoice_date < ?), 0)
       - COALESCE((SELECT SUM(p.amount_cents) FROM supplier_invoice_payments p
         JOIN supplier_invoices si
           ON si.id = p.supplier_invoice_id AND si.business_id = p.business_id
         WHERE p.business_id = ? AND si.supplier_id = ? AND p.payment_date < ?), 0)
       AS opening_balance_cents`,
    [businessId, supplierId, startDate, businessId, supplierId, startDate]
  );
  const rows = await getMany(
    `SELECT transaction_date, type, record_id, reference, description, debit_cents, credit_cents
     FROM (
       SELECT si.invoice_date AS transaction_date, 'invoice' AS type, si.id AS record_id,
         si.supplier_invoice_number AS reference, 'Supplier invoice received' AS description,
         si.total_cents AS debit_cents, 0 AS credit_cents
       FROM supplier_invoices si
       WHERE si.business_id = ? AND si.supplier_id = ? AND si.status <> 'cancelled'
         AND si.invoice_date >= ? AND si.invoice_date <= ?
       UNION ALL
       SELECT p.payment_date, 'payment', p.id, p.reference,
         CONCAT('Payment made for ', si.supplier_invoice_number), 0, p.amount_cents
       FROM supplier_invoice_payments p
       JOIN supplier_invoices si
         ON si.id = p.supplier_invoice_id AND si.business_id = p.business_id
       WHERE p.business_id = ? AND si.supplier_id = ?
         AND p.payment_date >= ? AND p.payment_date <= ?
     ) supplier_events
     ORDER BY transaction_date, type, record_id`,
    [
      businessId, supplierId, startDate, endDate,
      businessId, supplierId, startDate, endDate,
    ]
  );
  let balance = Number(opening.opening_balance_cents);
  return {
    supplier,
    range: { startDate, endDate },
    openingBalanceCents: balance,
    closingBalanceCents: rows.reduce((total, row) => {
      const debit = Number(row.debit_cents);
      const credit = Number(row.credit_cents);
      balance += debit - credit;
      row.debit_cents = debit;
      row.credit_cents = credit;
      row.balance_cents = balance;
      return balance;
    }, balance),
    rows,
  };
}

function supplierStatementCsv(statement, currency) {
  const cell = (value) => {
    let text = String(value ?? '');
    if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const headings = ['Date', 'Type', 'Reference', 'Description', 'Debit cents', 'Credit cents', 'Balance cents'];
  return [
    ['Supplier statement', statement.supplier.name],
    ['Date range', `${statement.range.startDate} to ${statement.range.endDate}`],
    ['Currency', currency],
    ['Note', 'Supplier credits and adjustments are not yet represented in this statement.'],
    [],
    headings,
    ...statement.rows.map((row) => [
      row.transaction_date, row.type, row.reference, row.description,
      row.debit_cents, row.credit_cents, row.balance_cents,
    ]),
    ['Opening balance', '', '', '', '', '', statement.openingBalanceCents],
    ['Closing balance', '', '', '', '', '', statement.closingBalanceCents],
  ].map((row) => row.map(cell).join(',')).join('\r\n');
}

module.exports = {
  createSupplierInvoice,
  getPayablesSummary,
  getSupplierInvoice,
  linkSupplierInvoiceExpense,
  listSupplierInvoices,
  receiveSupplierStock,
  recordSupplierPayment,
  getSupplierStatement,
  supplierStatementCsv,
  withTransaction,
};
