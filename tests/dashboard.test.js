const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const databasePath = path.join(__dirname, '..', 'database', `test-dashboard-${Date.now()}.db`);
process.env.DATABASE_PATH = databasePath;
const app = require('../server');
const db = require('../src/api/database');

function getServer() {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function register(baseUrl, email, businessName) {
  const response = await fetch(`${baseUrl}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      firstName: 'Test',
      lastName: 'Owner',
      email,
      password: 'StrongPassword!123',
      businessName,
      businessType: 'retail',
    }),
  });
  assert.equal(response.status, 201);
  return response.json();
}

async function api(baseUrl, token, endpoint, options = {}) {
  return fetch(`${baseUrl}${endpoint}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });
}

test('dashboard derives sales KPIs, rankings, stock, and excludes refunded sales per tenant', async (t) => {
  const server = await getServer();
  t.after(() => {
    server.close();
    db.close();
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const owner = await register(baseUrl, 'dashboard-owner@example.com', 'Owner Store');
  const other = await register(baseUrl, 'dashboard-other@example.com', 'Other Store');

  const productResponse = await api(baseUrl, owner.sessionToken, '/api/products', {
    method: 'POST',
    body: JSON.stringify({ name: 'Coffee', sku: 'COF-1', category: 'Drinks', price: 25, cost: 10, initialStock: 4, reorderLevel: 3 }),
  });
  assert.equal(productResponse.status, 201);
  const product = (await productResponse.json()).product;

  const secondProductResponse = await api(baseUrl, owner.sessionToken, '/api/products', {
    method: 'POST',
    body: JSON.stringify({ name: 'Tea', sku: 'TEA-1', category: 'Drinks', price: 18, cost: 7, initialStock: 4, reorderLevel: 2 }),
  });
  assert.equal(secondProductResponse.status, 201);
  const secondProduct = (await secondProductResponse.json()).product;

  const customerResponse = await api(baseUrl, owner.sessionToken, '/api/customers', {
    method: 'POST',
    body: JSON.stringify({ name: 'A customer', email: 'customer@example.com' }),
  });
  assert.equal(customerResponse.status, 201);
  const customer = (await customerResponse.json()).customer;

  const saleResponse = await api(baseUrl, owner.sessionToken, '/api/sales', {
    method: 'POST',
    headers: { 'Idempotency-Key': 'sale-dashboard-001' },
    body: JSON.stringify({
      paymentMethod: 'cash',
      customerId: customer.id,
      items: [{ productId: product.id, quantity: 2 }, { productId: secondProduct.id, quantity: 1 }],
    }),
  });
  assert.equal(saleResponse.status, 201);
  const sale = (await saleResponse.json()).sale;
  assert.equal(sale.total_cents, 6800);

  const replayResponse = await api(baseUrl, owner.sessionToken, '/api/sales', {
    method: 'POST',
    headers: { 'Idempotency-Key': 'sale-dashboard-001' },
    body: JSON.stringify({ items: [{ productId: product.id, quantity: 2 }] }),
  });
  assert.equal(replayResponse.status, 200, 'replayed sale should not be duplicated');
  assert.equal((await replayResponse.json()).sale.id, sale.id);

  const dashboardResponse = await api(baseUrl, owner.sessionToken, '/api/dashboard?period=7d');
  assert.equal(dashboardResponse.status, 200);
  const dashboard = await dashboardResponse.json();
  assert.equal(dashboard.summary.today.revenueCents, 6800);
  assert.equal(dashboard.summary.today.transactionCount, 1);
  assert.equal(dashboard.summary.today.itemsSold, 3);
  assert.equal(dashboard.summary.today.grossProfitCents, 4100);
  assert.equal(dashboard.summary.today.grossProfitComplete, true);
  assert.equal(dashboard.summary.customers.total, 1);
  assert.equal(dashboard.summary.customers.newToday, 1);
  assert.equal(dashboard.summary.customers.returningToday, 0);
  assert.equal(dashboard.summary.inventory.lowStockCount, 1);
  assert.equal(dashboard.summary.inventory.outOfStockCount, 0);
  assert.equal(dashboard.bestSellers[0].productId, product.id);
  assert.equal(dashboard.bestSellers[0].quantitySold, 2);
  assert.equal(dashboard.trends.length, 7);
  assert.equal(dashboard.recentSales[0].reference, sale.transaction_reference);

  const crossTenantSale = await api(baseUrl, other.sessionToken, '/api/sales', {
    method: 'POST',
    body: JSON.stringify({ items: [{ productId: product.id, quantity: 1 }] }),
  });
  assert.equal(crossTenantSale.status, 400, 'a business cannot sell another tenant product');

  const otherDashboardResponse = await api(baseUrl, other.sessionToken, '/api/dashboard');
  const otherDashboard = await otherDashboardResponse.json();
  assert.equal(otherDashboard.summary.today.revenueCents, 0);
  assert.equal(otherDashboard.summary.inventory.lowStockCount, 0);
  assert.deepEqual(otherDashboard.bestSellers, []);

  const unknownCostProduct = await api(baseUrl, owner.sessionToken, '/api/products', {
    method: 'POST',
    body: JSON.stringify({ name: 'Cost unknown', price: 9, initialStock: 1 }),
  });
  const unknownProduct = (await unknownCostProduct.json()).product;
  const unknownCostSale = await api(baseUrl, owner.sessionToken, '/api/sales', {
    method: 'POST',
    body: JSON.stringify({ items: [{ productId: unknownProduct.id, quantity: 1 }] }),
  });
  assert.equal(unknownCostSale.status, 201);
  const incompleteDashboard = await (await api(baseUrl, owner.sessionToken, '/api/dashboard')).json();
  assert.equal(incompleteDashboard.summary.today.grossProfitComplete, false, 'unknown product costs must be disclosed');
  const unknownSaleId = (await unknownCostSale.json()).sale.id;
  assert.equal((await api(baseUrl, owner.sessionToken, `/api/sales/${unknownSaleId}/refund`, { method: 'POST' })).status, 200);

  const refundResponse = await api(baseUrl, owner.sessionToken, `/api/sales/${sale.id}/refund`, { method: 'POST' });
  assert.equal(refundResponse.status, 200);
  const afterRefund = await (await api(baseUrl, owner.sessionToken, '/api/dashboard')).json();
  assert.equal(afterRefund.summary.today.revenueCents, 0);
  assert.equal(afterRefund.summary.today.transactionCount, 0);
  assert.equal(afterRefund.summary.inventory.lowStockCount, 0);
});
