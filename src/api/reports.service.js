const db = require('./database');
const { dayBounds, localDateAt } = require('./dashboard.service');

async function getOne(sql, params = []) {
  const [rows] = await db.execute(sql, params);
  return rows[0] || null;
}

async function getMany(sql, params = []) {
  const [rows] = await db.execute(sql, params);
  return rows;
}

function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function addDays(date, amount) {
  const result = new Date(`${date}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + amount);
  return result.toISOString().slice(0, 10);
}

function getLastMonth(today) {
  const date = new Date(`${today.slice(0, 7)}-01T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() - 1);
  const start = date.toISOString().slice(0, 10);
  date.setUTCMonth(date.getUTCMonth() + 1);
  date.setUTCDate(0);
  return [start, date.toISOString().slice(0, 10)];
}

async function getContext(businessId, filters = {}) {
  const business = await getOne(
    'SELECT id, name, currency, timezone FROM businesses WHERE id = ?',
    [businessId]
  );
  if (!business) throw new Error('INVALID_BUSINESS');

  const today = localDateAt(new Date(), business.timezone || 'UTC');
  let startDate = filters.startDate || `${today.slice(0, 7)}-01`;
  let endDate = filters.endDate || today;

  if (filters.period && filters.period !== 'custom') {
    if (filters.period === 'today') {
      startDate = today;
      endDate = today;
    } else if (filters.period === 'week') {
      const weekday = new Date(`${today}T00:00:00.000Z`).getUTCDay();
      startDate = addDays(today, -((weekday + 6) % 7));
      endDate = today;
    } else if (filters.period === 'month') {
      startDate = `${today.slice(0, 7)}-01`;
      endDate = today;
    } else if (filters.period === 'last-month') {
      [startDate, endDate] = getLastMonth(today);
    } else if (filters.period === 'quarter') {
      startDate = addDays(today, -89);
      endDate = today;
    } else if (filters.period === 'year') {
      startDate = `${today.slice(0, 4)}-01-01`;
      endDate = today;
    } else {
      throw new Error('INVALID_DATE_RANGE');
    }
  }

  if (!isValidDate(startDate) || !isValidDate(endDate) || startDate > endDate) {
    throw new Error('INVALID_DATE_RANGE');
  }
  const periodDays = (
    Date.parse(`${endDate}T00:00:00Z`) -
    Date.parse(`${startDate}T00:00:00Z`)
  ) / 86400000 + 1;
  if (periodDays > 366) throw new Error('INVALID_DATE_RANGE');

  return {
    business,
    startDate,
    endDate,
    startUtc: new Date(dayBounds(startDate, business.timezone || 'UTC').start),
    endUtc: new Date(dayBounds(endDate, business.timezone || 'UTC').end),
  };
}

function numeric(value) {
  const result = Number(value || 0);
  return Number.isFinite(result) ? result : 0;
}

