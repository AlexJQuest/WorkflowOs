const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const db = require('../src/api/database');
const app = require('../server');
const { cleanupBusiness } = require('./helpers/database');

function getServer() {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

test('tenant-scoped products and customers remain isolated', async (t) => {
  const server = await getServer();
  const port = server.address().port;
  const suffix = crypto.randomUUID();
  const accounts = [];
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    for (const account of accounts) {
      await cleanupBusiness(db, account.businessId, account.userId);
    }
    await db.end();
  });

  const primaryUser = await fetch(`http://127.0.0.1:${port}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      firstName: 'Nandi',
      lastName: 'Mokoena',
      email: `nandi-${suffix}@example.com`,
      password: 'StrongPassword!123',
      businessName: `Nandi Hair Studio ${suffix}`,
      businessType: 'hair_salon',
    }),
  });

  const primaryBody = await primaryUser.json();
  accounts.push({
    businessId: primaryBody.business?.id,
    userId: primaryBody.user?.id,
  });
  assert.equal(primaryUser.status, 201, 'primary registration should succeed');

  const secondaryUser = await fetch(`http://127.0.0.1:${port}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      firstName: 'Thabo',
      lastName: 'Nkosi',
      email: `thabo-${suffix}@example.com`,
      password: 'AnotherStrong!456',
      businessName: `Thabo Retail ${suffix}`,
      businessType: 'retail',
    }),
  });

  const secondaryBody = await secondaryUser.json();
  accounts.push({
    businessId: secondaryBody.business?.id,
    userId: secondaryBody.user?.id,
  });
  assert.equal(secondaryUser.status, 201, 'secondary registration should succeed');

  const productRes = await fetch(`http://127.0.0.1:${port}/api/products`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${primaryBody.sessionToken}`,
    },
    body: JSON.stringify({ name: `Hair Serum ${suffix}`, sku: `SER-${suffix.slice(0, 8)}`, price: 249.99, cost: 129.5 }),
  });

  const productBody = await productRes.json();
  assert.equal(productRes.status, 201, 'product creation should succeed');
  assert.equal(productBody.product.name, `Hair Serum ${suffix}`);

  const customerRes = await fetch(`http://127.0.0.1:${port}/api/customers`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${primaryBody.sessionToken}`,
    },
    body: JSON.stringify({ name: 'Jane Doe', email: `jane-${suffix}@example.com`, phone: '0821112233' }),
  });

  const customerBody = await customerRes.json();
  assert.equal(customerRes.status, 201, 'customer creation should succeed');
  assert.equal(customerBody.customer.name, 'Jane Doe');

  const primaryProducts = await fetch(`http://127.0.0.1:${port}/api/products`, {
    headers: { Authorization: `Bearer ${primaryBody.sessionToken}` },
  });
  const primaryProductsBody = await primaryProducts.json();
  assert.equal(primaryProducts.status, 200, 'primary business should fetch its own products');
  assert.ok(primaryProductsBody.products.some((product) => product.name === `Hair Serum ${suffix}`));

  const secondaryProducts = await fetch(`http://127.0.0.1:${port}/api/products`, {
    headers: { Authorization: `Bearer ${secondaryBody.sessionToken}` },
  });
  const secondaryProductsBody = await secondaryProducts.json();
  assert.equal(secondaryProducts.status, 200, 'secondary business should fetch its own products');
  assert.equal(
    secondaryProductsBody.products.some((product) => product.name === `Hair Serum ${suffix}`),
    false,
    'secondary business must not see primary business products'
  );

  const primaryCustomers = await fetch(`http://127.0.0.1:${port}/api/customers`, {
    headers: { Authorization: `Bearer ${primaryBody.sessionToken}` },
  });
  const primaryCustomersBody = await primaryCustomers.json();
  assert.equal(primaryCustomers.status, 200, 'primary business should fetch its own customers');
  assert.ok(primaryCustomersBody.customers.some((customer) => customer.email === `jane-${suffix}@example.com`));

  const secondaryCustomers = await fetch(`http://127.0.0.1:${port}/api/customers`, {
    headers: { Authorization: `Bearer ${secondaryBody.sessionToken}` },
  });
  const secondaryCustomersBody = await secondaryCustomers.json();
  assert.equal(secondaryCustomers.status, 200, 'secondary business should fetch its own customers');
  assert.equal(
    secondaryCustomersBody.customers.some((customer) => customer.email === `jane-${suffix}@example.com`),
    false,
    'secondary business must not see primary business customers'
  );
});
