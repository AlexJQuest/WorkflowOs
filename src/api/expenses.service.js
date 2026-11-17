const db = require('./database');

const DEFAULT_CATEGORIES = [
  'Rent',
  'Utilities',
  'Salaries and wages',
  'Stock purchases',
  'Transport and fuel',
  'Marketing and advertising',
  'Internet and telecommunications',
  'Equipment',
  'Repairs and maintenance',
  'Insurance',
  'Bank charges',
  'Professional services',
  'Software and subscriptions',
  'Other',
];

const EXPENSE_FIELDS = `
  e.id,
  e.business_id,
  e.category_id,
  c.name AS category_name,
  e.supplier_id,
  s.name AS supplier_name,
  e.recurring_expense_id,
  e.title,
  e.description,
  e.reference_number,
  e.expense_date,
  e.due_date,
  e.subtotal_cents,
  e.tax_cents,
  e.total_cents,
  e.currency,
  e.status,
  e.notes,
  e.created_at,
  e.updated_at,
  COALESCE(payments.paid_cents, 0) AS paid_cents
`;

const PAYMENT_TOTALS_JOIN = `
  LEFT JOIN (
    SELECT business_id, expense_id, SUM(amount_cents) AS paid_cents
    FROM expense_payments
    GROUP BY business_id, expense_id
  ) payments
    ON payments.business_id = e.business_id
    AND payments.expense_id = e.id
`;

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
    try {
      await connection.rollback();
    } catch (rollbackError) {
      console.error('Expense transaction rollback failed:', rollbackError.message);
    }

    throw error;
  } finally {
    connection.release();
  }
}

function isValidDate(value, nullable = false) {
  if (nullable && (value === null || value === undefined || value === '')) {
    return true;
  }

  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function toOptionalId(value) {
  if (value === null || value === undefined || value === '') return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : NaN;
}

function normalizeText(value, maxLength) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text.slice(0, maxLength) : null;
}

function dateOnly(value) {
  if (!value) return null;
  return value instanceof Date
    ? value.toISOString().slice(0, 10)
    : String(value).slice(0, 10);
}