async function getReportsOverview(businessId, filters = {}) {
  const context = await getContext(businessId, filters);
  const { startUtc, endUtc, startDate, endDate, business } = context;
  const [sales, itemStats, expenses, inventory, customerStats, topProduct, topCategory, topCustomer] =
    await Promise.all([
      getOne(
        `SELECT
           SUM(status = 'completed') AS transaction_count,
           COALESCE(SUM(CASE WHEN status = 'completed'
             THEN subtotal_cents - discount_cents ELSE 0 END), 0) AS revenue_cents,
           COALESCE(SUM(CASE WHEN status = 'completed' THEN discount_cents ELSE 0 END), 0) AS discounts_cents,
           COALESCE(SUM(status = 'refunded'), 0) AS refunded_count,
           COALESCE(SUM(CASE WHEN status = 'refunded' THEN total_cents ELSE 0 END), 0) AS refunded_cents,
           COALESCE(SUM(status = 'cancelled'), 0) AS cancelled_count
         FROM sales
         WHERE business_id = ? AND created_at >= ? AND created_at < ?`,
        [businessId, startUtc, endUtc]
      ),
      getOne(
        `SELECT
           COALESCE(SUM(si.quantity * COALESCE(si.unit_cost_cents, 0)), 0) AS known_cogs_cents,
           COALESCE(SUM(CASE WHEN si.unit_cost_cents IS NULL
             THEN si.quantity ELSE 0 END), 0) AS unknown_cost_units,
           COALESCE(SUM(si.quantity), 0) AS units_sold
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id
         WHERE s.business_id = ? AND s.status = 'completed'
           AND s.created_at >= ? AND s.created_at < ?`,
        [businessId, startUtc, endUtc]
      ),
      getOne(
        `SELECT
           COALESCE(SUM(e.total_cents), 0) AS expense_cents,
           COALESCE(SUM(COALESCE(p.paid_cents, 0)), 0) AS paid_cents,
           COUNT(CASE WHEN e.due_date < ? AND e.total_cents > COALESCE(p.paid_cents, 0) THEN 1 END) AS overdue_count
         FROM expenses e
         LEFT JOIN (
           SELECT business_id, expense_id, SUM(amount_cents) AS paid_cents
           FROM expense_payments GROUP BY business_id, expense_id
         ) p ON p.business_id = e.business_id AND p.expense_id = e.id
         WHERE e.business_id = ? AND e.status NOT IN ('cancelled', 'draft')
           AND e.expense_date >= ? AND e.expense_date <= ?`,
        [endDate, businessId, startDate, endDate]
      ),
      getOne(
        `SELECT
           COALESCE(SUM(i.quantity_on_hand), 0) AS units_on_hand,
           COALESCE(SUM(CASE WHEN p.cost_is_known = 1
             THEN i.quantity_on_hand * p.cost_cents ELSE 0 END), 0) AS known_valuation_cents,
           COALESCE(SUM(CASE WHEN p.cost_is_known = 0 AND i.quantity_on_hand > 0
             THEN 1 ELSE 0 END), 0) AS unknown_cost_products,
           COALESCE(SUM(i.quantity_on_hand = 0), 0) AS out_of_stock_count,
           COALESCE(SUM(i.quantity_on_hand > 0 AND i.quantity_on_hand <= i.reorder_level), 0) AS low_stock_count
         FROM inventory i
         JOIN products p ON p.id = i.product_id AND p.business_id = i.business_id
         WHERE i.business_id = ? AND p.is_active = 1`,
        [businessId]
      ),
      getOne(
        `SELECT
           COUNT(*) AS total,
           SUM(created_at >= ? AND created_at < ?) AS new_customers
         FROM customers WHERE business_id = ?`,
        [startUtc, endUtc, businessId]
      ),
      getOne(
        `SELECT si.product_name_snapshot AS name,
           SUM(si.quantity) AS quantity_sold,
           SUM(si.line_total_cents - si.discount_cents) AS revenue_cents
         FROM sale_items si JOIN sales s ON s.id = si.sale_id
         WHERE s.business_id = ? AND s.status = 'completed'
           AND s.created_at >= ? AND s.created_at < ?
         GROUP BY si.product_id, si.product_name_snapshot
         ORDER BY quantity_sold DESC, revenue_cents DESC LIMIT 1`,
        [businessId, startUtc, endUtc]
      ),
      getOne(
        `SELECT si.product_category_snapshot AS name,
           SUM(si.line_total_cents - si.discount_cents) AS revenue_cents
         FROM sale_items si JOIN sales s ON s.id = si.sale_id
         WHERE s.business_id = ? AND s.status = 'completed'
           AND s.created_at >= ? AND s.created_at < ?
           AND si.product_category_snapshot IS NOT NULL
           AND si.product_category_snapshot <> ''
         GROUP BY si.product_category_snapshot
         ORDER BY revenue_cents DESC LIMIT 1`,
        [businessId, startUtc, endUtc]
      ),
      getOne(
        `SELECT c.id, c.name,
           SUM(s.subtotal_cents - s.discount_cents) AS spend_cents,
           COUNT(*) AS transaction_count
         FROM sales s JOIN customers c
           ON c.id = s.customer_id AND c.business_id = s.business_id
         WHERE s.business_id = ? AND s.status = 'completed'
           AND s.created_at >= ? AND s.created_at < ?
         GROUP BY c.id, c.name
         ORDER BY spend_cents DESC LIMIT 1`,
        [businessId, startUtc, endUtc]
      ),
    ]);

  const revenueCents = numeric(sales?.revenue_cents);
  const unknownCostUnits = numeric(itemStats?.unknown_cost_units);
  const cogsCents = numeric(itemStats?.known_cogs_cents);
  const grossProfitCents = revenueCents - cogsCents;
  const expenseCents = numeric(expenses?.expense_cents);
  const recurring = await getOne(
    `SELECT COALESCE(SUM(CASE frequency
       WHEN 'weekly' THEN (subtotal_cents + tax_cents) * 52 / 12
       WHEN 'monthly' THEN subtotal_cents + tax_cents
       WHEN 'quarterly' THEN (subtotal_cents + tax_cents) / 3
       WHEN 'annually' THEN (subtotal_cents + tax_cents) / 12
     END), 0) AS monthly_commitment_cents
     FROM recurring_expenses WHERE business_id = ? AND is_active = 1`,
    [businessId]
  );

  return {
    business: {
      id: business.id,
      name: business.name,
      currency: business.currency,
      timezone: business.timezone,
    },
    range: { startDate, endDate },
    revenueCents,
    transactionCount: numeric(sales?.transaction_count),
    averageTransactionCents: numeric(sales?.transaction_count)
      ? Math.round(revenueCents / numeric(sales.transaction_count))
      : 0,
    discountCents: numeric(sales?.discounts_cents),
    refundedCount: numeric(sales?.refunded_count),
    refundedCents: numeric(sales?.refunded_cents),
    cancelledCount: numeric(sales?.cancelled_count),
    costCoverageComplete: unknownCostUnits === 0,
    unknownCostUnits,
    cogsCents,
    grossProfitCents,
    grossMarginPct: !revenueCents
      ? null
      : Math.round((grossProfitCents / revenueCents) * 10000) / 100,
    operatingExpensesCents: expenseCents,
    netOperatingResultCents: grossProfitCents - expenseCents,
    expensesPaidCents: numeric(expenses?.paid_cents),
    expensesOutstandingCents: Math.max(0, expenseCents - numeric(expenses?.paid_cents)),
    overdueExpenseCount: numeric(expenses?.overdue_count),
    recurringMonthlyCommitmentsCents: Math.round(numeric(recurring?.monthly_commitment_cents)),
    inventory: {
      unitsOnHand: numeric(inventory?.units_on_hand),
      valuationCents: numeric(inventory?.known_valuation_cents),
      valuationComplete: numeric(inventory?.unknown_cost_products) === 0,
      unknownCostProducts: numeric(inventory?.unknown_cost_products),
      lowStockCount: numeric(inventory?.low_stock_count),
      outOfStockCount: numeric(inventory?.out_of_stock_count),
    },
    customers: {
      total: numeric(customerStats?.total),
      newInPeriod: numeric(customerStats?.new_customers),
    },
    bestProduct: topProduct ? {
      name: topProduct.name,
      quantitySold: numeric(topProduct.quantity_sold),
      revenueCents: numeric(topProduct.revenue_cents),
    } : null,
    bestCategory: topCategory ? {
      name: topCategory.name,
      revenueCents: numeric(topCategory.revenue_cents),
    } : null,
    topCustomer: topCustomer ? {
      id: topCustomer.id,
      name: topCustomer.name,
      spendCents: numeric(topCustomer.spend_cents),
      transactionCount: numeric(topCustomer.transaction_count),
    } : null,
  };
}

