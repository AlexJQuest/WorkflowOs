const db = require('./database');

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
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
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

function parseQuantityMillis(value) {
  const match = /^(0|[1-9]\d{0,7})(?:\.(\d{1,3}))?$/.exec(String(value ?? ''));
  if (!match) return null;
  const amount = Number(match[1]) * 1000 + Number((match[2] || '').padEnd(3, '0'));
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

function allocateAmount(amount, quantity, remainingQuantity) {
  if (quantity === remainingQuantity) return amount;
  return Number(
    (BigInt(amount) * BigInt(quantity) + BigInt(remainingQuantity) / 2n) /
    BigInt(remainingQuantity)
  );
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
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: business?.timezone || 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(
    parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value])
  );
  return `${values.year}-${values.month}-${values.day}`;
}

async function nextNumber(table, businessId, sequenceYear, connection) {
  const allowedTables = {
    receipt_sequences: ['RCPT', 'last_number'],
    credit_note_sequences: ['CN', 'last_number'],
  };
  const config = allowedTables[table];
  if (!config) throw new Error('INVALID_SEQUENCE');
  await execute(
    `INSERT INTO ${table} (business_id, sequence_year, last_number)
     VALUES (?, ?, LAST_INSERT_ID(1))
     ON DUPLICATE KEY UPDATE last_number = LAST_INSERT_ID(last_number + 1)`,
    [businessId, sequenceYear],
    connection
  );
  const row = await getOne('SELECT LAST_INSERT_ID() AS next_number', [], connection);
  const value = Number(row.next_number);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('SEQUENCE_EXHAUSTED');
  return `${config[0]}-${sequenceYear}-${String(value).padStart(6, '0')}`;
}

async function getReceipt({ businessId, userId, paymentId }) {
  await assertMembership(businessId, userId);
  const receipt = await getOne(
    `SELECT p.id, p.receipt_number, p.amount_cents, p.payment_date,
       p.payment_method, p.reference, p.notes, p.recorded_by, p.created_at,
       i.id AS invoice_id, i.invoice_number, i.customer_id, i.customer_name,
       i.customer_email, i.currency, i.total_cents,
       b.name AS business_name, bs.contact_email AS business_email,
       bs.phone AS business_phone, bs.address AS business_address
     FROM invoice_payments p
     JOIN invoices i ON i.id = p.invoice_id AND i.business_id = p.business_id
     JOIN businesses b ON b.id = p.business_id
     LEFT JOIN business_settings bs ON bs.business_id = p.business_id
     WHERE p.business_id = ? AND p.id = ?`,
    [businessId, paymentId]
  );
  if (!receipt) return null;
  const totals = await getOne(
    `SELECT COALESCE(SUM(amount_cents), 0) AS paid_cents
     FROM invoice_payments
     WHERE business_id = ? AND invoice_id = ?`,
    [businessId, receipt.invoice_id]
  );
  const credits = await getOne(
    `SELECT COALESCE(SUM(total_cents), 0) AS credited_cents
     FROM invoice_credit_notes
     WHERE business_id = ? AND invoice_id = ?`,
    [businessId, receipt.invoice_id]
  );
  return {
    ...receipt,
    amount_cents: Number(receipt.amount_cents),
    total_cents: Number(receipt.total_cents),
    paid_cents: Number(totals.paid_cents),
    outstanding_cents: Math.max(
      0,
      Number(receipt.total_cents) - Number(totals.paid_cents) - Number(credits.credited_cents)
    ),
  };
}

