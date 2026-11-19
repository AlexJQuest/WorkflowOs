const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const db = require('../src/api/database');
const app = require('../server');

async function request(baseUrl, token, endpoint, options = {}) {
  return fetch(`${baseUrl}${endpoint}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
}

test('employee records and effective-dated base pay are owner-only and tenant-scoped', async (t) => {
  const server = await new Promise((resolve) => {
    const listeningServer = app.listen(0, () => resolve(listeningServer));
  });
  let owner = null;
  let other = null;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    for (const account of [owner, other]) {
      if (!account) continue;
      const { businessId, userId } = account;
      await db.execute('DELETE FROM employee_audit_events WHERE business_id = ?', [businessId]);
      await db.execute('DELETE FROM employee_compensation WHERE business_id = ?', [businessId]);
      await db.execute('DELETE FROM employees WHERE business_id = ?', [businessId]);
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
  const register = async (label) => {
    const response = await request(baseUrl, null, '/api/register', {
      method: 'POST',
      body: JSON.stringify({
        firstName: 'Employee',
        lastName: label,
        email: `employee-${label}-${suffix}@example.com`,
        password: 'StrongPassword!123',
        businessName: `Employee ${label} ${suffix}`,
        businessType: 'retail',
      }),
    });
    assert.equal(response.status, 201);
    const body = await response.json();
    const session = await (await request(baseUrl, body.sessionToken, '/api/session')).json();
    return { token: body.sessionToken, businessId: session.business.id, userId: session.user.id };
  };
  owner = await register('Owner');
  other = await register('Other');
  await db.execute(
    `INSERT INTO business_memberships (user_id, business_id, role)
     VALUES (?, ?, 'admin')`,
    [other.userId, owner.businessId]
  );

  const today = new Date().toISOString().slice(0, 10);
  const payload = {
    employeeNumber: `EMP-${suffix.slice(0, 8)}`,
    firstName: 'Taylor',
    lastName: 'Employee',
    email: 'taylor@example.com',
    phone: '+27123456789',
    jobTitle: 'Shop assistant',
    department: 'Retail',
    employmentType: 'permanent',
    employmentStatus: 'active',
    employmentStartDate: today,
    residentialAddress: '1 Market Street',
    emergencyContactName: 'Emergency Contact',
    emergencyContactPhone: '+27987654321',
    payStructure: 'monthly_salary',
    payFrequency: 'monthly',
    baseRateCents: 1500000,
    hoursPerWeekMillis: 45000,
    currency: 'USD',
    effectiveFrom: today,
  };
  const createdResponse = await request(baseUrl, owner.token, '/api/employees', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  assert.equal(createdResponse.status, 201);
  const employee = (await createdResponse.json()).employee;
  assert.equal(employee.base_rate_cents, payload.baseRateCents);
  assert.equal(employee.compensation_currency, 'ZAR');
  assert.equal(employee.employment_status, 'active');
  assert.equal(Object.hasOwn(employee, 'bank_account_number'), false);
  const memberAccess = await request(baseUrl, other.token, '/api/employees', {
    method: 'POST',
    body: JSON.stringify({ ...payload, businessId: owner.businessId, employeeNumber: `MEM-${suffix.slice(0, 8)}` }),
  });
  assert.equal(memberAccess.status, 403);

  const duplicate = await request(baseUrl, owner.token, '/api/employees', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  assert.equal(duplicate.status, 409);

  const list = await request(baseUrl, owner.token, '/api/employees?status=active');
  assert.equal(list.status, 200);
  assert.equal((await list.json()).total, 1);
  const isolated = await request(baseUrl, other.token, `/api/employees/${employee.id}`);
  assert.equal(isolated.status, 404);
  assert.equal((await (await request(baseUrl, other.token, '/api/employees')).json()).total, 0);

  const update = await request(baseUrl, owner.token, `/api/employees/${employee.id}`, {
    method: 'PUT',
    body: JSON.stringify({ jobTitle: 'Senior shop assistant', employmentStatus: 'on_leave' }),
  });
  assert.equal(update.status, 200);
  assert.equal((await update.json()).employee.job_title, 'Senior shop assistant');

  const effectiveFrom = new Date(`${today}T00:00:00.000Z`);
  effectiveFrom.setUTCDate(effectiveFrom.getUTCDate() + 1);
  const futureDate = effectiveFrom.toISOString().slice(0, 10);
  const compensation = await request(baseUrl, owner.token, `/api/employees/${employee.id}/compensation`, {
    method: 'POST',
    body: JSON.stringify({
      payStructure: 'monthly_salary',
      payFrequency: 'monthly',
      baseRateCents: 1600000,
      currency: 'ZAR',
      effectiveFrom: futureDate,
    }),
  });
  assert.equal(compensation.status, 200);
  const [history] = await db.execute(
    `SELECT effective_from, effective_to, base_rate_cents
     FROM employee_compensation
     WHERE business_id = ? AND employee_id = ?
     ORDER BY effective_from`,
    [owner.businessId, employee.id]
  );
  assert.equal(history.length, 2);
  assert.equal(Number(history[0].base_rate_cents), payload.baseRateCents);
  assert.equal(history[0].effective_to.toISOString().slice(0, 10), today);
  assert.equal(Number(history[1].base_rate_cents), 1600000);
});