async function getSalesReport(businessId, filters = {}) {
  const context = await getContext(businessId, filters);
  const { startUtc, endUtc, startDate, endDate } = context;
  const [daily, products, categories, customers, methods, statuses] = await Promise.all([
    getMany(
      `SELECT created_at, subtotal_cents, discount_cents, status
       FROM sales WHERE business_id = ? AND created_at >= ? AND created_at < ?
       ORDER BY created_at ASC LIMIT 10000`,
      [businessId, startUtc, endUtc]
    ),
    getMany(
      `SELECT si.product_id AS id, si.product_name_snapshot AS name,
         SUM(si.quantity) AS quantity_sold,
         SUM(si.line_total_cents - si.discount_cents) AS revenue_cents
       FROM sale_items si JOIN sales s ON s.id = si.sale_id
       WHERE s.business_id = ? AND s.status = 'completed'
         AND s.created_at >= ? AND s.created_at < ?
       GROUP BY si.product_id, si.product_name_snapshot
       ORDER BY quantity_sold DESC LIMIT 100`,
      [businessId, startUtc, endUtc]
    ),
    getMany(
      `SELECT si.product_category_snapshot AS name,
         SUM(si.line_total_cents - si.discount_cents) AS revenue_cents,
         SUM(si.quantity) AS quantity_sold
       FROM sale_items si JOIN sales s ON s.id = si.sale_id
       WHERE s.business_id = ? AND s.status = 'completed'
         AND s.created_at >= ? AND s.created_at < ?
       GROUP BY si.product_category_snapshot
       ORDER BY revenue_cents DESC`,
      [businessId, startUtc, endUtc]
    ),
    getMany(
      `SELECT c.id, c.name, SUM(s.subtotal_cents - s.discount_cents) AS spend_cents,
         COUNT(*) AS transaction_count
       FROM sales s JOIN customers c
         ON c.id = s.customer_id AND c.business_id = s.business_id
       WHERE s.business_id = ? AND s.status = 'completed'
         AND s.created_at >= ? AND s.created_at < ?
       GROUP BY c.id, c.name ORDER BY spend_cents DESC LIMIT 100`,
      [businessId, startUtc, endUtc]
    ),
    getMany(
      `SELECT COALESCE(payment_method, 'unspecified') AS payment_method,
         COUNT(*) AS transaction_count,
         SUM(subtotal_cents - discount_cents) AS revenue_cents
       FROM sales WHERE business_id = ? AND status = 'completed'
         AND created_at >= ? AND created_at < ?
       GROUP BY payment_method ORDER BY revenue_cents DESC`,
      [businessId, startUtc, endUtc]
    ),
    getMany(
      `SELECT status, COUNT(*) AS transaction_count,
         SUM(total_cents) AS total_cents
       FROM sales WHERE business_id = ? AND created_at >= ? AND created_at < ?
       GROUP BY status ORDER BY status`,
      [businessId, startUtc, endUtc]
    ),
  ]);
  const byDay = new Map();
  for (const sale of daily) {
    const date = localDateAt(new Date(sale.created_at), context.business.timezone || 'UTC');
    const item = byDay.get(date) || { date, revenueCents: 0, transactionCount: 0 };
    if (sale.status === 'completed') {
      item.revenueCents += numeric(sale.subtotal_cents) - numeric(sale.discount_cents);
      item.transactionCount += 1;
    }
    byDay.set(date, item);
  }

  return {
    range: { startDate, endDate },
    daily: [...byDay.values()].sort((left, right) => left.date.localeCompare(right.date)),
    products: products.map((row) => ({
      id: row.id,
      name: row.name,
      quantitySold: numeric(row.quantity_sold),
      revenueCents: numeric(row.revenue_cents),
    })),
    categories: categories.map((row) => ({
      name: row.name || 'Uncategorised',
      quantitySold: numeric(row.quantity_sold),
      revenueCents: numeric(row.revenue_cents),
    })),
    customers: customers.map((row) => ({
      id: row.id,
      name: row.name,
      spendCents: numeric(row.spend_cents),
      transactionCount: numeric(row.transaction_count),
    })),
    paymentMethods: methods.map((row) => ({
      paymentMethod: row.payment_method,
      transactionCount: numeric(row.transaction_count),
      revenueCents: numeric(row.revenue_cents),
    })),
    statuses: statuses.map((row) => ({
      status: row.status,
      transactionCount: numeric(row.transaction_count),
      totalCents: numeric(row.total_cents),
    })),
    capped: daily.length === 10000,
  };
}

