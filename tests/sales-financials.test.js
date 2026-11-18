const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const db = require('../src/api/database');
const app = require('../server');

function request(baseUrl, token, endpoint, options = {}) {
  return fetch(`${baseUrl}${endpoint}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
}

test('sale discounts and tax flow through the dashboard without overstating revenue or profit', async (t) => {
  const server = await new Promise((resolve) => {
    const listeningServer = app.listen(0, () => resolve(listeningServer));
  });
  let businessId = null;
  let userId = null;

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));

    if (businessId && userId) {
      await db.execute(
        `DELETE si
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id
         WHERE s.business_id = ?`,
        [businessId]
      );
      await db.execute(
        'DELETE FROM inventory_movements WHERE business_id = ?',
        [businessId]
      );
      await db.execute('DELETE FROM sales WHERE business_id = ?', [businessId]);
      await db.execute('DELETE FROM inventory WHERE business_id = ?', [businessId]);
      await db.execute('DELETE FROM customers WHERE business_id = ?', [businessId]);
      await db.execute('DELETE FROM products WHERE business_id = ?', [businessId]);
      await db.execute('DELETE FROM business_settings WHERE business_id = ?', [businessId]);
      await db.execute('DELETE FROM business_memberships WHERE business_id = ?', [businessId]);
      await db.execute('DELETE FROM sessions WHERE user_id = ?', [userId]);
      await db.execute('DELETE FROM businesses WHERE id = ?', [businessId]);
      await db.execute('DELETE FROM users WHERE id = ?', [userId]);
    }

    await db.end();
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const email = `sales-financial-${crypto.randomUUID()}@example.com`;
  const registrationResponse = await request(baseUrl, null, '/api/register', {
    method: 'POST',
    body: JSON.stringify({
      firstName: 'Sales',
      lastName: 'Financials',
      email,
      password: 'StrongPassword!123',
      businessName: `Financial Test ${crypto.randomUUID()}`,
      businessType: 'retail',
    }),
  });

  assert.equal(registrationResponse.status, 201);
  const registration = await registrationResponse.json();
  const sessionResponse = await request(
    baseUrl,
    registration.sessionToken,
    '/api/session'
  );
  const session = await sessionResponse.json();
  businessId = session.business.id;
  userId = session.user.id;

  const productResponse = await request(baseUrl, registration.sessionToken, '/api/products', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Discounted product',
      category: 'Test category',
      price: 10,
      cost: 4,
      initialStock: 5,
    }),
  });
  assert.equal(productResponse.status, 201);
  const product = (await productResponse.json()).product;

  const saleResponse = await request(baseUrl, registration.sessionToken, '/api/sales', {
    method: 'POST',
    body: JSON.stringify({
      items: [{ productId: product.id, quantity: 2 }],
      discountCents: 300,
      taxCents: 120,
      paymentMethod: 'cash',
    }),
  });
  assert.equal(saleResponse.status, 201);
  const sale = (await saleResponse.json()).sale;
  assert.equal(sale.subtotal_cents, 2000);
  assert.equal(sale.discount_cents, 300);
  assert.equal(sale.tax_cents, 120);
  assert.equal(sale.total_cents, 1820);

  const dashboardResponse = await request(
    baseUrl,
    registration.sessionToken,
    '/api/dashboard?period=today'
  );
  assert.equal(dashboardResponse.status, 200);
  const dashboard = await dashboardResponse.json();
  assert.equal(dashboard.summary.today.revenueCents, 1700);
  assert.equal(dashboard.summary.today.grossProfitCents, 900);
  assert.equal(dashboard.summary.today.grossProfitMarginPct, 52.94);
  assert.equal(dashboard.bestSellers[0].revenueCents, 1700);
  assert.equal(dashboard.bestSellers[0].grossProfitCents, 900);
  assert.equal(dashboard.periodComparison.revenueCents, 1700);
  assert.equal(dashboard.trends.reduce((sum, point) => sum + point.revenueCents, 0), 1700);
  assert.equal(dashboard.summary.productCount, 1);
  assert.equal(dashboard.insights.bestCategory.name, 'Test category');
  assert.equal(dashboard.recentSales[0].total_cents, 1820);

  const profitCsvResponse = await request(baseUrl, registration.sessionToken, '/api/reports/profit-loss.csv?period=today');
  assert.equal(profitCsvResponse.status, 200);
  const profitCsv = await profitCsvResponse.text();
  assert.match(profitCsv, /"Gross profit","900"/);
  assert.match(profitCsv, /stock purchases/);

  const activityResponse = await request(baseUrl, registration.sessionToken, '/api/reports/activity?period=today');
  assert.equal(activityResponse.status, 200);
  const activity = await activityResponse.json();
  assert.ok(activity.events.some((event) => event.type === 'Inventory sale' && event.detail === 'Quantity change: -2'));
  const activityCsv = await request(baseUrl, registration.sessionToken, '/api/reports/activity.csv?period=today');
  assert.equal(activityCsv.status, 200);
  assert.match(await activityCsv.text(), /not a complete audit log/);

  for (const [timestamp, notes] of [
    ['2025-01-15T20:30:00Z', 'Inside reporting day'],
    ['2025-01-15T22:30:00Z', 'Outside reporting day'],
  ]) {
    await db.execute(
      `INSERT INTO inventory_movements
       (business_id, product_id, movement_type, quantity, notes, created_at)
       VALUES (?, ?, 'adjustment', 1, ?, ?)`,
      [businessId, product.id, notes, new Date(timestamp)]
    );
  }
  const historicalActivity = await request(baseUrl, registration.sessionToken,
    '/api/reports/activity?period=custom&startDate=2025-01-15&endDate=2025-01-15');
  assert.equal(historicalActivity.status, 200);
  const historicalEvents = (await historicalActivity.json()).events;
  assert.equal(historicalEvents.length, 1);
  assert.equal(historicalEvents[0].timestamp, '2025-01-15T20:30:00.000Z');

  const unknownProductResponse = await request(baseUrl, registration.sessionToken, '/api/products', {
    method: 'POST',
    body: JSON.stringify({ name: 'Unknown cost', price: 5, initialStock: 3 }),
  });
  assert.equal(unknownProductResponse.status, 201);
  const unknownProduct = (await unknownProductResponse.json()).product;
  const unknownSale = await request(baseUrl, registration.sessionToken, '/api/sales', {
    method: 'POST',
    body: JSON.stringify({ items: [{ productId: unknownProduct.id, quantity: 1 }] }),
  });
  assert.equal(unknownSale.status, 201);
  const estimatedOverview = await request(baseUrl, registration.sessionToken, '/api/reports/overview?period=today');
  assert.equal(estimatedOverview.status, 200);
  const estimate = await estimatedOverview.json();
  assert.equal(estimate.costCoverageComplete, false);
  assert.equal(estimate.unknownCostUnits, 1);
  assert.equal(estimate.cogsCents, 800);
  assert.equal(estimate.revenueCents, 2200);
  assert.equal(estimate.grossProfitCents, 1400);
  assert.equal(estimate.netOperatingResultCents, 1400);
  assert.equal(estimate.inventory.valuationCents, 1200);
  assert.equal(estimate.inventory.valuationComplete, false);
  assert.equal(estimate.inventory.unknownCostProducts, 1);
  const inventoryReport = await request(baseUrl, registration.sessionToken, '/api/reports/inventory?period=today');
  assert.equal(inventoryReport.status, 200);
  const inventoryProducts = (await inventoryReport.json()).products;
  assert.equal(inventoryProducts.find((item) => item.id === product.id).inventoryValueCents, 1200);
  const unknownInventory = inventoryProducts.find((item) => item.id === unknownProduct.id);
  assert.equal(unknownInventory.inventoryValueCents, 0);
  assert.equal(unknownInventory.costKnown, false);
  const inventoryCsv = await request(baseUrl, registration.sessionToken, '/api/reports/inventory.csv?period=today');
  assert.equal(inventoryCsv.status, 200);
  assert.match(await inventoryCsv.text(), /"Unknown cost"[^\r\n]*"0","Missing - treated as zero"/);
  const estimatedDashboardResponse = await request(baseUrl, registration.sessionToken, '/api/dashboard?period=today');
  assert.equal(estimatedDashboardResponse.status, 200);
  const estimatedDashboard = await estimatedDashboardResponse.json();
  assert.equal(estimatedDashboard.summary.today.grossProfitComplete, false);
  assert.equal(estimatedDashboard.summary.today.grossProfitCents, 1400);
  assert.equal(estimatedDashboard.bestSellers.find((item) => item.productId === unknownProduct.id).grossProfitCents, 500);
  const incompleteCsv = await request(baseUrl, registration.sessionToken, '/api/reports/profit-loss.csv?period=today');
  const estimatedCsv = await incompleteCsv.text();
  assert.match(estimatedCsv, /missing sale-time costs treated as zero/);
  assert.match(estimatedCsv, /"Gross profit","1400"/);

  const zeroProductResponse = await request(baseUrl, registration.sessionToken, '/api/products', {
    method: 'POST',
    body: JSON.stringify({ name: 'Zero cost', price: 2, cost: 0, initialStock: 1 }),
  });
  assert.equal(zeroProductResponse.status, 201);
  const zeroProduct = (await zeroProductResponse.json()).product;
  const zeroSale = await request(baseUrl, registration.sessionToken, '/api/sales', {
    method: 'POST',
    body: JSON.stringify({ items: [{ productId: zeroProduct.id, quantity: 1 }] }),
  });
  assert.equal(zeroSale.status, 201);
  const withZero = await (await request(baseUrl, registration.sessionToken, '/api/reports/overview?period=today')).json();
  assert.equal(withZero.unknownCostUnits, 1);
  assert.equal(withZero.grossProfitCents, 1600);
  assert.equal(withZero.inventory.unknownCostProducts, 1);
  const withZeroInventory = await (await request(baseUrl, registration.sessionToken, '/api/reports/inventory?period=today')).json();
  assert.equal(withZeroInventory.products.find((item) => item.id === zeroProduct.id).costKnown, true);
});