async function createCreditNote({ businessId, userId, invoiceId, payload = {} }) {
  if (!parseId(invoiceId) || !isValidDate(payload.creditDate) ||
      typeof payload.reason !== 'string' || !payload.reason.trim() ||
      payload.reason.length > 1000 || !Array.isArray(payload.items) ||
      payload.items.length === 0 || payload.items.length > 100) {
    throw new Error('INVALID_CREDIT_NOTE');
  }

  const creditId = await withTransaction(async (connection) => {
    await assertMembership(businessId, userId, connection);
    const invoice = await getOne(
      `SELECT id, status, total_cents
       FROM invoices WHERE id = ? AND business_id = ? FOR UPDATE`,
      [invoiceId, businessId],
      connection
    );
    if (!invoice) throw new Error('INVOICE_NOT_FOUND');
    if (!['issued', 'sent', 'partially_paid', 'paid', 'overdue'].includes(invoice.status)) {
      throw new Error('INVOICE_NOT_CREDITABLE');
    }

    const priorTotals = await getOne(
      `SELECT COALESCE(SUM(amount_cents), 0) AS paid_cents
       FROM invoice_payments WHERE business_id = ? AND invoice_id = ?`,
      [businessId, invoiceId],
      connection
    );
    const priorCredits = await getOne(
      `SELECT COALESCE(SUM(total_cents), 0) AS credited_cents
       FROM invoice_credit_notes WHERE business_id = ? AND invoice_id = ?`,
      [businessId, invoiceId],
      connection
    );
    const availableCents = Number(invoice.total_cents) -
      Number(priorTotals.paid_cents) - Number(priorCredits.credited_cents);
    if (availableCents <= 0) throw new Error('NO_CREDITABLE_BALANCE');

    const requestedIds = new Set();
    const creditItems = [];
    for (const requested of payload.items) {
      const sourceItemId = parseId(requested?.invoiceItemId);
      const quantityMillis = parseQuantityMillis(requested?.quantity);
      if (!sourceItemId || !quantityMillis || requestedIds.has(sourceItemId)) {
        throw new Error('INVALID_CREDIT_NOTE');
      }
      requestedIds.add(sourceItemId);
      const source = await getOne(
        `SELECT id, item_name, description, quantity_millis, subtotal_cents,
           discount_cents, tax_cents, total_cents
         FROM invoice_items
         WHERE id = ? AND business_id = ? AND invoice_id = ?
         FOR UPDATE`,
        [sourceItemId, businessId, invoiceId],
        connection
      );
      if (!source) throw new Error('INVALID_CREDIT_ITEM');
      const credited = await getOne(
        `SELECT COALESCE(SUM(quantity_millis), 0) AS quantity_millis,
           COALESCE(SUM(subtotal_cents), 0) AS subtotal_cents,
           COALESCE(SUM(discount_cents), 0) AS discount_cents,
           COALESCE(SUM(tax_cents), 0) AS tax_cents,
           COALESCE(SUM(total_cents), 0) AS total_cents
         FROM invoice_credit_items
         WHERE business_id = ? AND invoice_item_id = ?`,
        [businessId, sourceItemId],
        connection
      );
      const remainingQuantity = Number(source.quantity_millis) -
        Number(credited.quantity_millis);
      if (quantityMillis > remainingQuantity) throw new Error('CREDIT_EXCEEDS_ITEM');
      const item = {
        invoiceItemId: sourceItemId,
        itemName: source.item_name,
        description: source.description,
        quantityMillis,
      };
      for (const field of ['subtotal_cents', 'discount_cents', 'tax_cents', 'total_cents']) {
        const remaining = Number(source[field]) - Number(credited[field]);
        item[field] = allocateAmount(remaining, quantityMillis, remainingQuantity);
      }
      creditItems.push(item);
    }

    const totals = creditItems.reduce((sum, item) => ({
      subtotal: sum.subtotal + item.subtotal_cents,
      discount: sum.discount + item.discount_cents,
      tax: sum.tax + item.tax_cents,
      total: sum.total + item.total_cents,
    }), { subtotal: 0, discount: 0, tax: 0, total: 0 });
    if (!Number.isSafeInteger(totals.total) || totals.total <= 0) {
      throw new Error('INVALID_CREDIT_NOTE');
    }
    if (totals.total > availableCents) throw new Error('CREDIT_EXCEEDS_BALANCE');

    const year = Number(payload.creditDate.slice(0, 4));
    const creditNumber = await nextNumber(
      'credit_note_sequences',
      businessId,
      year,
      connection
    );
    const result = await execute(
      `INSERT INTO invoice_credit_notes
       (business_id, invoice_id, credit_number, credit_date, reason,
        subtotal_cents, discount_cents, tax_cents, total_cents, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        businessId,
        invoiceId,
        creditNumber,
        payload.creditDate,
        payload.reason.trim(),
        totals.subtotal,
        totals.discount,
        totals.tax,
        totals.total,
        userId,
      ],
      connection
    );
    for (const item of creditItems) {
      await execute(
        `INSERT INTO invoice_credit_items
         (business_id, credit_note_id, invoice_item_id, item_name, description,
          quantity_millis, subtotal_cents, discount_cents, tax_cents, total_cents)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          businessId,
          result.insertId,
          item.invoiceItemId,
          item.itemName,
          item.description,
          item.quantityMillis,
          item.subtotal_cents,
          item.discount_cents,
          item.tax_cents,
          item.total_cents,
        ],
        connection
      );
    }

    const paidAfter = Number(priorTotals.paid_cents);
    const creditedAfter = Number(priorCredits.credited_cents) + totals.total;
    const updatedStatus = creditedAfter >= Number(invoice.total_cents)
      ? 'credited'
      : paidAfter >= Number(invoice.total_cents) - creditedAfter
        ? 'paid'
        : paidAfter > 0 ? 'partially_paid' : invoice.status;
    await execute(
      'UPDATE invoices SET status = ? WHERE id = ? AND business_id = ?',
      [updatedStatus, invoiceId, businessId],
      connection
    );
    await execute(
      `INSERT INTO invoice_audit_events
       (business_id, invoice_id, user_id, action, details)
       VALUES (?, ?, ?, 'credit_note_created', ?)`,
      [
        businessId,
        invoiceId,
        userId,
        JSON.stringify({ creditNumber, totalCents: totals.total, reason: payload.reason.trim() }),
      ],
      connection
    );
    return result.insertId;
  });

  return getCreditNote({ businessId, userId, creditId });
}