async function getExpensesReport(businessId, filters = {}) {
  const context = await getContext(businessId, filters);
  const { startDate, endDate } = context;
  const [categories, suppliers, months, statuses] = await Promise.all([
    getMany(
      `SELECT COALESCE(c.name, 'Uncategorised') AS name,
         SUM(e.total_cents) AS amount_cents, COUNT(*) AS expense_count
       FROM expenses e LEFT JOIN expense_categories c
         ON c.id = e.category_id AND c.business_id = e.business_id
       WHERE e.business_id = ? AND e.status NOT IN ('cancelled', 'draft')
         AND e.expense_date >= ? AND e.expense_date <= ?
       GROUP BY c.name ORDER BY amount_cents DESC`,
      [businessId, startDate, endDate]
    ),
    getMany(
      `SELECT COALESCE(s.name, 'No supplier') AS name,
         SUM(e.total_cents) AS amount_cents, COUNT(*) AS expense_count
       FROM expenses e LEFT JOIN expense_suppliers s
         ON s.id = e.supplier_id AND s.business_id = e.business_id
       WHERE e.business_id = ? AND e.status NOT IN ('cancelled', 'draft')
         AND e.expense_date >= ? AND e.expense_date <= ?
       GROUP BY s.name ORDER BY amount_cents DESC`,
      [businessId, startDate, endDate]
    ),
    getMany(
      `SELECT DATE_FORMAT(expense_date, '%Y-%m') AS month,
         SUM(total_cents) AS amount_cents, COUNT(*) AS expense_count
       FROM expenses WHERE business_id = ?
         AND status NOT IN ('cancelled', 'draft')
         AND expense_date >= ? AND expense_date <= ?
       GROUP BY DATE_FORMAT(expense_date, '%Y-%m') ORDER BY month`,
      [businessId, startDate, endDate]
    ),
    getMany(
      `SELECT CASE
         WHEN e.status IN ('unpaid', 'partially_paid', 'overdue')
           AND e.due_date < ? THEN 'overdue'
         ELSE e.status END AS status,
         COUNT(*) AS expense_count, SUM(e.total_cents) AS amount_cents,
         SUM(GREATEST(e.total_cents - COALESCE(p.paid_cents, 0), 0)) AS outstanding_cents
       FROM expenses e
       LEFT JOIN (
         SELECT business_id, expense_id, SUM(amount_cents) AS paid_cents
         FROM expense_payments GROUP BY business_id, expense_id
       ) p ON p.business_id = e.business_id AND p.expense_id = e.id
       WHERE e.business_id = ? AND e.status <> 'cancelled'
         AND e.expense_date >= ? AND e.expense_date <= ?
       GROUP BY status`,
      [context.endDate, businessId, startDate, endDate]
    ),
  ]);

  return {
    range: { startDate, endDate },
    categories: categories.map((row) => ({
      name: row.name,
      amountCents: numeric(row.amount_cents),
      count: numeric(row.expense_count),
    })),
    suppliers: suppliers.map((row) => ({
      name: row.name,
      amountCents: numeric(row.amount_cents),
      count: numeric(row.expense_count),
    })),
    months: months.map((row) => ({
      month: row.month,
      amountCents: numeric(row.amount_cents),
      count: numeric(row.expense_count),
    })),
    statuses: statuses.map((row) => ({
      status: row.status,
      amountCents: numeric(row.amount_cents),
      outstandingCents: numeric(row.outstanding_cents),
      count: numeric(row.expense_count),
    })),
  };
}

async function getInventoryReport(businessId, filters = {}) {
  const context = await getContext(businessId, filters);
  const rows = await getMany(
    `SELECT p.id, p.name, p.category, p.cost_cents, p.cost_is_known,
       i.quantity_on_hand, i.reorder_level,
       COALESCE(m.units_sold, 0) AS units_sold,
       COALESCE(m.last_movement, NULL) AS last_movement
     FROM products p
     JOIN inventory i ON i.product_id = p.id AND i.business_id = p.business_id
     LEFT JOIN (
       SELECT business_id, product_id,
         SUM(CASE WHEN movement_type = 'sale' THEN -quantity ELSE 0 END) AS units_sold,
         MAX(created_at) AS last_movement
       FROM inventory_movements
       WHERE created_at >= ? AND created_at < ?
       GROUP BY business_id, product_id
     ) m ON m.business_id = p.business_id AND m.product_id = p.id
     WHERE p.business_id = ? AND p.is_active = 1
     ORDER BY i.quantity_on_hand ASC, p.name ASC`,
    [context.startUtc, context.endUtc, businessId]
  );

  return {
    range: { startDate: context.startDate, endDate: context.endDate },
    products: rows.map((row) => ({
      id: row.id,
      name: row.name,
      category: row.category,
      quantityOnHand: numeric(row.quantity_on_hand),
      reorderLevel: numeric(row.reorder_level),
      status: numeric(row.quantity_on_hand) === 0
        ? 'out_of_stock'
        : numeric(row.quantity_on_hand) <= numeric(row.reorder_level)
          ? 'low_stock'
          : 'in_stock',
      inventoryValueCents: row.cost_is_known
        ? numeric(row.quantity_on_hand) * numeric(row.cost_cents)
        : 0,
      costKnown: Boolean(row.cost_is_known),
      unitsSold: numeric(row.units_sold),
      lastMovement: row.last_movement,
    })),
  };
}

