const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const db = require('../src/api/database');
const app = require('../server');

async function request(baseUrl, token, endpoint) {
  return fetch(`${baseUrl}${endpoint}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

test('reports provide tenant-scoped summaries, validated ranges, and CSV downloads', async (t) => {
  const server = await new Promise((resolve) => {
    const listeningServer = app.listen(0, () => resolve(listeningServer));
  });
  let businessId = null;
  let userId = null;

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    if (businessId && userId) {
      await db.execute('DELETE FROM expense_categories WHERE business_id = ?', [businessId]);
      await db.execute('DELETE FROM business_settings WHERE business_id = ?', [businessId]);
      await db.execute('DELETE FROM business_memberships WHERE business_id = ?', [businessId]);
      await db.execute('DELETE FROM sessions WHERE user_id = ?', [userId]);
      await db.execute('DELETE FROM businesses WHERE id = ?', [businessId]);
      await db.execute('DELETE FROM users WHERE id = ?', [userId]);
    }
    await db.end();
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const suffix = crypto.randomUUID();
  const registration = await fetch(`${baseUrl}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      firstName: 'Report',
      lastName: 'Test',
      email: `reports-${suffix}@example.com`,
      password: 'StrongPassword!123',
      businessName: `Reports ${suffix}`,
      businessType: 'retail',
    }),
  });
  assert.equal(registration.status, 201);
  const auth = await registration.json();
  const sessionResponse = await request(baseUrl, auth.sessionToken, '/api/session');
  const session = await sessionResponse.json();
  businessId = session.business.id;
  userId = session.user.id;

  const query = '?period=custom&startDate=2025-01-01&endDate=2025-01-31';
  const [
    overviewResponse,
    salesResponse,
    expensesResponse,
    inventoryResponse,
    customersResponse,
    receivablesResponse,
    payablesResponse,
  ] =
    await Promise.all([
      request(baseUrl, auth.sessionToken, `/api/reports/overview${query}`),
      request(baseUrl, auth.sessionToken, `/api/reports/sales${query}`),
      request(baseUrl, auth.sessionToken, `/api/reports/expenses${query}`),
      request(baseUrl, auth.sessionToken, `/api/reports/inventory${query}`),
      request(baseUrl, auth.sessionToken, `/api/reports/customers${query}`),
      request(baseUrl, auth.sessionToken, `/api/reports/receivables${query}`),
      request(baseUrl, auth.sessionToken, `/api/reports/payables${query}`),
    ]);

  for (const response of [
    overviewResponse,
    salesResponse,
    expensesResponse,
    inventoryResponse,
    customersResponse,
    receivablesResponse,
    payablesResponse,
  ]) {
    assert.equal(response.status, 200);
  }
  const overview = await overviewResponse.json();
  assert.deepEqual(overview.range, { startDate: '2025-01-01', endDate: '2025-01-31' });
  assert.equal(overview.transactionCount, 0);
  assert.equal(overview.revenueCents, 0);
  assert.equal(overview.grossProfitCents, 0);
  assert.equal((await salesResponse.json()).products.length, 0);
  assert.equal((await expensesResponse.json()).categories.length, 0);
  assert.equal((await inventoryResponse.json()).products.length, 0);
  assert.equal((await customersResponse.json()).customers.length, 0);
  assert.equal((await receivablesResponse.json()).invoices.length, 0);
  assert.equal((await payablesResponse.json()).invoices.length, 0);

  const dashboardResponse = await request(baseUrl, auth.sessionToken, '/api/dashboard');
  assert.equal(dashboardResponse.status, 200);
  const dashboard = await dashboardResponse.json();
  assert.equal(dashboard.summary.expenses.monthToDateCents, 0);
  assert.equal(dashboard.summary.expenses.outstandingCents, 0);
  assert.equal(dashboard.summary.financial.receivables.outstandingCents, 0);
  assert.equal(dashboard.summary.financial.payables.outstandingCents, 0);

  const invalidRange = await request(
    baseUrl,
    auth.sessionToken,
    '/api/reports/overview?period=custom&startDate=2025-02-01&endDate=2025-01-01'
  );
  assert.equal(invalidRange.status, 400);

  const csvResponse = await request(
    baseUrl,
    auth.sessionToken,
    `/api/reports/sales.csv${query}`
  );
  assert.equal(csvResponse.status, 200);
  assert.match(csvResponse.headers.get('content-type'), /text\/csv/);
  assert.match(await csvResponse.text(), /Sales report/);

  const missingApi = await request(baseUrl, auth.sessionToken, '/api/reports/not-a-report');
  assert.equal(missingApi.status, 404);
  assert.match(missingApi.headers.get('content-type'), /application\/json/);
});
