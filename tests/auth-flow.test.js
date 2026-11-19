const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const db = require('../src/api/database');
const app = require('../server');

function startServer() {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      resolve(server);
    });
  });
}

test('register -> create business -> login -> update business settings -> logout', async (t) => {
  const server = await startServer();
  const port = server.address().port;
  const email = `alice-${crypto.randomUUID()}@example.com`;
  let userId;
  let businessId;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    if (userId) {
      await db.execute('DELETE FROM sessions WHERE user_id = ?', [userId]);
    }
    if (businessId) {
      await db.execute('DELETE FROM business_settings WHERE business_id = ?', [businessId]);
      await db.execute('DELETE FROM business_memberships WHERE business_id = ?', [businessId]);
      await db.execute('DELETE FROM businesses WHERE id = ?', [businessId]);
    }
    if (userId) {
      await db.execute('DELETE FROM users WHERE id = ?', [userId]);
    }
    await db.end();
  });

  const registerResponse = await fetch(`http://127.0.0.1:${port}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      firstName: 'Alice',
      lastName: 'Smith',
      email,
      password: 'StrongPassword!123',
      businessName: 'Sunrise Salon',
      businessType: 'hair_salon',
    }),
  });

  const registerBody = await registerResponse.json();
  userId = registerBody.user?.id;
  businessId = registerBody.business?.id;
  assert.equal(registerResponse.status, 201, 'registration should succeed');
  assert.ok(registerBody.sessionToken, 'session token should be returned');

  const loginResponse = await fetch(`http://127.0.0.1:${port}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'StrongPassword!123' }),
  });

  const loginBody = await loginResponse.json();
  assert.equal(loginResponse.status, 200, 'login should succeed');
  assert.equal(loginBody.user.email, email);

  const sessionResponse = await fetch(`http://127.0.0.1:${port}/api/session`, {
    headers: { Authorization: `Bearer ${registerBody.sessionToken}` },
  });
  const sessionBody = await sessionResponse.json();
  assert.equal(sessionResponse.status, 200, 'session endpoint should succeed');
  assert.equal(sessionBody.business.name, 'Sunrise Salon');

  const updateResponse = await fetch(`http://127.0.0.1:${port}/api/businesses/${sessionBody.business.id}/settings`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${registerBody.sessionToken}`,
    },
    body: JSON.stringify({
      operatingHours: '09:00-18:00',
      contactEmail: 'hello@sunrisesalon.co.za',
      phone: '+27123456789',
      address: '1 Main Road',
    }),
  });
  const updated = await updateResponse.json();
  assert.equal(updateResponse.status, 200, 'settings update should succeed');
  assert.equal(updated.settings.contact_email, 'hello@sunrisesalon.co.za');

  const logoutResponse = await fetch(`http://127.0.0.1:${port}/api/logout`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${registerBody.sessionToken}` },
  });
  const logoutBody = await logoutResponse.json();
  assert.equal(logoutResponse.status, 200, 'logout should succeed');
  assert.equal(logoutBody.ok, true);

  const afterLogout = await fetch(`http://127.0.0.1:${port}/api/session`, {
    headers: { Authorization: `Bearer ${registerBody.sessionToken}` },
  });
  assert.equal(afterLogout.status, 401, 'token should be invalid after logout');

});