async function getCustomersReport(businessId, filters = {}) {
  const context = await getContext(businessId, filters);
  const rows = await getMany(
    `SELECT c.id, c.name, c.email, c.phone, c.created_at,
       COUNT(CASE WHEN s.status = 'completed' THEN 1 END) AS transaction_count,
       COALESCE(SUM(CASE WHEN s.status = 'completed'
         THEN s.subtotal_cents - s.discount_cents ELSE 0 END), 0) AS spend_cents,
       MAX(CASE WHEN s.status = 'completed' THEN s.created_at END) AS last_purchase_at
     FROM customers c
     LEFT JOIN sales s ON s.customer_id = c.id AND s.business_id = c.business_id
       AND s.created_at >= ? AND s.created_at < ?
     WHERE c.business_id = ?
     GROUP BY c.id, c.name, c.email, c.phone, c.created_at
     ORDER BY spend_cents DESC, c.created_at DESC
     LIMIT 500`,
    [context.startUtc, context.endUtc, businessId]
  );
  return {
    range: { startDate: context.startDate, endDate: context.endDate },
    customers: rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      phone: row.phone,
      transactionCount: numeric(row.transaction_count),
      spendCents: numeric(row.spend_cents),
      averageSpendCents: numeric(row.transaction_count)
        ? Math.round(numeric(row.spend_cents) / numeric(row.transaction_count))
        : 0,
      lastPurchaseAt: row.last_purchase_at,
    })),
  };
}

async function getActivityReport(businessId, filters = {}) {
  const context = await getContext(businessId, filters);
  const [movements, payments] = await Promise.all([
    getMany(
      `SELECT m.id, m.created_at, m.movement_type, m.quantity, p.name
       FROM inventory_movements m
       JOIN products p ON p.id = m.product_id AND p.business_id = m.business_id
       WHERE m.business_id = ? AND m.created_at >= ? AND m.created_at < ?
       ORDER BY m.created_at DESC, m.id DESC LIMIT 501`,
      [businessId, context.startUtc, context.endUtc]
    ),
    getMany(
      `SELECT p.id, p.created_at, p.amount_cents, e.title
       FROM expense_payments p
       JOIN expenses e ON e.id = p.expense_id AND e.business_id = p.business_id
       WHERE p.business_id = ? AND p.created_at >= ? AND p.created_at < ?
       ORDER BY p.created_at DESC, p.id DESC LIMIT 501`,
      [businessId, context.startUtc, context.endUtc]
    ),
  ]);
  const timestamp = (value) => {
    if (value instanceof Date) return value.toISOString();
    const utc = /(?:Z|[+-]\d{2}:\d{2})$/i.test(value)
      ? value
      : `${value.replace(' ', 'T')}Z`;
    return new Date(utc).toISOString();
  };
  const events = [
    ...movements.map((row) => ({
      timestamp: timestamp(row.created_at),
      type: `Inventory ${row.movement_type}`,
      subject: row.name,
      detail: `Quantity change: ${Number(row.quantity)}`,
    })),
    ...payments.map((row) => ({
      timestamp: timestamp(row.created_at),
      type: 'Expense payment recorded',
      subject: row.title,
      detail: `Amount in cents: ${Number(row.amount_cents)}`,
    })),
  ].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  return {
    range: { startDate: context.startDate, endDate: context.endDate },
    events: events.slice(0, 500),
    truncated: events.length > 500,
  };
}

function finiteNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function dateOnly(value) {
  return value instanceof Date
    ? value.toISOString().slice(0, 10)
    : String(value || '').slice(0, 10);
}

function assertEntityFilter(value, label) {
  if (value === undefined || value === null || value === '') return null;
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`INVALID_${label}_FILTER`);
  return id;
}

