const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../server');

test('public contact validates, rate-limits and sends through the configured email provider', async (t) => {
  const originalFetch = global.fetch;
  const originalEnvironment = {
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    EMAIL_FROM: process.env.EMAIL_FROM,
    PUBLIC_CONTACT_EMAIL: process.env.PUBLIC_CONTACT_EMAIL,
  };
  const providerRequests = [];
  process.env.RESEND_API_KEY = 'test-key';
  process.env.EMAIL_FROM = 'WorkflowOS <website@example.com>';
  process.env.PUBLIC_CONTACT_EMAIL = 'support@example.com';
  global.fetch = async (url, options) => {
    if (url !== 'https://api.resend.com/emails') return originalFetch(url, options);
    providerRequests.push(JSON.parse(options.body));
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ id: `test-message-${providerRequests.length}` }),
    };
  };
  const server = await new Promise((resolve) => {
    const listeningServer = app.listen(0, () => resolve(listeningServer));
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const payload = {
    name: 'Test Sender',
    businessName: 'Test Business',
    email: 'sender@example.com',
    phone: '+27123456789',
    subject: 'Product question',
    message: '<script>alert(1)</script>',
    website: '',
  };
  const response = await fetch(`${baseUrl}/api/contact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  assert.equal(response.status, 202);
  assert.equal((await response.json()).accepted, true);
  assert.equal(providerRequests[0].to[0], 'support@example.com');
  assert.equal(providerRequests[0].reply_to, payload.email);
  assert.match(providerRequests[0].html, /&lt;script&gt;/);
  assert.doesNotMatch(providerRequests[0].html, /<script>/);

  const invalid = await fetch(`${baseUrl}/api/contact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, email: 'not-an-email' }),
  });
  assert.equal(invalid.status, 400);

  for (let index = 1; index < 5; index += 1) {
    const accepted = await fetch(`${baseUrl}/api/contact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    assert.equal(accepted.status, 202);
  }
  const limited = await fetch(`${baseUrl}/api/contact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  assert.equal(limited.status, 429);
});