async function getCreditNote({ businessId, userId, creditId }) {
  await assertMembership(businessId, userId);
  const note = await getOne(
    `SELECT c.*, i.invoice_number, i.customer_name, i.customer_email, i.currency,
       b.name AS business_name
     FROM invoice_credit_notes c
     JOIN invoices i ON i.id = c.invoice_id AND i.business_id = c.business_id
     JOIN businesses b ON b.id = c.business_id
     WHERE c.business_id = ? AND c.id = ?`,
    [businessId, creditId]
  );
  if (!note) return null;
  note.subtotal_cents = Number(note.subtotal_cents);
  note.discount_cents = Number(note.discount_cents);
  note.tax_cents = Number(note.tax_cents);
  note.total_cents = Number(note.total_cents);
  note.items = await getMany(
    `SELECT id, invoice_item_id, item_name, description, quantity_millis,
       subtotal_cents, discount_cents, tax_cents, total_cents
     FROM invoice_credit_items
     WHERE business_id = ? AND credit_note_id = ?
     ORDER BY id`,
    [businessId, creditId]
  );
  note.items = note.items.map((item) => ({
    ...item,
    quantity_millis: Number(item.quantity_millis),
    subtotal_cents: Number(item.subtotal_cents),
    discount_cents: Number(item.discount_cents),
    tax_cents: Number(item.tax_cents),
    total_cents: Number(item.total_cents),
  }));
  return note;
}

async function getCustomerFinancials({ businessId, userId, customerId }) {
  await assertMembership(businessId, userId);
  const today = await getBusinessToday(businessId);
  const customer = await getOne(
    `SELECT id, name, email, phone, created_at
     FROM customers WHERE id = ? AND business_id = ?`,
    [customerId, businessId]
  );
  if (!customer) return null;
  const invoices = await getMany(
    `SELECT i.id, i.invoice_number, i.invoice_date, i.due_date, i.status,
       i.total_cents, i.currency,
       COALESCE(p.paid_cents, 0) AS paid_cents,
       COALESCE(c.credited_cents, 0) AS credited_cents,
       GREATEST(i.total_cents - COALESCE(p.paid_cents, 0) -
         COALESCE(c.credited_cents, 0), 0) AS outstanding_cents,
       CASE WHEN i.status IN ('issued', 'sent', 'partially_paid')
         AND i.due_date < ?
         AND i.total_cents > COALESCE(p.paid_cents, 0) + COALESCE(c.credited_cents, 0)
         THEN 'overdue' ELSE i.status END AS display_status
     FROM invoices i
     LEFT JOIN (
       SELECT invoice_id, business_id, SUM(amount_cents) AS paid_cents
       FROM invoice_payments GROUP BY business_id, invoice_id
     ) p ON p.business_id = i.business_id AND p.invoice_id = i.id
     LEFT JOIN (
       SELECT invoice_id, business_id, SUM(total_cents) AS credited_cents
       FROM invoice_credit_notes GROUP BY business_id, invoice_id
     ) c ON c.business_id = i.business_id AND c.invoice_id = i.id
     WHERE i.business_id = ? AND i.customer_id = ?
       AND i.status NOT IN ('draft', 'cancelled')
     ORDER BY i.invoice_date DESC, i.id DESC`,
    [today, businessId, customerId]
  );
  const invoiceStats = invoices.reduce((sum, invoice) => {
    if (invoice.status === 'cancelled' || invoice.status === 'draft') return sum;
    sum.totalInvoicedCents += Number(invoice.total_cents);
    sum.totalPaidCents += Number(invoice.paid_cents);
    sum.outstandingCents += Number(invoice.outstanding_cents);
    if (invoice.display_status === 'overdue') sum.overdueCents += Number(invoice.outstanding_cents);
    return sum;
  }, { totalInvoicedCents: 0, totalPaidCents: 0, outstandingCents: 0, overdueCents: 0 });

  const [payments, credits] = await Promise.all([
    getMany(
      `SELECT p.id, p.invoice_id, p.receipt_number, p.amount_cents, p.payment_date,
         p.payment_method, p.reference, i.invoice_number
       FROM invoice_payments p
       JOIN invoices i ON i.id = p.invoice_id AND i.business_id = p.business_id
       WHERE p.business_id = ? AND i.customer_id = ?
       ORDER BY p.payment_date DESC, p.id DESC`,
      [businessId, customerId]
    ),
    getMany(
      `SELECT c.id, c.invoice_id, c.credit_number, c.credit_date, c.reason, c.total_cents,
         i.invoice_number
       FROM invoice_credit_notes c
       JOIN invoices i ON i.id = c.invoice_id AND i.business_id = c.business_id
       WHERE c.business_id = ? AND i.customer_id = ?
       ORDER BY c.credit_date DESC, c.id DESC`,
      [businessId, customerId]
    ),
  ]);
  return {
    customer,
    summary: invoiceStats,
    invoices: invoices.map((invoice) => ({
      ...invoice,
      total_cents: Number(invoice.total_cents),
      paid_cents: Number(invoice.paid_cents),
      credited_cents: Number(invoice.credited_cents),
      outstanding_cents: Number(invoice.outstanding_cents),
    })),
    payments: payments.map((payment) => ({ ...payment, amount_cents: Number(payment.amount_cents) })),
    creditNotes: credits.map((credit) => ({ ...credit, total_cents: Number(credit.total_cents) })),
  };
}