async function getReceivablesReport(businessId, filters = {}) {
  const context = await getContext(businessId, filters);
  const customerId = assertEntityFilter(filters.customerId, 'RECEIVABLE');
  const status = filters.status ? String(filters.status) : null;
  if (status && !['outstanding', 'overdue', 'partially_paid', 'paid'].includes(status)) {
    throw new Error('INVALID_RECEIVABLE_FILTER');
  }
  const conditions = [
    "i.status NOT IN ('draft', 'cancelled')",
    'i.invoice_date <= ?',
  ];
  const params = [context.endDate];
  if (customerId) {
    conditions.push('i.customer_id = ?');
    params.push(customerId);
  }
  if (status === 'outstanding') conditions.push('balance.outstanding_cents > 0');
  if (status === 'overdue') conditions.push('balance.outstanding_cents > 0 AND i.due_date < ?');
  if (status === 'partially_paid') conditions.push('balance.paid_cents > 0 AND balance.outstanding_cents > 0');
  if (status === 'paid') conditions.push('balance.outstanding_cents = 0');
  if (status === 'overdue') params.push(context.endDate);
  const where = conditions.join(' AND ');

  const rows = await getMany(
    `SELECT i.id, i.invoice_number, i.customer_id, i.customer_name,
       i.invoice_date, i.due_date, i.total_cents, i.currency,
       balance.paid_cents, balance.credited_cents, balance.outstanding_cents,
       GREATEST(DATEDIFF(?, i.due_date), 0) AS days_overdue
     FROM invoices i
     JOIN (
       SELECT source.id AS invoice_id, source.business_id,
         COALESCE(pay.paid_cents, 0) AS paid_cents,
         COALESCE(credits.credited_cents, 0) AS credited_cents,
         GREATEST(source.total_cents - COALESCE(pay.paid_cents, 0)
           - COALESCE(credits.credited_cents, 0), 0) AS outstanding_cents
       FROM invoices source
       LEFT JOIN (
         SELECT invoice_id, business_id, SUM(amount_cents) AS paid_cents
         FROM invoice_payments WHERE payment_date <= ?
         GROUP BY business_id, invoice_id
       ) pay ON pay.business_id = source.business_id AND pay.invoice_id = source.id
       LEFT JOIN (
         SELECT invoice_id, business_id, SUM(total_cents) AS credited_cents
         FROM invoice_credit_notes WHERE credit_date <= ?
         GROUP BY business_id, invoice_id
       ) credits ON credits.business_id = source.business_id AND credits.invoice_id = source.id
       WHERE source.business_id = ?
     ) balance ON balance.invoice_id = i.id AND balance.business_id = i.business_id
     WHERE i.business_id = ? AND ${where}
     ORDER BY days_overdue DESC, i.due_date ASC, i.id DESC LIMIT 1001`,
    [
      context.endDate,
      context.endDate,
      context.endDate,
      businessId,
      businessId,
      ...params,
    ]
  );
  const truncated = rows.length > 1000;
  if (truncated) rows.length = 1000;
  const aging = { currentCents: 0, days1To30Cents: 0, days31To60Cents: 0, days61To90Cents: 0, over90DaysCents: 0 };
  const customers = new Map();
  for (const invoice of rows) {
    invoice.invoice_date = dateOnly(invoice.invoice_date);
    invoice.due_date = dateOnly(invoice.due_date);
    invoice.total_cents = finiteNumber(invoice.total_cents);
    invoice.paid_cents = finiteNumber(invoice.paid_cents);
    invoice.credited_cents = finiteNumber(invoice.credited_cents);
    invoice.outstanding_cents = finiteNumber(invoice.outstanding_cents);
    invoice.days_overdue = Number(invoice.days_overdue);
    if (invoice.due_date >= context.endDate) aging.currentCents += invoice.outstanding_cents;
    else if (invoice.days_overdue <= 30) aging.days1To30Cents += invoice.outstanding_cents;
    else if (invoice.days_overdue <= 60) aging.days31To60Cents += invoice.outstanding_cents;
    else if (invoice.days_overdue <= 90) aging.days61To90Cents += invoice.outstanding_cents;
    else aging.over90DaysCents += invoice.outstanding_cents;
    const customer = customers.get(invoice.customer_id) || {
      id: invoice.customer_id,
      name: invoice.customer_name,
      outstandingCents: 0,
      overdueCents: 0,
      invoiceCount: 0,
    };
    customer.outstandingCents += invoice.outstanding_cents;
    if (invoice.days_overdue > 0) customer.overdueCents += invoice.outstanding_cents;
    if (invoice.outstanding_cents > 0) customer.invoiceCount += 1;
    customers.set(invoice.customer_id, customer);
  }
  const customerFilter = customerId ? ' AND customer_id = ?' : '';
  const customerParams = customerId ? [customerId] : [];
  const [issued, payments] = await Promise.all([
    getOne(
      `SELECT COUNT(*) AS count, COALESCE(SUM(total_cents), 0) AS amount_cents
       FROM invoices WHERE business_id = ? AND status NOT IN ('draft', 'cancelled')
         AND invoice_date >= ? AND invoice_date <= ?${customerFilter}`,
      [businessId, context.startDate, context.endDate, ...customerParams]
    ),
    getOne(
      `SELECT COALESCE(SUM(p.amount_cents), 0) AS amount_cents,
         AVG(DATEDIFF(p.payment_date, i.invoice_date)) AS average_days
       FROM invoice_payments p
       JOIN invoices i ON i.id = p.invoice_id AND i.business_id = p.business_id
       WHERE p.business_id = ? AND p.payment_date >= ? AND p.payment_date <= ?${customerId ? ' AND i.customer_id = ?' : ''}`,
      [businessId, context.startDate, context.endDate, ...customerParams]
    ),
  ]);
  return {
    range: { startDate: context.startDate, endDate: context.endDate, asOfDate: context.endDate },
    currency: context.business.currency,
    summary: {
      outstandingCents: rows.reduce((sum, invoice) => sum + invoice.outstanding_cents, 0),
      overdueCents: aging.days1To30Cents + aging.days31To60Cents + aging.days61To90Cents + aging.over90DaysCents,
      overdueCount: rows.filter((invoice) => invoice.outstanding_cents > 0 && invoice.days_overdue > 0).length,
      partiallyPaidCount: rows.filter((invoice) => invoice.outstanding_cents > 0 && invoice.paid_cents > 0).length,
      invoicesIssuedCount: finiteNumber(issued.count),
      invoicesIssuedCents: finiteNumber(issued.amount_cents),
      paymentsReceivedCents: finiteNumber(payments.amount_cents),
      averagePaymentDays: payments.average_days === null ? null : Math.max(0, Math.round(Number(payments.average_days) * 100) / 100),
    },
    aging,
    truncated,
    customers: [...customers.values()].sort((a, b) => b.overdueCents - a.overdueCents).slice(0, 500),
    invoices: rows,
  };
}