async function getBusinessToday(businessId) {
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
  const values = Object.fromEntries(
    parts.filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function effectiveStatus(expense, today = new Date().toISOString().slice(0, 10)) {
  if (expense.status === 'cancelled' || expense.status === 'draft') {
    return expense.status;
  }

  const paidCents = Number(expense.paid_cents || 0);
  if (paidCents >= Number(expense.total_cents)) return 'paid';
  const dueDate = dateOnly(expense.due_date);
  if (paidCents > 0) return dueDate && dueDate < today
    ? 'overdue'
    : 'partially_paid';
  return dueDate && dueDate < today ? 'overdue' : 'unpaid';
}

function serializeExpense(row, today = new Date().toISOString().slice(0, 10)) {
  if (!row) return null;
  const paidCents = Number(row.paid_cents || 0);

  return {
    ...row,
    subtotal_cents: Number(row.subtotal_cents),
    tax_cents: Number(row.tax_cents),
    total_cents: Number(row.total_cents),
    expense_date: dateOnly(row.expense_date),
    due_date: dateOnly(row.due_date),
    paid_cents: paidCents,
    outstanding_cents: Math.max(0, Number(row.total_cents) - paidCents),
    status: effectiveStatus(row, today),
  };
}

async function ensureMembership(businessId, userId, connection = db) {
  const membership = await getOne(
    `SELECT id FROM business_memberships
     WHERE business_id = ? AND user_id = ?`,
    [businessId, userId],
    connection
  );

  if (!membership) throw new Error('FORBIDDEN');
}

async function ensureDefaultCategories(businessId) {
  for (const name of DEFAULT_CATEGORIES) {
    await execute(
      `INSERT IGNORE INTO expense_categories
       (business_id, name, is_system)
       VALUES (?, ?, 1)`,
      [businessId, name]
    );
  }
}

async function validateExpenseRelations(businessId, categoryId, supplierId, connection) {
  if (Number.isNaN(categoryId) || Number.isNaN(supplierId)) {
    throw new Error('INVALID_EXPENSE');
  }

  if (categoryId && !(await getOne(
    `SELECT id FROM expense_categories
     WHERE id = ? AND business_id = ? AND is_active = 1`,
    [categoryId, businessId],
    connection
  ))) {
    throw new Error('INVALID_CATEGORY');
  }

  if (supplierId && !(await getOne(
    `SELECT id FROM expense_suppliers
     WHERE id = ? AND business_id = ? AND is_active = 1`,
    [supplierId, businessId],
    connection
  ))) {
    throw new Error('INVALID_SUPPLIER');
  }
}

async function getExpenseRow(businessId, expenseId, connection = db, lock = false) {
  if (lock) {
    const locked = await getOne(
      'SELECT id FROM expenses WHERE business_id = ? AND id = ? FOR UPDATE',
      [businessId, expenseId],
      connection
    );
    if (!locked) return null;
  }

  return getOne(
    `SELECT ${EXPENSE_FIELDS}
     FROM expenses e
     LEFT JOIN expense_categories c
       ON c.id = e.category_id AND c.business_id = e.business_id
     LEFT JOIN expense_suppliers s
       ON s.id = e.supplier_id AND s.business_id = e.business_id
     ${PAYMENT_TOTALS_JOIN}
     WHERE e.business_id = ? AND e.id = ?`,
    [businessId, expenseId],
    connection
  );
}

async function getExpenseCategories(businessId) {
  await ensureDefaultCategories(businessId);
  return getMany(
    `SELECT id, name, is_system, is_active, created_at, updated_at
     FROM expense_categories
     WHERE business_id = ?
     ORDER BY is_active DESC, is_system DESC, name ASC`,
    [businessId]
  );
}

async function createExpenseCategory({ businessId, userId, name }) {
  await ensureMembership(businessId, userId);
  const normalizedName = normalizeText(name, 100);
  if (!normalizedName) throw new Error('INVALID_CATEGORY');

  try {
    const result = await execute(
      `INSERT INTO expense_categories (business_id, name)
       VALUES (?, ?)`,
      [businessId, normalizedName]
    );
    return getOne(
      `SELECT id, name, is_system, is_active, created_at, updated_at
       FROM expense_categories WHERE id = ? AND business_id = ?`,
      [result.insertId, businessId]
    );
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY' || error.errno === 1062) {
      throw new Error('CATEGORY_EXISTS');
    }
    throw error;
  }
}

async function updateExpenseCategory({ businessId, userId, categoryId, name, isActive }) {
  await ensureMembership(businessId, userId);
  const normalizedName = normalizeText(name, 100);
  if (!Number.isSafeInteger(categoryId) || categoryId <= 0 ||
      !normalizedName || typeof isActive !== 'boolean') {
    throw new Error('INVALID_CATEGORY');
  }

  const existing = await getOne(
    'SELECT id FROM expense_categories WHERE id = ? AND business_id = ?',
    [categoryId, businessId]
  );
  if (!existing) throw new Error('CATEGORY_NOT_FOUND');

  try {
    await execute(
      `UPDATE expense_categories
       SET name = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND business_id = ?`,
      [normalizedName, isActive ? 1 : 0, categoryId, businessId]
    );
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY' || error.errno === 1062) {
      throw new Error('CATEGORY_EXISTS');
    }
    throw error;
  }

  return getOne(
    `SELECT id, name, is_system, is_active, created_at, updated_at
     FROM expense_categories WHERE id = ? AND business_id = ?`,
    [categoryId, businessId]
  );
}

async function getExpenseSuppliers(businessId) {
  return getMany(
    `SELECT id, name, email, phone, is_active, created_at, updated_at
     FROM expense_suppliers
     WHERE business_id = ?
     ORDER BY is_active DESC, name ASC`,
    [businessId]
  );
}

async function createExpenseSupplier({ businessId, userId, payload = {} }) {
  await ensureMembership(businessId, userId);
  const name = normalizeText(payload.name, 191);
  const email = normalizeText(payload.email, 191);
  const phone = normalizeText(payload.phone, 50);
  if (!name || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    throw new Error('INVALID_SUPPLIER');
  }

  const result = await execute(
    `INSERT INTO expense_suppliers (business_id, name, email, phone)
     VALUES (?, ?, ?, ?)`,
    [businessId, name, email, phone]
  );
  return getOne(
    `SELECT id, name, email, phone, is_active, created_at, updated_at
     FROM expense_suppliers WHERE id = ? AND business_id = ?`,
    [result.insertId, businessId]
  );
}