async function getCustomerStatement({ businessId, userId, customerId, startDate, endDate }) {
  await assertMembership(businessId, userId);
  const customer = await getOne(
    'SELECT id, name, email, phone FROM customers WHERE id = ? AND business_id = ?',
    [customerId, businessId]
  );
  if (!customer) return null;
  if (!isValidDate(startDate) || !isValidDate(endDate) || startDate > endDate) {
    throw new Error('INVALID_STATEMENT_RANGE');
  }
  const range = (operator) => `${operator} ?`;
  const opening = await getOne(
    `SELECT
       COALESCE((SELECT SUM(total_cents) FROM invoices
         WHERE business_id = ? AND customer_id = ? AND status NOT IN ('draft', 'cancelled')
           AND invoice_date < ?), 0)
       - COALESCE((SELECT SUM(p.amount_cents) FROM invoice_payments p
         JOIN invoices i ON i.id = p.invoice_id AND i.business_id = p.business_id
         WHERE p.business_id = ? AND i.customer_id = ? AND p.payment_date < ?), 0)
       - COALESCE((SELECT SUM(c.total_cents) FROM invoice_credit_notes c
         JOIN invoices i ON i.id = c.invoice_id AND i.business_id = c.business_id
         WHERE c.business_id = ? AND i.customer_id = ? AND c.credit_date < ?), 0)
       AS opening_balance_cents`,
    [businessId, customerId, startDate, businessId, customerId, startDate, businessId, customerId, startDate]
  );
  const events = await getMany(
    `SELECT transaction_date, type, record_id, reference, description, debit_cents, credit_cents
     FROM (
       SELECT i.invoice_date AS transaction_date, 'invoice' AS type, i.id AS record_id,
         i.invoice_number AS reference, 'Customer invoice issued' AS description,
         i.total_cents AS debit_cents, 0 AS credit_cents
       FROM invoices i
       WHERE i.business_id = ? AND i.customer_id = ?
         AND i.status NOT IN ('draft', 'cancelled')
         AND i.invoice_date >= ${range('')} AND i.invoice_date <= ?
       UNION ALL
       SELECT p.payment_date, 'payment', p.id, p.receipt_number,
         CONCAT('Payment received for ', i.invoice_number), 0, p.amount_cents
       FROM invoice_payments p
       JOIN invoices i ON i.id = p.invoice_id AND i.business_id = p.business_id
       WHERE p.business_id = ? AND i.customer_id = ?
         AND p.payment_date >= ? AND p.payment_date <= ?
       UNION ALL
       SELECT c.credit_date, 'credit_note', c.id, c.credit_number,
         CONCAT('Credit note for ', i.invoice_number), 0, c.total_cents
       FROM invoice_credit_notes c
       JOIN invoices i ON i.id = c.invoice_id AND i.business_id = c.business_id
       WHERE c.business_id = ? AND i.customer_id = ?
         AND c.credit_date >= ? AND c.credit_date <= ?
     ) statement_events
     ORDER BY transaction_date, type, record_id`,
    [
      businessId, customerId, startDate, endDate,
      businessId, customerId, startDate, endDate,
      businessId, customerId, startDate, endDate,
    ]
  );
  let balance = Number(opening.opening_balance_cents);
  const rows = events.map((event) => {
    const debit = Number(event.debit_cents);
    const credit = Number(event.credit_cents);
    balance += debit - credit;
    return { ...event, debit_cents: debit, credit_cents: credit, balance_cents: balance };
  });
  return {
    customer,
    range: { startDate, endDate },
    openingBalanceCents: Number(opening.opening_balance_cents),
    closingBalanceCents: balance,
    rows,
  };
}