async function getPayablesReport(businessId, filters = {}) {
  const context = await getContext(businessId, filters);
  const supplierId = assertEntityFilter(filters.supplierId, 'PAYABLE');
  const status = filters.status ? String(filters.status) : null;
  if (status && !['outstanding', 'overdue', 'partially_paid', 'paid'].includes(status)) {
    throw new Error('INVALID_PAYABLE_FILTER');
  }
  const conditions = ["si.status <> 'cancelled'", 'si.invoice_date <= ?'];
  const params = [context.endDate];
  if (supplierId) {
    conditions.push('si.supplier_id = ?');
    params.push(supplierId);
  }
  if (status === 'outstanding') conditions.push('balance.outstanding_cents > 0');
  if (status === 'overdue') conditions.push('balance.outstanding_cents > 0 AND si.due_date < ?');
  if (status === 'partially_paid') conditions.push('balance.paid_cents > 0 AND balance.outstanding_cents > 0');
  if (status === 'paid') conditions.push('balance.outstanding_cents = 0');
  if (status === 'overdue') params.push(context.endDate);
  const rows = await getMany(
    `SELECT si.id, si.supplier_id, si.supplier_name, si.supplier_invoice_number,
       si.invoice_date, si.due_date, si.total_cents, si.currency,
       balance.paid_cents, balance.outstanding_cents,
       GREATEST(DATEDIFF(?, si.due_date), 0) AS days_overdue
     FROM supplier_invoices si
     JOIN (
       SELECT source.id AS invoice_id, source.business_id,
         COALESCE(pay.paid_cents, 0) AS paid_cents,
         GREATEST(source.total_cents - COALESCE(pay.paid_cents, 0), 0) AS outstanding_cents
       FROM supplier_invoices source
       LEFT JOIN (
         SELECT supplier_invoice_id, business_id, SUM(amount_cents) AS paid_cents
         FROM supplier_invoice_payments WHERE payment_date <= ?
         GROUP BY business_id, supplier_invoice_id
       ) pay ON pay.business_id = source.business_id AND pay.supplier_invoice_id = source.id
       WHERE source.business_id = ?
     ) balance ON balance.invoice_id = si.id AND balance.business_id = si.business_id
     WHERE si.business_id = ? AND ${conditions.join(' AND ')}
     ORDER BY days_overdue DESC, si.due_date ASC, si.id DESC LIMIT 1001`,
    [context.endDate, context.endDate, businessId, businessId, ...params]
  );
  const truncated = rows.length > 1000;
  if (truncated) rows.length = 1000;
  const aging = { currentCents: 0, days1To30Cents: 0, days31To60Cents: 0, days61To90Cents: 0, over90DaysCents: 0 };
  const suppliers = new Map();
  for (const invoice of rows) {
    invoice.invoice_date = dateOnly(invoice.invoice_date);
    invoice.due_date = dateOnly(invoice.due_date);
    invoice.total_cents = finiteNumber(invoice.total_cents);
    invoice.paid_cents = finiteNumber(invoice.paid_cents);
    invoice.outstanding_cents = finiteNumber(invoice.outstanding_cents);
    invoice.days_overdue = Number(invoice.days_overdue);
    if (invoice.due_date >= context.endDate) aging.currentCents += invoice.outstanding_cents;
    else if (invoice.days_overdue <= 30) aging.days1To30Cents += invoice.outstanding_cents;
    else if (invoice.days_overdue <= 60) aging.days31To60Cents += invoice.outstanding_cents;
    else if (invoice.days_overdue <= 90) aging.days61To90Cents += invoice.outstanding_cents;
    else aging.over90DaysCents += invoice.outstanding_cents;
    const supplier = suppliers.get(invoice.supplier_id) || {
      id: invoice.supplier_id,
      name: invoice.supplier_name,
      outstandingCents: 0,
      overdueCents: 0,
      invoiceCount: 0,
    };
    supplier.outstandingCents += invoice.outstanding_cents;
    if (invoice.days_overdue > 0) supplier.overdueCents += invoice.outstanding_cents;
    if (invoice.outstanding_cents > 0) supplier.invoiceCount += 1;
    suppliers.set(invoice.supplier_id, supplier);
  }
  const supplierFilter = supplierId ? ' AND supplier_id = ?' : '';
  const supplierParams = supplierId ? [supplierId] : [];
  const [received, payments] = await Promise.all([
    getOne(
      `SELECT COUNT(*) AS count, COALESCE(SUM(total_cents), 0) AS amount_cents
       FROM supplier_invoices WHERE business_id = ? AND status <> 'cancelled'
         AND invoice_date >= ? AND invoice_date <= ?${supplierFilter}`,
      [businessId, context.startDate, context.endDate, ...supplierParams]
    ),
    getOne(
      `SELECT COALESCE(SUM(amount_cents), 0) AS amount_cents,
         AVG(DATEDIFF(p.payment_date, si.invoice_date)) AS average_days
       FROM supplier_invoice_payments p
       JOIN supplier_invoices si
         ON si.id = p.supplier_invoice_id AND si.business_id = p.business_id
       WHERE p.business_id = ? AND p.payment_date >= ? AND p.payment_date <= ?${supplierId ? ' AND si.supplier_id = ?' : ''}`,
      [businessId, context.startDate, context.endDate, ...supplierParams]
    ),
  ]);
  return {
    range: { startDate: context.startDate, endDate: context.endDate, asOfDate: context.endDate },
    currency: context.business.currency,
    summary: {
      outstandingCents: rows.reduce((sum, invoice) => sum + invoice.outstanding_cents, 0),
      overdueCents: aging.days1To30Cents + aging.days31To60Cents + aging.days61To90Cents + aging.over90DaysCents,
      overdueCount: rows.filter((invoice) => invoice.outstanding_cents > 0 && invoice.days_overdue > 0).length,
      partiallyPaidCount: rows.filter((invoice) => invoice.outstanding_cents > 0 && invoice.paid_cents > 0).length,
      invoicesReceivedCount: finiteNumber(received.count),
      invoicesReceivedCents: finiteNumber(received.amount_cents),
      paymentsMadeCents: finiteNumber(payments.amount_cents),
      averagePaymentDays: payments.average_days === null ? null : Math.max(0, Math.round(Number(payments.average_days) * 100) / 100),
    },
    aging,
    truncated,
    suppliers: [...suppliers.values()].sort((a, b) => b.overdueCents - a.overdueCents).slice(0, 500),
    invoices: rows,
  };
}

