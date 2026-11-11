const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const databasePath = path.join(__dirname, '..', 'database', `test-product-edit-${Date.now()}.db`);
process.env.DATABASE_PATH = databasePath;
const app = require('../server');
const db = require('../src/api/database');

function startServer() {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function register(baseUrl, email, businessName) {
  const response = await fetch(`${baseUrl}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstName: 'Product', lastName: 'Owner', email, password: 'StrongPassword!123', businessName, businessType: 'retail' }),
  });
  assert.equal(response.status, 201);
  return response.json();
}

function request(baseUrl, token, endpoint, options = {}) {
  return fetch(`${baseUrl}${endpoint}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });
}

test('product edit persists permitted fields, tracks stock, protects history, and isolates tenants', async (t) => {
  const server = await startServer();
  t.after(() => {
    server.close();
    db.close();
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const first = await register(baseUrl, 'edit-one@example.com', 'Edit One');
  const second = await register(baseUrl, 'edit-two@example.com', 'Edit Two');

  const productCreate = await request(baseUrl, first.sessionToken, '/api/products', {
    method: 'POST',
    body: JSON.stringify({ name: 'Old name', sku: 'OLD-1', category: 'Old category', brand: 'Brand A', packagingSize: '250 g', price: 10, cost: 4, barcode: '12345670', initialStock: 10, reorderLevel: 2, unitOfMeasure: 'each', imageUrl: 'https://example.test/old.png' }),
  });
  assert.equal(productCreate.status, 201);
  const product = (await productCreate.json()).product;
  const originalCreatedAt = product.created_at;

  const saleResponse = await request(baseUrl, first.sessionToken, '/api/sales', {
    method: 'POST',
    headers: { 'Idempotency-Key': 'product-edit-history-1' },
    body: JSON.stringify({ items: [{ productId: product.id, quantity: 2 }], paymentMethod: 'cash' }),
  });
  assert.equal(saleResponse.status, 201);
  const saleId = (await saleResponse.json()).sale.id;
  const originalSaleItem = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').get(saleId);
  assert.equal(originalSaleItem.product_name_snapshot, 'Old name');
  assert.equal(originalSaleItem.unit_price_cents, 1000);
  assert.equal(originalSaleItem.unit_cost_cents, 400);

  const otherTenantRead = await request(baseUrl, second.sessionToken, `/api/products/${product.id}`);
  assert.equal(otherTenantRead.status, 404);
  const otherTenantUpdate = await request(baseUrl, second.sessionToken, `/api/products/${product.id}`, {
    method: 'PUT', body: JSON.stringify({ name: 'Should not change' }),
  });
  assert.equal(otherTenantUpdate.status, 404);

  const editResponse = await request(baseUrl, first.sessionToken, `/api/products/${product.id}`, {
    method: 'PUT',
    body: JSON.stringify({
      name: 'New name', sku: 'NEW-1', barcode: '87654325', brand: 'Brand B', category: 'New category',
      description: 'Updated description', packagingSize: '500 g', price: 12.5, cost: 5.25,
      quantityOnHand: 13, reorderLevel: 4, unitOfMeasure: 'pack', imageUrl: 'https://example.test/new.png', isActive: true,
    }),
  });
  assert.equal(editResponse.status, 200);
  const savedProduct = (await editResponse.json()).product;
  assert.equal(savedProduct.name, 'New name');
  assert.equal(savedProduct.sku, 'NEW-1');
  assert.equal(savedProduct.barcode, '87654325');
  assert.equal(savedProduct.barcode_status, 'unverified', 'manually changed barcode remains unverified');
  assert.equal(savedProduct.brand, 'Brand B');
  assert.equal(savedProduct.category, 'New category');
  assert.equal(savedProduct.description, 'Updated description');
  assert.equal(savedProduct.packaging_size, '500 g');
  assert.equal(savedProduct.price_cents, 1250);
  assert.equal(savedProduct.cost_cents, 525);
  assert.equal(savedProduct.cost_is_known, 1);
  assert.equal(savedProduct.unit_of_measure, 'pack');
  assert.equal(savedProduct.image_url, 'https://example.test/new.png');
  assert.equal(savedProduct.created_at, originalCreatedAt);

  const persistedRead = await request(baseUrl, first.sessionToken, `/api/products/${product.id}`);
  assert.equal(persistedRead.status, 200);
  assert.equal((await persistedRead.json()).product.name, 'New name');

  const currentStock = db.prepare('SELECT quantity_on_hand, reorder_level FROM inventory WHERE business_id = ? AND product_id = ?').get(product.business_id, product.id);
  assert.deepEqual(currentStock, { quantity_on_hand: 13, reorder_level: 4 });
  const adjustment = db.prepare(`SELECT movement_type, quantity, notes FROM inventory_movements WHERE business_id = ? AND product_id = ? ORDER BY id DESC LIMIT 1`).get(product.business_id, product.id);
  assert.equal(adjustment.movement_type, 'receipt');
  assert.equal(adjustment.quantity, 5, 'stock was 8 after the sale and changed to 13');
  assert.match(adjustment.notes, /Product edit/);

  const duplicateBarcodeProduct = await request(baseUrl, first.sessionToken, '/api/products', {
    method: 'POST', body: JSON.stringify({ name: 'Existing barcode owner', barcode: '12345670', price: 2 }),
  });
  assert.equal(duplicateBarcodeProduct.status, 201);
  const duplicateBarcodeEdit = await request(baseUrl, first.sessionToken, `/api/products/${product.id}`, {
    method: 'PUT', body: JSON.stringify({ barcode: '12345670' }),
  });
  assert.equal(duplicateBarcodeEdit.status, 409);

  const decrementStock = await request(baseUrl, first.sessionToken, `/api/products/${product.id}`, {
    method: 'PUT', body: JSON.stringify({ quantityOnHand: 6 }),
  });
  assert.equal(decrementStock.status, 200);
  const decrement = db.prepare(`SELECT movement_type, quantity FROM inventory_movements WHERE business_id = ? AND product_id = ? ORDER BY id DESC LIMIT 1`).get(product.business_id, product.id);
  assert.deepEqual(decrement, { movement_type: 'adjustment', quantity: -7 });

  const historicalAfterEdit = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').get(saleId);
  assert.equal(historicalAfterEdit.product_name_snapshot, 'Old name');
  assert.equal(historicalAfterEdit.unit_price_cents, 1000);
  assert.equal(historicalAfterEdit.unit_cost_cents, 400);

  const listResponse = await request(baseUrl, first.sessionToken, '/api/products');
  const list = (await listResponse.json()).products;
  assert.ok(list.some((entry) => entry.id === product.id && entry.name === 'New name'));

  const invalidBarcode = await request(baseUrl, first.sessionToken, `/api/products/${product.id}`, {
    method: 'PUT', body: JSON.stringify({ barcode: '12345671' }),
  });
  assert.equal(invalidBarcode.status, 400);

  const invalidImage = await request(baseUrl, first.sessionToken, `/api/products/${product.id}`, {
    method: 'PUT', body: JSON.stringify({ imageUrl: 'javascript:alert(1)' }),
  });
  assert.equal(invalidImage.status, 400);

  const negativeStock = await request(baseUrl, first.sessionToken, `/api/products/${product.id}`, {
    method: 'PUT', body: JSON.stringify({ quantityOnHand: -1 }),
  });
  assert.equal(negativeStock.status, 400);
  const blankPrice = await request(baseUrl, first.sessionToken, `/api/products/${product.id}`, {
    method: 'PUT', body: JSON.stringify({ price: '' }),
  });
  assert.equal(blankPrice.status, 400);
  const invalidActiveStatus = await request(baseUrl, first.sessionToken, `/api/products/${product.id}`, {
    method: 'PUT', body: JSON.stringify({ isActive: 'maybe' }),
  });
  assert.equal(invalidActiveStatus.status, 400);

  const archiveResponse = await request(baseUrl, first.sessionToken, `/api/products/${product.id}/archive`, { method: 'POST' });
  assert.equal(archiveResponse.status, 200);
  assert.equal((await archiveResponse.json()).product.is_active, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM sale_items WHERE product_id = ?').get(product.id).count, 1, 'archive retains sale history');
  const unavailableSearch = await request(baseUrl, first.sessionToken, '/api/products/search?q=New%20name');
  assert.deepEqual((await unavailableSearch.json()).products, []);
  const inactiveEdit = await request(baseUrl, first.sessionToken, `/api/products/${product.id}`, {
    method: 'PUT', body: JSON.stringify({ name: 'Archived but editable', isActive: false }),
  });
  assert.equal(inactiveEdit.status, 200);
  assert.equal((await inactiveEdit.json()).product.name, 'Archived but editable');
});