async function getReceivablesSummary(businessId, userId) {
  await assertMembership(businessId, userId);
  const today = await getBusinessToday(businessId);
  const monthStart = `${today.slice(0, 7)}-01`;
  const [summary, payments] = await Promise.all([
    getOne(
      `SELECT
         COUNT(CASE WHEN i.status NOT IN ('draft', 'cancelled') THEN 1 END) AS invoice_count,
         COALESCE(SUM(CASE WHEN i.status NOT IN ('draft', 'cancelled')
           THEN GREATEST(i.total_cents - COALESCE(p.paid_cents, 0)
             - COALESCE(c.credited_cents, 0), 0) ELSE 0 END), 0) AS outstanding_cents,
         COUNT(CASE WHEN i.status NOT IN ('draft', 'cancelled')
           AND i.due_date < ? AND i.total_cents > COALESCE(p.paid_cents, 0)
             + COALESCE(c.credited_cents, 0) THEN 1 END) AS overdue_count,
         COALESCE(SUM(CASE WHEN i.status NOT IN ('draft', 'cancelled')
           AND i.due_date < ? THEN GREATEST(i.total_cents - COALESCE(p.paid_cents, 0)
             - COALESCE(c.credited_cents, 0), 0) ELSE 0 END), 0) AS overdue_cents,
         COUNT(CASE WHEN i.status NOT IN ('draft', 'cancelled')
           AND COALESCE(p.paid_cents, 0) > 0
           AND i.total_cents > COALESCE(p.paid_cents, 0) + COALESCE(c.credited_cents, 0)
           THEN 1 END) AS partially_paid_count
       FROM invoices i
       LEFT JOIN (
         SELECT business_id, invoice_id, SUM(amount_cents) AS paid_cents
         FROM invoice_payments GROUP BY business_id, invoice_id
       ) p ON p.business_id = i.business_id AND p.invoice_id = i.id
       LEFT JOIN (
         SELECT business_id, invoice_id, SUM(total_cents) AS credited_cents
         FROM invoice_credit_notes GROUP BY business_id, invoice_id
       ) c ON c.business_id = i.business_id AND c.invoice_id = i.id
       WHERE i.business_id = ?`,
      [today, today, businessId]
    ),
    getOne(
      `SELECT COALESCE(SUM(amount_cents), 0) AS paid_cents
       FROM invoice_payments
       WHERE business_id = ? AND payment_date >= ? AND payment_date <= ?`,
      [businessId, monthStart, today]
    ),
  ]);
  return {
    invoiceCount: Number(summary.invoice_count),
    outstandingCents: Number(summary.outstanding_cents),
    overdueCount: Number(summary.overdue_count),
    overdueCents: Number(summary.overdue_cents),
    partiallyPaidCount: Number(summary.partially_paid_count),
    paymentsThisMonthCents: Number(payments.paid_cents),
  };
}

function csvCell(value) {
  let text = String(value ?? '');
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function customerStatementCsv(statement, currency) {
  const headings = ['Date', 'Type', 'Reference', 'Description', 'Debit cents', 'Credit cents', 'Balance cents'];
  return [
    ['Customer statement', statement.customer.name],
    ['Date range', `${statement.range.startDate} to ${statement.range.endDate}`],
    ['Currency', currency],
    [],
    headings,
    ...statement.rows.map((row) => [
      row.transaction_date,
      row.type,
      row.reference,
      row.description,
      row.debit_cents,
      row.credit_cents,
      row.balance_cents,
    ]),
    ['Opening balance', '', '', '', '', '', statement.openingBalanceCents],
    ['Closing balance', '', '', '', '', '', statement.closingBalanceCents],
  ].map((row) => row.map(csvCell).join(',')).join('\r\n');
}

module.exports = {
  createCreditNote,
  customerStatementCsv,
  getCreditNote,
  getCustomerFinancials,
  getCustomerStatement,
  getReceivablesSummary,
  getReceipt,
  nextNumber,
  withTransaction,
};
