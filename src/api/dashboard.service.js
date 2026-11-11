const db = require('./database');

function datePartsInZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]));
}

function localDateAt(date, timeZone) {
  const parts = datePartsInZone(date, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function zonedMidnightUtc(dateString, timeZone) {
  const targetMs = Date.parse(`${dateString}T00:00:00.000Z`);
  let guessMs = targetMs;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const local = datePartsInZone(new Date(guessMs), timeZone);
    const representedMs = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
    const adjustment = targetMs - representedMs;
    guessMs += adjustment;
    if (adjustment === 0) break;
  }

  return new Date(guessMs).toISOString();
}

function dayBounds(dateString, timeZone) {
  return {
    start: zonedMidnightUtc(dateString, timeZone),
    end: zonedMidnightUtc(addDays(dateString, 1), timeZone),
  };
}

function percentageChange(current, previous) {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 10000) / 100;
}

function aggregateSales(businessId, start, end) {
  const sales = db.prepare(`
    SELECT COUNT(*) AS transaction_count, COALESCE(SUM(total_cents), 0) AS revenue_cents
    FROM sales
    WHERE business_id = ? AND status = 'completed' AND created_at >= ? AND created_at < ?
  `).get(businessId, start, end);

  const items = db.prepare(`
    SELECT COALESCE(SUM(si.quantity), 0) AS items_sold,
           COUNT(DISTINCT si.product_id) AS unique_products,
           COALESCE(SUM(CASE WHEN si.unit_cost_cents IS NOT NULL
             THEN si.line_total_cents - (si.quantity * si.unit_cost_cents) ELSE 0 END), 0) AS gross_profit_cents,
           SUM(CASE WHEN si.unit_cost_cents IS NULL THEN si.quantity ELSE 0 END) AS unknown_cost_quantity
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    WHERE s.business_id = ? AND s.status = 'completed' AND s.created_at >= ? AND s.created_at < ?
  `).get(businessId, start, end);

  return {
    revenueCents: sales.revenue_cents,
    transactionCount: sales.transaction_count,
    averageTransactionCents: sales.transaction_count ? Math.round(sales.revenue_cents / sales.transaction_count) : 0,
    itemsSold: items.items_sold,
    uniqueProductsSold: items.unique_products,
    grossProfitCents: items.gross_profit_cents,
    grossProfitComplete: !items.unknown_cost_quantity,
    grossProfitMarginPct: sales.revenue_cents && !items.unknown_cost_quantity
      ? Math.round((items.gross_profit_cents / sales.revenue_cents) * 10000) / 100
      : null,
  };
}

function getPeriodBounds(period, timeZone, now, customStart, customEnd) {
  const today = localDateAt(now, timeZone);
  if (period === 'custom') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(customStart || '') || !/^\d{4}-\d{2}-\d{2}$/.test(customEnd || '') || customStart > customEnd) {
      throw new Error('INVALID_DATE_RANGE');
    }
    const isRealDate = (date) => {
      const parsed = new Date(`${date}T00:00:00.000Z`);
      return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
    };
    if (!isRealDate(customStart) || !isRealDate(customEnd)) throw new Error('INVALID_DATE_RANGE');
    const days = (Date.parse(`${customEnd}T00:00:00Z`) - Date.parse(`${customStart}T00:00:00Z`)) / 86400000;
    if (days > 365) throw new Error('INVALID_DATE_RANGE');
    return { startDate: customStart, endDate: addDays(customEnd, 1), period };
  }

  if (period === 'today') return { startDate: today, endDate: addDays(today, 1), period };
  if (period === '30d') return { startDate: addDays(today, -29), endDate: addDays(today, 1), period };
  if (period === 'month') return { startDate: `${today.slice(0, 7)}-01`, endDate: addDays(today, 1), period };
  return { startDate: addDays(today, -6), endDate: addDays(today, 1), period: '7d' };
}

function getRangeSales(businessId, start, end) {
  return db.prepare(`
    SELECT created_at, total_cents
    FROM sales
    WHERE business_id = ? AND status = 'completed' AND created_at >= ? AND created_at < ?
    ORDER BY created_at ASC
  `).all(businessId, start, end);
}

