const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const db = require('../src/api/database');
const app = require('../server');

async function api(baseUrl, token, endpoint, options = {}) {
  return fetch(`${baseUrl}${endpoint}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
}

test('expense management scopes records, tracks partial payments, and prevents duplicate or excess payments', async (t) => {
  const server = await new Promise((resolve) => {
    const listeningServer = app.listen(0, () => resolve(listeningServer));
  });
  let businessId = null;
  let userId = null;
  let otherBusinessId = null;
  let otherUserId = null;

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    if (businessId && userId) {
      await db.execute('DELETE FROM expense_payments WHERE business_id = ?', [businessId]);
      await db.execute('DELETE FROM expenses WHERE business_id = ?', [businessId]);
      await db.execute('DELETE FROM recurring_expenses WHERE business_id = ?', [businessId]);
      await db.execute('DELETE FROM expense_suppliers WHERE business_id = ?', [businessId]);
      await db.execute('DELETE FROM expense_categories WHERE business_id = ?', [businessId]);
      await db.execute('DELETE FROM business_settings WHERE business_id = ?', [businessId]);
      await db.execute('DELETE FROM business_memberships WHERE business_id = ?', [businessId]);
      await db.execute('DELETE FROM sessions WHERE user_id = ?', [userId]);
      await db.execute('DELETE FROM businesses WHERE id = ?', [businessId]);
      await db.execute('DELETE FROM users WHERE id = ?', [userId]);
    }
    if (otherBusinessId && otherUserId) {
      await db.execute('DELETE FROM business_settings WHERE business_id = ?', [otherBusinessId]);
      await db.execute('DELETE FROM business_memberships WHERE business_id = ?', [otherBusinessId]);
      await db.execute('DELETE FROM sessions WHERE user_id = ?', [otherUserId]);
      await db.execute('DELETE FROM businesses WHERE id = ?', [otherBusinessId]);
      await db.execute('DELETE FROM users WHERE id = ?', [otherUserId]);
    }
    await db.end();
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const suffix = crypto.randomUUID();
  const register = async (email, businessName) => {
    const response = await api(baseUrl, null, '/api/register', {
      method: 'POST',
      body: JSON.stringify({
        firstName: 'Expense',
        lastName: 'Test',
        email,
        password: 'StrongPassword!123',
        businessName,
        businessType: 'retail',
      }),
    });
    assert.equal(response.status, 201);
    return response.json();
  };

  const owner = await register(`expense-owner-${suffix}@example.com`, `Expense Owner ${suffix}`);
  const other = await register(`expense-other-${suffix}@example.com`, `Expense Other ${suffix}`);
  const ownerSession = await (await api(baseUrl, owner.sessionToken, '/api/session')).json();
  const otherSession = await (await api(baseUrl, other.sessionToken, '/api/session')).json();
  businessId = ownerSession.business.id;
  userId = ownerSession.user.id;
  otherBusinessId = otherSession.business.id;
  otherUserId = otherSession.user.id;

  const categories = await (await api(baseUrl, owner.sessionToken, '/api/expenses/categories')).json();
  assert.ok(categories.categories.some((category) => category.name === 'Rent'));

  const categoryResponse = await api(baseUrl, owner.sessionToken, '/api/expenses/categories', {
    method: 'POST',
    body: JSON.stringify({ name: `Test ${suffix}` }),
  });
  assert.equal(categoryResponse.status, 201);
  const categoryId = (await categoryResponse.json()).category.id;

  const supplierResponse = await api(baseUrl, owner.sessionToken, '/api/expenses/suppliers', {
    method: 'POST',
    body: JSON.stringify({ name: `Supplier ${suffix}`, email: 'supplier@example.com' }),
  });
  assert.equal(supplierResponse.status, 201);
  const supplierId = (await supplierResponse.json()).supplier.id;

  const today = new Date().toISOString().slice(0, 10);
  const expenseResponse = await api(baseUrl, owner.sessionToken, '/api/expenses', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Monthly utilities',
      categoryId,
      supplierId,
      expenseDate: today,
      dueDate: today,
      subtotalCents: 5000,
      taxCents: 500,
      referenceNumber: `INV-${suffix}`,
    }),
  });
  assert.equal(expenseResponse.status, 201);
  let expense = (await expenseResponse.json()).expense;
  const expenseId = expense.id;
  assert.equal(expense.total_cents, 5500);
  assert.equal(expense.outstanding_cents, 5500);
  assert.equal(expense.status, 'unpaid');

  const paymentPayload = {
    amountCents: 2000,
    paymentDate: today,
    paymentMethod: 'eft',
    reference: `PAY-${suffix}`,
  };
  const headers = { 'Idempotency-Key': `expense-payment-${suffix}` };
  const firstPayment = await api(baseUrl, owner.sessionToken, `/api/expenses/${expenseId}/payments`, {
    method: 'POST',
    headers,
    body: JSON.stringify(paymentPayload),
  });
  assert.equal(firstPayment.status, 201);
  expense = (await firstPayment.json()).expense;
  assert.equal(expense.status, 'partially_paid');
  assert.equal(expense.paid_cents, 2000);
  assert.equal(expense.outstanding_cents, 3500);

  const activity = await api(baseUrl, owner.sessionToken, '/api/reports/activity?period=today');
  assert.equal(activity.status, 200);
  assert.ok((await activity.json()).events.some((event) =>
    event.type === 'Expense payment recorded' && event.detail === 'Amount in cents: 2000'
  ));
  const otherActivity = await api(baseUrl, other.sessionToken, '/api/reports/activity?period=today');
  assert.equal(otherActivity.status, 200);
  assert.equal((await otherActivity.json()).events.length, 0);

  const replay = await api(baseUrl, owner.sessionToken, `/api/expenses/${expenseId}/payments`, {
    method: 'POST',
    headers,
    body: JSON.stringify(paymentPayload),
  });
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).replayed, true);

  const conflictingReplay = await api(baseUrl, owner.sessionToken, `/api/expenses/${expenseId}/payments`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...paymentPayload, amountCents: 1000 }),
  });
  assert.equal(conflictingReplay.status, 409);

  const overpayment = await api(baseUrl, owner.sessionToken, `/api/expenses/${expenseId}/payments`, {
    method: 'POST',
    headers: { 'Idempotency-Key': `overpayment-${suffix}` },
    body: JSON.stringify({ ...paymentPayload, amountCents: 3501 }),
  });
  assert.equal(overpayment.status, 409);

  const crossTenant = await api(
    baseUrl,
    other.sessionToken,
    `/api/expenses/${expenseId}`
  );
  assert.equal(crossTenant.status, 404);
  const otherList = await (await api(baseUrl, other.sessionToken, '/api/expenses')).json();
  assert.equal(otherList.total, 0);

  const update = await api(baseUrl, owner.sessionToken, `/api/expenses/${expenseId}`, {
    method: 'PUT',
    body: JSON.stringify({ title: 'Monthly utilities - revised' }),
  });
  assert.equal(update.status, 200);
  assert.equal((await update.json()).expense.title, 'Monthly utilities - revised');

  const payments = await (await api(
    baseUrl,
    owner.sessionToken,
    `/api/expenses/${expenseId}/payments`
  )).json();
  assert.equal(payments.payments.length, 1);

  const finalPayment = await api(baseUrl, owner.sessionToken, `/api/expenses/${expenseId}/payments`, {
    method: 'POST',
    headers: { 'Idempotency-Key': `final-payment-${suffix}` },
    body: JSON.stringify({ ...paymentPayload, amountCents: 3500 }),
  });
  assert.equal(finalPayment.status, 201);
  const paidExpense = (await finalPayment.json()).expense;
  assert.equal(paidExpense.status, 'paid');
  assert.equal(paidExpense.outstanding_cents, 0);

  const summary = await (await api(baseUrl, owner.sessionToken, '/api/expenses/summary')).json();
  assert.equal(summary.summary.paidCents, 5500);
  assert.equal(summary.summary.outstandingCents, 0);

  const businessToday = new Intl.DateTimeFormat('en-CA', {
    timeZone: ownerSession.business.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const recurringResponse = await api(baseUrl, owner.sessionToken, '/api/expenses/recurring', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Monthly software subscription',
      categoryId,
      supplierId,
      subtotalCents: 1200,
      taxCents: 0,
      frequency: 'monthly',
      startsOn: businessToday,
    }),
  });
  assert.equal(recurringResponse.status, 201);
  const recurringExpense = (await recurringResponse.json()).recurringExpense;
  const firstGeneration = await api(
    baseUrl,
    owner.sessionToken,
    '/api/expenses/recurring/generate',
    { method: 'POST' }
  );
  assert.equal(firstGeneration.status, 200);
  assert.equal((await firstGeneration.json()).createdCount, 1);
  const replayedGeneration = await api(
    baseUrl,
    owner.sessionToken,
    '/api/expenses/recurring/generate',
    { method: 'POST' }
  );
  assert.equal((await replayedGeneration.json()).createdCount, 0);
  const recurringList = await (await api(
    baseUrl,
    owner.sessionToken,
    '/api/expenses/recurring'
  )).json();
  assert.ok(recurringList.recurringExpenses.some((item) => item.id === recurringExpense.id));
});