async function getExportRows(businessId, type, filters = {}) {
  const context = await getContext(businessId, filters);
  let title;
  let rows;
  if (type === 'sales') {
    const data = await getSalesReport(businessId, filters);
    title = 'Sales report';
    rows = data.products.map((row) => ({
      Product: row.name,
      'Units sold': row.quantitySold,
      Revenue: row.revenueCents,
    }));
  } else if (type === 'expenses') {
    const data = await getExpensesReport(businessId, filters);
    title = 'Expense report';
    rows = data.categories.map((row) => ({
      Category: row.name,
      'Expense count': row.count,
      'Amount in cents': row.amountCents,
    }));
  } else if (type === 'inventory') {
    const data = await getInventoryReport(businessId, filters);
    title = 'Inventory report (missing product costs treated as zero)';
    rows = data.products.map((row) => ({
      Product: row.name,
      Category: row.category || '',
      'On hand': row.quantityOnHand,
      'Reorder level': row.reorderLevel,
      'Inventory value in cents': row.inventoryValueCents,
      'Cost status': row.costKnown ? 'Recorded' : 'Missing - treated as zero',
      Status: row.status,
    }));
  } else if (type === 'customers') {
    const data = await getCustomersReport(businessId, filters);
    title = 'Customer report';
    rows = data.customers.map((row) => ({
      Customer: row.name,
      Email: row.email || '',
      Transactions: row.transactionCount,
      'Spend in cents': row.spendCents,
    }));
  } else if (type === 'profit-loss') {
    const data = await getReportsOverview(businessId, filters);
    title = `Profit and loss estimate (expense totals may include stock purchases already counted in cost of sales${data.costCoverageComplete ? '' : '; missing sale-time costs treated as zero'})`;
    rows = [
      { Measure: 'Revenue excluding sales tax', 'Amount in cents': data.revenueCents },
      { Measure: 'Cost of sales', 'Amount in cents': data.cogsCents },
      { Measure: 'Gross profit', 'Amount in cents': data.grossProfitCents },
      { Measure: 'Recorded expenses including tax', 'Amount in cents': data.operatingExpensesCents },
      { Measure: 'Estimated operating result', 'Amount in cents': data.netOperatingResultCents },
    ];
  } else if (type === 'activity') {
    const data = await getActivityReport(businessId, filters);
    title = `Recorded inventory movements and expense payments (not a complete audit log${data.truncated ? '; latest 500 only' : ''})`;
    rows = data.events.map((row) => ({
      'Recorded at (UTC)': new Date(row.timestamp).toISOString(),
      Type: row.type,
      Subject: row.subject,
      Detail: row.detail,
    }));
  } else if (type === 'receivables') {
    const data = await getReceivablesReport(businessId, filters);
    title = `Accounts receivable ageing (invoice balances; POS sales are excluded${data.truncated ? '; latest 1,000 only' : ''})`;
    rows = data.invoices.map((row) => ({
      Customer: row.customer_name,
      Invoice: row.invoice_number,
      'Invoice date': row.invoice_date,
      'Due date': row.due_date,
      'Amount in cents': row.total_cents,
      'Paid in cents': row.paid_cents,
      'Credited in cents': row.credited_cents,
      'Outstanding in cents': row.outstanding_cents,
      'Days overdue': row.days_overdue,
    }));
  } else if (type === 'payables') {
    const data = await getPayablesReport(businessId, filters);
    title = `Accounts payable ageing (supplier invoices; linked expenses are not counted twice${data.truncated ? '; latest 1,000 only' : ''})`;
    rows = data.invoices.map((row) => ({
      Supplier: row.supplier_name,
      'Supplier invoice': row.supplier_invoice_number,
      'Invoice date': row.invoice_date,
      'Due date': row.due_date,
      'Amount in cents': row.total_cents,
      'Paid in cents': row.paid_cents,
      'Outstanding in cents': row.outstanding_cents,
      'Days overdue': row.days_overdue,
    }));
  } else {
    throw new Error('INVALID_REPORT_TYPE');
  }

  return { context, title, rows };
}

function csvCell(value) {
  let text = String(value ?? '');
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

async function exportReportCsv(businessId, type, filters = {}) {
  const { context, title, rows } = await getExportRows(businessId, type, filters);
  const headings = rows.length ? Object.keys(rows[0]) : ['No records'];
  const lines = [
    [context.business.name],
    [title],
    [`Generated: ${new Date().toISOString()}`],
    [`Date range: ${context.startDate} to ${context.endDate}`],
    headings,
    ...rows.map((row) => headings.map((heading) => row[heading])),
  ];
  return lines.map((row) => row.map(csvCell).join(',')).join('\r\n');
}

module.exports = {
  getReportsOverview,
  getSalesReport,
  getExpensesReport,
  getInventoryReport,
  getCustomersReport,
  getActivityReport,
  getReceivablesReport,
  getPayablesReport,
  exportReportCsv,
};