function getRevenueTrends(sales, startDate, endDate, timeZone, granularity) {
  const selectedGranularity = ['daily', 'weekly', 'monthly'].includes(granularity) ? granularity : 'daily';
  const buckets = new Map();
  const endExclusive = endDate;

  for (let day = startDate; day < endExclusive; day = addDays(day, 1)) {
    let key = day;
    if (selectedGranularity === 'monthly') key = day.slice(0, 7);
    if (selectedGranularity === 'weekly') {
      const weekday = new Date(`${day}T00:00:00.000Z`).getUTCDay();
      key = addDays(day, -((weekday + 6) % 7));
    }
    if (!buckets.has(key)) buckets.set(key, 0);
  }

  for (const sale of sales) {
    const day = localDateAt(new Date(sale.created_at), timeZone);
    let key = day;
    if (selectedGranularity === 'monthly') key = day.slice(0, 7);
    if (selectedGranularity === 'weekly') {
      const weekday = new Date(`${day}T00:00:00.000Z`).getUTCDay();
      key = addDays(day, -((weekday + 6) % 7));
    }
    buckets.set(key, (buckets.get(key) || 0) + sale.total_cents);
  }

  return [...buckets.entries()].map(([date, revenueCents]) => ({ date, revenueCents }));
}

function getDashboardData(businessId, options = {}) {
  const business = db.prepare('SELECT id, name, currency, timezone FROM businesses WHERE id = ?').get(businessId);
  if (!business) throw new Error('BUSINESS_NOT_FOUND');

  const now = options.now ? new Date(options.now) : new Date();
  const todayDate = localDateAt(now, business.timezone);
  const todayBounds = dayBounds(todayDate, business.timezone);
  const previousDate = addDays(todayDate, -1);
  const previousBounds = dayBounds(previousDate, business.timezone);
  const today = aggregateSales(businessId, todayBounds.start, todayBounds.end);
  const previousDay = aggregateSales(businessId, previousBounds.start, previousBounds.end);

  const customerStats = db.prepare(`
    SELECT COUNT(*) AS total,
      SUM(CASE WHEN strftime('%Y-%m-%dT%H:%M:%fZ', created_at) >= ? AND strftime('%Y-%m-%dT%H:%M:%fZ', created_at) < ? THEN 1 ELSE 0 END) AS new_today
    FROM customers WHERE business_id = ?
  `).get(todayBounds.start, todayBounds.end, businessId);

  const returningCustomers = db.prepare(`
    SELECT COUNT(DISTINCT customer_id) AS total FROM sales
    WHERE business_id = ? AND status = 'completed' AND customer_id IS NOT NULL
      AND created_at >= ? AND created_at < ?
      AND customer_id IN (
        SELECT customer_id FROM sales previous
        WHERE previous.business_id = ? AND previous.status = 'completed'
          AND previous.customer_id IS NOT NULL AND previous.created_at < ?
      )
  `).get(businessId, todayBounds.start, todayBounds.end, businessId, todayBounds.start).total;

  const inventory = db.prepare(`
    SELECT COUNT(CASE WHEN quantity_on_hand > 0 AND quantity_on_hand < reorder_level THEN 1 END) AS low_stock_count,
      COUNT(CASE WHEN quantity_on_hand = 0 THEN 1 END) AS out_of_stock_count
    FROM inventory WHERE business_id = ?
  `).get(businessId);

  const lowStockProducts = db.prepare(`
    SELECT p.id AS product_id, p.name, p.category, i.quantity_on_hand, i.reorder_level
    FROM inventory i JOIN products p ON p.id = i.product_id
    WHERE i.business_id = ? AND i.quantity_on_hand > 0 AND i.quantity_on_hand < i.reorder_level
    ORDER BY i.quantity_on_hand ASC, p.name ASC LIMIT 5
  `).all(businessId);

  const periodBounds = getPeriodBounds(options.period || '7d', business.timezone, now, options.startDate, options.endDate);
  const periodStart = zonedMidnightUtc(periodBounds.startDate, business.timezone);
  const periodEnd = zonedMidnightUtc(periodBounds.endDate, business.timezone);
  const rangeSales = getRangeSales(businessId, periodStart, periodEnd);
  const periodDays = Math.max(1, (Date.parse(`${periodBounds.endDate}T00:00:00.000Z`) - Date.parse(`${periodBounds.startDate}T00:00:00.000Z`)) / 86400000);
  const previousStartDate = addDays(periodBounds.startDate, -periodDays);
  const previousStart = zonedMidnightUtc(previousStartDate, business.timezone);
  const previousSales = getRangeSales(businessId, previousStart, periodStart);
  const periodRevenueCents = rangeSales.reduce((sum, sale) => sum + sale.total_cents, 0);
  const previousPeriodRevenueCents = previousSales.reduce((sum, sale) => sum + sale.total_cents, 0);
  const granularity = options.granularity || 'daily';
  const trends = getRevenueTrends(rangeSales, periodBounds.startDate, periodBounds.endDate, business.timezone, granularity);

  const bestSellers = db.prepare(`
    SELECT p.id AS product_id, si.product_name_snapshot AS name,
      si.product_category_snapshot AS category,
      SUM(si.quantity) AS quantity_sold,
      SUM(si.line_total_cents) AS revenue_cents,
      SUM(CASE WHEN si.unit_cost_cents IS NOT NULL
        THEN si.line_total_cents - si.quantity * si.unit_cost_cents ELSE 0 END) AS gross_profit_cents,
      SUM(CASE WHEN si.unit_cost_cents IS NULL THEN si.quantity ELSE 0 END) AS unknown_cost_quantity
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    JOIN products p ON p.id = si.product_id
    WHERE s.business_id = ? AND s.status = 'completed' AND s.created_at >= ? AND s.created_at < ?
    GROUP BY p.id, si.product_name_snapshot, si.product_category_snapshot
    ORDER BY quantity_sold DESC, revenue_cents DESC LIMIT 5
  `).all(businessId, periodStart, periodEnd).map((row) => ({
    productId: row.product_id,
    name: row.name,
    category: row.category,
    quantitySold: row.quantity_sold,
    revenueCents: row.revenue_cents,
    grossProfitCents: row.gross_profit_cents,
    grossProfitComplete: !row.unknown_cost_quantity,
  }));

  const recentSales = db.prepare(`
    SELECT s.id, s.transaction_reference AS reference, s.customer_id,
      c.name AS customer_name, s.total_cents, s.payment_method, s.status, s.created_at,
      COALESCE(SUM(si.quantity), 0) AS items_count
    FROM sales s
    LEFT JOIN customers c ON c.id = s.customer_id AND c.business_id = s.business_id
    LEFT JOIN sale_items si ON si.sale_id = s.id
    WHERE s.business_id = ? AND s.created_at >= ? AND s.created_at < ?
    GROUP BY s.id
    ORDER BY s.created_at DESC LIMIT 8
  `).all(businessId, todayBounds.start, todayBounds.end);

  const category = db.prepare(`
    SELECT si.product_category_snapshot AS name, SUM(si.line_total_cents) AS revenue_cents
    FROM sale_items si JOIN sales s ON s.id = si.sale_id
    WHERE s.business_id = ? AND s.status = 'completed' AND s.created_at >= ? AND s.created_at < ?
      AND si.product_category_snapshot IS NOT NULL AND si.product_category_snapshot <> ''
    GROUP BY si.product_category_snapshot ORDER BY revenue_cents DESC LIMIT 1
  `).get(businessId, periodStart, periodEnd);

  const totalProducts = db.prepare('SELECT COUNT(*) AS total FROM products WHERE business_id = ? AND is_active = 1').get(businessId).total;
  const soldProducts = new Set(bestSellers.map((item) => item.productId));
  const bestProfit = [...bestSellers].filter((item) => item.grossProfitComplete).sort((a, b) => b.grossProfitCents - a.grossProfitCents)[0] || null;

  return {
    business: { id: business.id, name: business.name, currency: business.currency, timezone: business.timezone },
    todayDate,
    period: { ...periodBounds, granularity },
    periodComparison: {
      revenueCents: periodRevenueCents,
      previousRevenueCents: previousPeriodRevenueCents,
      changePct: percentageChange(periodRevenueCents, previousPeriodRevenueCents),
    },
    summary: {
      today: {
        ...today,
        revenueChangePct: percentageChange(today.revenueCents, previousDay.revenueCents),
        transactionChangePct: percentageChange(today.transactionCount, previousDay.transactionCount),
        itemsSoldChangePct: percentageChange(today.itemsSold, previousDay.itemsSold),
        previousRevenueCents: previousDay.revenueCents,
        previousTransactionCount: previousDay.transactionCount,
        previousItemsSold: previousDay.itemsSold,
      },
      customers: {
        total: customerStats.total,
        newToday: customerStats.new_today || 0,
        returningToday: returningCustomers,
      },
      inventory: {
        lowStockCount: inventory.low_stock_count || 0,
        outOfStockCount: inventory.out_of_stock_count || 0,
        lowStockProducts,
      },
      productCount: totalProducts,
    },
    bestSellers,
    recentSales,
    trends,
    insights: {
      mostProfitableProduct: bestProfit ? { name: bestProfit.name, grossProfitCents: bestProfit.grossProfitCents } : null,
      bestCategory: category ? { name: category.name, revenueCents: category.revenue_cents } : null,
      productsNotSoldInPeriod: Math.max(0, totalProducts - soldProducts.size),
      averageTransactionCents: today.averageTransactionCents,
      costCoverageComplete: today.grossProfitComplete,
    },
  };
}

module.exports = {
  getDashboardData,
  dayBounds,
  localDateAt,
  zonedMidnightUtc,
};