function buildExpenseFilters(businessId, filters) {
  const clauses = ['e.business_id = ?'];
  const params = [businessId];

  if (filters.startDate) {
    if (!isValidDate(filters.startDate)) throw new Error('INVALID_DATE_RANGE');
    clauses.push('e.expense_date >= ?');
    params.push(filters.startDate);
  }

  if (filters.endDate) {
    if (!isValidDate(filters.endDate)) throw new Error('INVALID_DATE_RANGE');
    clauses.push('e.expense_date <= ?');
    params.push(filters.endDate);
  }

  if (filters.startDate && filters.endDate && filters.startDate > filters.endDate) {
    throw new Error('INVALID_DATE_RANGE');
  }

  if (filters.categoryId) {
    const categoryId = Number(filters.categoryId);
    if (!Number.isSafeInteger(categoryId) || categoryId <= 0) {
      throw new Error('INVALID_EXPENSE_FILTER');
    }
    clauses.push('e.category_id = ?');
    params.push(categoryId);
  }

  if (filters.status) {
    const status = String(filters.status);
    const allowed = ['draft', 'unpaid', 'partially_paid', 'paid', 'overdue', 'cancelled'];
    if (!allowed.includes(status)) throw new Error('INVALID_EXPENSE_FILTER');

    if (status === 'overdue') {
      clauses.push(`e.status IN ('unpaid', 'partially_paid', 'overdue')
        AND e.due_date < CURRENT_DATE()`);
    } else {
      clauses.push(`CASE
        WHEN e.status IN ('unpaid', 'partially_paid')
          AND e.due_date < CURRENT_DATE() THEN 'overdue'
        ELSE e.status
      END = ?`);
      params.push(status);
    }
  } else if (filters.status !== 'cancelled') {
    clauses.push("e.status <> 'cancelled'");
  }

  if (filters.search) {
    const search = String(filters.search).trim().slice(0, 100);
    if (search) {
      clauses.push(`(e.title LIKE ? OR e.reference_number LIKE ?
        OR c.name LIKE ? OR s.name LIKE ?)`);
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }
  }

  return { where: clauses.join(' AND '), params };
}

async function listExpenses(businessId, filters = {}) {
  const { where, params } = buildExpenseFilters(businessId, filters);
  const page = Math.max(1, Number.parseInt(filters.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(filters.pageSize, 10) || 25));
  const orderBy = {
    date_asc: 'e.expense_date ASC, e.id ASC',
    amount_desc: 'e.total_cents DESC, e.expense_date DESC',
    amount_asc: 'e.total_cents ASC, e.expense_date DESC',
    title_asc: 'e.title ASC, e.id DESC',
  }[filters.sort] || 'e.expense_date DESC, e.id DESC';

  const [rows, count] = await Promise.all([
    getMany(
      `SELECT ${EXPENSE_FIELDS}
       FROM expenses e
       LEFT JOIN expense_categories c
         ON c.id = e.category_id AND c.business_id = e.business_id
       LEFT JOIN expense_suppliers s
         ON s.id = e.supplier_id AND s.business_id = e.business_id
       ${PAYMENT_TOTALS_JOIN}
       WHERE ${where}
       ORDER BY ${orderBy}
       LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize]
    ),
    getOne(
      `SELECT COUNT(*) AS total
       FROM expenses e
       LEFT JOIN expense_categories c
         ON c.id = e.category_id AND c.business_id = e.business_id
       LEFT JOIN expense_suppliers s
         ON s.id = e.supplier_id AND s.business_id = e.business_id
       WHERE ${where}`,
      params
    ),
  ]);

  const today = await getBusinessToday(businessId);
  return {
    expenses: rows.map((row) => serializeExpense(row, today)),
    page,
    pageSize,
    total: Number(count?.total || 0),
  };
}

async function getExpenseDetails(businessId, expenseId) {
  const row = await getExpenseRow(businessId, expenseId);
  if (!row) return null;
  const today = await getBusinessToday(businessId);
  const payments = await getMany(
    `SELECT id, amount_cents, payment_date, payment_method, reference, notes, created_at
     FROM expense_payments
     WHERE business_id = ? AND expense_id = ?
     ORDER BY payment_date DESC, id DESC`,
    [businessId, expenseId]
  );
  return { ...serializeExpense(row, today), payments };
}

async function createExpense({ businessId, userId, payload = {} }) {
  await ensureMembership(businessId, userId);
  const title = normalizeText(payload.title, 191);
  const categoryId = toOptionalId(payload.categoryId);
  const supplierId = toOptionalId(payload.supplierId);
  const subtotalCents = payload.subtotalCents;
  const taxCents = payload.taxCents ?? 0;
  const expenseDate = payload.expenseDate;
  const dueDate = payload.dueDate || null;

  if (!title || !isValidDate(expenseDate) || !isValidDate(dueDate, true) ||
      !Number.isSafeInteger(subtotalCents) || subtotalCents < 0 ||
      !Number.isSafeInteger(taxCents) || taxCents < 0 ||
      !Number.isSafeInteger(subtotalCents + taxCents) ||
      subtotalCents + taxCents <= 0 ||
      !['draft', 'unpaid'].includes(payload.status || 'unpaid')) {
    throw new Error('INVALID_EXPENSE');
  }

  await validateExpenseRelations(businessId, categoryId, supplierId);
  const business = await getOne('SELECT currency FROM businesses WHERE id = ?', [businessId]);
  if (!business) throw new Error('INVALID_BUSINESS');

  const result = await execute(
    `INSERT INTO expenses
     (business_id, category_id, supplier_id, title, description,
      reference_number, expense_date, due_date, subtotal_cents, tax_cents,
      total_cents, currency, status, notes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      businessId,
      categoryId,
      supplierId,
      title,
      normalizeText(payload.description, 10000),
      normalizeText(payload.referenceNumber, 100),
      expenseDate,
      dueDate,
      subtotalCents,
      taxCents,
      subtotalCents + taxCents,
      business.currency || 'ZAR',
      payload.status || 'unpaid',
      normalizeText(payload.notes, 10000),
      userId,
    ]
  );

  return getExpenseDetails(businessId, result.insertId);
}

async function updateExpense({ businessId, userId, expenseId, payload = {} }) {
  await ensureMembership(businessId, userId);
  if (!Number.isSafeInteger(expenseId) || expenseId <= 0) {
    throw new Error('INVALID_EXPENSE');
  }

  await withTransaction(async (connection) => {
    const expense = await getExpenseRow(businessId, expenseId, connection, true);
    if (!expense) throw new Error('EXPENSE_NOT_FOUND');
    if (expense.status === 'cancelled') throw new Error('EXPENSE_NOT_EDITABLE');

    const paymentCount = await getOne(
      `SELECT COUNT(*) AS total FROM expense_payments
       WHERE business_id = ? AND expense_id = ?`,
      [businessId, expenseId],
      connection
    );

    const title = normalizeText(payload.title, 191);
    const categoryId = payload.categoryId === undefined
      ? expense.category_id
      : toOptionalId(payload.categoryId);
    const supplierId = payload.supplierId === undefined
      ? expense.supplier_id
      : toOptionalId(payload.supplierId);
    const expenseDate = payload.expenseDate ?? dateOnly(expense.expense_date);
    const dueDate = payload.dueDate === undefined ? dateOnly(expense.due_date) : payload.dueDate || null;
    const subtotalCents = payload.subtotalCents ?? Number(expense.subtotal_cents);
    const taxCents = payload.taxCents ?? Number(expense.tax_cents);
    const amountsChanged = subtotalCents !== Number(expense.subtotal_cents) ||
      taxCents !== Number(expense.tax_cents);

    if (!title || !isValidDate(expenseDate) || !isValidDate(dueDate, true) ||
        !Number.isSafeInteger(subtotalCents) || subtotalCents < 0 ||
        !Number.isSafeInteger(taxCents) || taxCents < 0 ||
        !Number.isSafeInteger(subtotalCents + taxCents) ||
        subtotalCents + taxCents <= 0 ||
        (payload.status !== undefined && !['draft', 'unpaid'].includes(payload.status)) ||
        (Number(paymentCount.total) > 0 && payload.status !== undefined) ||
        (Number(paymentCount.total) > 0 && amountsChanged)) {
      throw new Error('INVALID_EXPENSE');
    }

    await validateExpenseRelations(businessId, categoryId, supplierId, connection);
    await execute(
      `UPDATE expenses
       SET category_id = ?, supplier_id = ?, title = ?, description = ?,
           reference_number = ?, expense_date = ?, due_date = ?,
           subtotal_cents = ?, tax_cents = ?, total_cents = ?,
           status = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND business_id = ?`,
      [
        categoryId,
        supplierId,
        title,
        normalizeText(payload.description === undefined ? expense.description : payload.description, 10000),
        normalizeText(payload.referenceNumber === undefined ? expense.reference_number : payload.referenceNumber, 100),
        expenseDate,
        dueDate,
        subtotalCents,
        taxCents,
        subtotalCents + taxCents,
        payload.status ?? expense.status,
        normalizeText(payload.notes === undefined ? expense.notes : payload.notes, 10000),
        expenseId,
        businessId,
      ],
      connection
    );
  });

  return getExpenseDetails(businessId, expenseId);
}

async function cancelExpense({ businessId, userId, expenseId }) {
  await ensureMembership(businessId, userId);
  const result = await execute(
    `UPDATE expenses e
     SET e.status = 'cancelled', e.updated_at = CURRENT_TIMESTAMP
     WHERE e.id = ? AND e.business_id = ?
       AND e.status <> 'cancelled'
       AND NOT EXISTS (
         SELECT 1 FROM expense_payments p
         WHERE p.business_id = e.business_id AND p.expense_id = e.id
       )`,
    [expenseId, businessId]
  );

  if (!result.affectedRows) {
    const expense = await getOne(
      'SELECT status FROM expenses WHERE id = ? AND business_id = ?',
      [expenseId, businessId]
    );
    if (!expense) throw new Error('EXPENSE_NOT_FOUND');
    throw new Error('EXPENSE_NOT_CANCELLABLE');
  }

  return getExpenseDetails(businessId, expenseId);
}

async function getExpensePayments(businessId, expenseId) {
  const expense = await getOne(
    'SELECT id FROM expenses WHERE id = ? AND business_id = ?',
    [expenseId, businessId]
  );
  if (!expense) return null;
  return getMany(
    `SELECT id, amount_cents, payment_date, payment_method, reference, notes, created_at
     FROM expense_payments
     WHERE business_id = ? AND expense_id = ?
     ORDER BY payment_date DESC, id DESC`,
    [businessId, expenseId]
  );
}

async function recordExpensePayment({
  businessId,
  userId,
  expenseId,
  payload = {},
  idempotencyKey,
}) {
  await ensureMembership(businessId, userId);
  const amountCents = payload.amountCents;
  const paymentDate = payload.paymentDate || await getBusinessToday(businessId);
  const today = await getBusinessToday(businessId);
  const paymentMethod = normalizeText(payload.paymentMethod, 40);
  const key = normalizeText(idempotencyKey, 191);
  if (!Number.isSafeInteger(expenseId) || expenseId <= 0 ||
      !Number.isSafeInteger(amountCents) || amountCents <= 0 ||
      !isValidDate(paymentDate) || !paymentMethod || !key) {
    throw new Error('INVALID_PAYMENT');
  }

  let replayed = false;
  try {
    await withTransaction(async (connection) => {
      const prior = await getOne(
        `SELECT id, expense_id, amount_cents, payment_date, payment_method, reference
         FROM expense_payments
         WHERE business_id = ? AND idempotency_key = ?
         FOR UPDATE`,
        [businessId, key],
        connection
      );

      if (prior) {
        if (Number(prior.expense_id) !== expenseId ||
            Number(prior.amount_cents) !== amountCents ||
            dateOnly(prior.payment_date) !== paymentDate ||
            prior.payment_method !== paymentMethod ||
            prior.reference !== normalizeText(payload.reference, 100)) {
          throw new Error('IDEMPOTENCY_CONFLICT');
        }
        replayed = true;
        return;
      }

      const expense = await getExpenseRow(businessId, expenseId, connection, true);
      if (!expense) throw new Error('EXPENSE_NOT_FOUND');
      if (['cancelled', 'draft'].includes(expense.status)) {
        throw new Error('EXPENSE_NOT_PAYABLE');
      }

      const outstandingCents = Number(expense.total_cents) - Number(expense.paid_cents || 0);
      if (amountCents > outstandingCents) throw new Error('PAYMENT_EXCEEDS_BALANCE');

      await execute(
        `INSERT INTO expense_payments
         (business_id, expense_id, amount_cents, payment_date,
          payment_method, reference, notes, idempotency_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          businessId,
          expenseId,
          amountCents,
          paymentDate,
          paymentMethod,
          normalizeText(payload.reference, 100),
          normalizeText(payload.notes, 10000),
          key,
        ],
        connection
      );

      const paidCents = Number(expense.paid_cents || 0) + amountCents;
      const status = paidCents >= Number(expense.total_cents)
        ? 'paid'
        : expense.due_date && dateOnly(expense.due_date) < today
          ? 'overdue'
          : 'partially_paid';

      await execute(
        `UPDATE expenses
         SET status = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND business_id = ?`,
        [status, expenseId, businessId],
        connection
      );
    });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY' || error.errno === 1062) {
      const prior = await getOne(
        `SELECT expense_id, amount_cents, payment_date, payment_method, reference
         FROM expense_payments
         WHERE business_id = ? AND idempotency_key = ?`,
        [businessId, key]
      );

      if (prior &&
          Number(prior.expense_id) === expenseId &&
          Number(prior.amount_cents) === amountCents &&
          dateOnly(prior.payment_date) === paymentDate &&
          prior.payment_method === paymentMethod &&
          prior.reference === normalizeText(payload.reference, 100)) {
        return {
          expense: await getExpenseDetails(businessId, expenseId),
          replayed: true,
        };
      }
    }

    throw error;
  }

  return {
    expense: await getExpenseDetails(businessId, expenseId),
    replayed,
  };
}

async function getExpenseSummary(businessId) {
  const rows = await getMany(
    `SELECT ${EXPENSE_FIELDS}
     FROM expenses e
     LEFT JOIN expense_categories c
       ON c.id = e.category_id AND c.business_id = e.business_id
     LEFT JOIN expense_suppliers s
       ON s.id = e.supplier_id AND s.business_id = e.business_id
     ${PAYMENT_TOTALS_JOIN}
     WHERE e.business_id = ? AND e.status <> 'cancelled'`,
    [businessId]
  );

  const today = await getBusinessToday(businessId);
  const monthStart = `${today.slice(0, 7)}-01`;
  const previousMonthDate = new Date(`${monthStart}T00:00:00.000Z`);
  previousMonthDate.setUTCMonth(previousMonthDate.getUTCMonth() - 1);
  const previousMonthStart = previousMonthDate.toISOString().slice(0, 10);
  const yearStart = `${today.slice(0, 4)}-01-01`;
  const expenses = rows
    .map((row) => serializeExpense(row, today))
    .filter((expense) => expense.status !== 'draft');
  const sum = (items) => items.reduce((total, item) => total + item.total_cents, 0);
  const thisMonth = expenses.filter((item) => item.expense_date >= monthStart && item.expense_date <= today);
  const lastMonth = expenses.filter((item) => item.expense_date >= previousMonthStart && item.expense_date < monthStart);
  const thisYear = expenses.filter((item) => item.expense_date >= yearStart && item.expense_date <= today);
  const categoryTotals = new Map();

  for (const expense of expenses) {
    const key = expense.category_name || 'Uncategorised';
    categoryTotals.set(key, (categoryTotals.get(key) || 0) + expense.total_cents);
  }

  const largestCategory = [...categoryTotals.entries()]
    .sort((left, right) => right[1] - left[1])[0] || null;
  const recurringRows = await getMany(
    `SELECT frequency, SUM(subtotal_cents + tax_cents) AS amount_cents
     FROM recurring_expenses
     WHERE business_id = ? AND is_active = 1
     GROUP BY frequency`,
    [businessId]
  );
  const monthlyCommitmentCents = recurringRows.reduce((total, row) => {
    const amount = Number(row.amount_cents);
    const multiplier = {
      weekly: 52 / 12,
      monthly: 1,
      quarterly: 1 / 3,
      annually: 1 / 12,
    }[row.frequency];
    return total + Math.round(amount * multiplier);
  }, 0);
  const lastMonthCents = sum(lastMonth);

  return {
    thisMonthCents: sum(thisMonth),
    lastMonthCents,
    monthChangePct: lastMonthCents
      ? Math.round(((sum(thisMonth) - lastMonthCents) / lastMonthCents) * 10000) / 100
      : null,
    thisYearCents: sum(thisYear),
    averageMonthlyCents: Math.round(sum(thisYear) / Math.max(1, Number(today.slice(5, 7)))),
    paidCents: expenses.filter((item) => item.status === 'paid')
      .reduce((total, item) => total + item.paid_cents, 0),
    unpaidCents: expenses.filter((item) => ['unpaid', 'overdue'].includes(item.status))
      .reduce((total, item) => total + item.outstanding_cents, 0),
    partiallyPaidCents: expenses.filter((item) => item.status === 'partially_paid')
      .reduce((total, item) => total + item.outstanding_cents, 0),
    overdueCount: expenses.filter((item) => item.status === 'overdue').length,
    outstandingCents: expenses.reduce((total, item) => total + item.outstanding_cents, 0),
    largestCategory: largestCategory
      ? { name: largestCategory[0], amountCents: largestCategory[1] }
      : null,
    largestExpense: expenses.sort((left, right) => right.total_cents - left.total_cents)[0] || null,
    recurringMonthlyCommitmentsCents: monthlyCommitmentCents,
    expensesByCategory: [...categoryTotals.entries()]
      .map(([name, amountCents]) => ({ name, amountCents }))
      .sort((left, right) => right.amountCents - left.amountCents),
  };
}

function addRecurrenceDate(value, frequency, anchor) {
  const date = new Date(`${value}T00:00:00.000Z`);
  const anchorDay = Number(anchor.slice(8, 10));
  if (frequency === 'weekly') {
    date.setUTCDate(date.getUTCDate() + 7);
    return date.toISOString().slice(0, 10);
  }

  const monthStep = frequency === 'monthly' ? 1 : frequency === 'quarterly' ? 3 : 12;
  const targetMonth = date.getUTCMonth() + monthStep;
  date.setUTCDate(1);
  date.setUTCMonth(targetMonth);
  const finalDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(anchorDay, finalDay));
  return date.toISOString().slice(0, 10);
}

function validateRecurringPayload(payload, existing = null) {
  const title = normalizeText(payload.title ?? existing?.title, 191);
  const frequency = payload.frequency ?? existing?.frequency;
  const startsOn = payload.startsOn ?? dateOnly(existing?.starts_on);
  const endsOn = payload.endsOn === undefined
    ? dateOnly(existing?.ends_on)
    : payload.endsOn || null;
  const subtotalCents = payload.subtotalCents ?? Number(existing?.subtotal_cents);
  const taxCents = payload.taxCents ?? Number(existing?.tax_cents || 0);

  if (!title || !['weekly', 'monthly', 'quarterly', 'annually'].includes(frequency) ||
      !isValidDate(startsOn) || !isValidDate(endsOn, true) ||
      (endsOn && endsOn < startsOn) ||
      !Number.isSafeInteger(subtotalCents) || subtotalCents < 0 ||
      !Number.isSafeInteger(taxCents) || taxCents < 0 ||
      !Number.isSafeInteger(subtotalCents + taxCents) ||
      subtotalCents + taxCents <= 0) {
    throw new Error('INVALID_RECURRING_EXPENSE');
  }

  return {
    title,
    frequency,
    startsOn,
    endsOn,
    subtotalCents,
    taxCents,
    categoryId: payload.categoryId === undefined
      ? toOptionalId(existing?.category_id)
      : toOptionalId(payload.categoryId),
    supplierId: payload.supplierId === undefined
      ? toOptionalId(existing?.supplier_id)
      : toOptionalId(payload.supplierId),
    description: normalizeText(
      payload.description === undefined ? existing?.description : payload.description,
      10000
    ),
  };
}

async function getRecurringExpenses(businessId) {
  return getMany(
    `SELECT r.id, r.category_id, c.name AS category_name,
       r.supplier_id, s.name AS supplier_name, r.title, r.description,
       r.subtotal_cents, r.tax_cents, r.currency, r.frequency,
       r.starts_on, r.ends_on, r.next_due_date, r.is_active,
       r.created_at, r.updated_at
     FROM recurring_expenses r
     LEFT JOIN expense_categories c
       ON c.id = r.category_id AND c.business_id = r.business_id
     LEFT JOIN expense_suppliers s
       ON s.id = r.supplier_id AND s.business_id = r.business_id
     WHERE r.business_id = ?
     ORDER BY r.is_active DESC, r.next_due_date ASC, r.id DESC`,
    [businessId]
  );
}

async function createRecurringExpense({ businessId, userId, payload = {} }) {
  await ensureMembership(businessId, userId);
  const values = validateRecurringPayload(payload);
  if (Number.isNaN(values.categoryId) || Number.isNaN(values.supplierId)) {
    throw new Error('INVALID_RECURRING_EXPENSE');
  }
  await validateExpenseRelations(
    businessId,
    values.categoryId,
    values.supplierId,
    db
  );
  const business = await getOne(
    'SELECT currency FROM businesses WHERE id = ?',
    [businessId]
  );
  if (!business) throw new Error('INVALID_BUSINESS');

  const result = await execute(
    `INSERT INTO recurring_expenses
     (business_id, category_id, supplier_id, title, description,
      subtotal_cents, tax_cents, currency, frequency, starts_on, ends_on,
      next_due_date, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [
      businessId,
      values.categoryId,
      values.supplierId,
      values.title,
      values.description,
      values.subtotalCents,
      values.taxCents,
      business.currency,
      values.frequency,
      values.startsOn,
      values.endsOn,
      values.startsOn,
    ]
  );
  return getOne(
    'SELECT * FROM recurring_expenses WHERE id = ? AND business_id = ?',
    [result.insertId, businessId]
  );
}

async function updateRecurringExpense({ businessId, userId, recurringId, payload = {} }) {
  await ensureMembership(businessId, userId);
  const recurring = await getOne(
    'SELECT * FROM recurring_expenses WHERE id = ? AND business_id = ?',
    [recurringId, businessId]
  );
  if (!recurring) throw new Error('RECURRING_EXPENSE_NOT_FOUND');
  const values = validateRecurringPayload(payload, recurring);
  if (Number.isNaN(values.categoryId) || Number.isNaN(values.supplierId)) {
    throw new Error('INVALID_RECURRING_EXPENSE');
  }
  await validateExpenseRelations(
    businessId,
    values.categoryId,
    values.supplierId,
    db
  );
  const isActive = payload.isActive === undefined
    ? Number(recurring.is_active)
    : payload.isActive === true || payload.isActive === 1;
  if (payload.isActive !== undefined &&
      ![true, false, 0, 1].includes(payload.isActive)) {
    throw new Error('INVALID_RECURRING_EXPENSE');
  }
  const nextDueDate = dateOnly(recurring.next_due_date) < values.startsOn
    ? values.startsOn
    : dateOnly(recurring.next_due_date);
  await execute(
    `UPDATE recurring_expenses
     SET category_id = ?, supplier_id = ?, title = ?, description = ?,
       subtotal_cents = ?, tax_cents = ?, frequency = ?, starts_on = ?,
       ends_on = ?, next_due_date = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND business_id = ?`,
    [
      values.categoryId,
      values.supplierId,
      values.title,
      values.description,
      values.subtotalCents,
      values.taxCents,
      values.frequency,
      values.startsOn,
      values.endsOn,
      nextDueDate,
      isActive ? 1 : 0,
      recurringId,
      businessId,
    ]
  );
  return getOne(
    `SELECT * FROM recurring_expenses WHERE id = ? AND business_id = ?`,
    [recurringId, businessId]
  );
}

async function generateDueRecurringExpenses({ businessId, userId }) {
  await ensureMembership(businessId, userId);
  const today = await getBusinessToday(businessId);
  return withTransaction(async (connection) => {
    const recurringRows = await getMany(
      `SELECT * FROM recurring_expenses
       WHERE business_id = ? AND is_active = 1 AND next_due_date <= ?
       ORDER BY next_due_date ASC, id ASC
       FOR UPDATE`,
      [businessId, today],
      connection
    );
    let createdCount = 0;
    let processedCount = 0;

    for (const recurring of recurringRows) {
      let nextDate = dateOnly(recurring.next_due_date);
      const startDate = dateOnly(recurring.starts_on);
      const endDate = dateOnly(recurring.ends_on);
      if (nextDate < startDate) nextDate = startDate;

      while (nextDate <= today && (!endDate || nextDate <= endDate)) {
        processedCount += 1;
        if (processedCount > 500) throw new Error('RECURRING_GENERATION_LIMIT');
        const existingOccurrence = await getOne(
          `SELECT id FROM expenses
           WHERE business_id = ? AND recurring_expense_id = ?
             AND recurrence_date = ?`,
          [businessId, recurring.id, nextDate],
          connection
        );
        if (!existingOccurrence) {
          await execute(
            `INSERT INTO expenses
             (business_id, category_id, supplier_id, recurring_expense_id,
              recurrence_date, title, description, expense_date, due_date,
              subtotal_cents, tax_cents, total_cents, currency, status,
              created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unpaid', ?)`,
            [
              businessId,
              recurring.category_id,
              recurring.supplier_id,
              recurring.id,
              nextDate,
              recurring.title,
              recurring.description,
              nextDate,
              nextDate,
              recurring.subtotal_cents,
              recurring.tax_cents,
              Number(recurring.subtotal_cents) + Number(recurring.tax_cents),
              recurring.currency,
              userId,
            ],
            connection
          );
          createdCount += 1;
        }
        nextDate = addRecurrenceDate(
          nextDate,
          recurring.frequency,
          startDate
        );
      }

      const isActive = !endDate || nextDate <= endDate;
      await execute(
        `UPDATE recurring_expenses
         SET next_due_date = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND business_id = ?`,
        [nextDate, isActive ? 1 : 0, recurring.id, businessId],
        connection
      );
    }

    return { createdCount, checkedAt: today };
  });
}

module.exports = {
  getExpenseCategories,
  createExpenseCategory,
  updateExpenseCategory,
  getExpenseSuppliers,
  createExpenseSupplier,
  listExpenses,
  getExpenseDetails,
  createExpense,
  updateExpense,
  cancelExpense,
  getExpensePayments,
  recordExpensePayment,
  getExpenseSummary,
  getRecurringExpenses,
  createRecurringExpense,
  updateRecurringExpense,
  generateDueRecurringExpenses,
};
