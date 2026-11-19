const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const db = require('../src/api/database');
const { cleanupBusiness, cleanupGlobalCatalogueProduct } = require('./helpers/database');
const suffix = crypto.randomUUID();
process.env.CATALOGUE_ADMIN_EMAILS = `catalogue-admin-${suffix}@example.com`;
const app = require('../server');

function startServer() {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function register(baseUrl, email, businessName) {
  const response = await fetch(`${baseUrl}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstName: 'Catalog', lastName: 'Tester', email, password: 'StrongPassword!123', businessName, businessType: 'retail' }),
  });
  assert.equal(response.status, 201);
  return response.json();
}

async function request(baseUrl, token, endpoint, options = {}) {
  return fetch(`${baseUrl}${endpoint}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });
}

function ean8() {
  const body = String(crypto.randomInt(1000000, 10000000));
  const digits = body.split('').map(Number);
  const weightedTotal = digits.reduce(
    (total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1),
    0
  );
  return `${body}${(10 - (weightedTotal % 10)) % 10}`;
}

test('verified barcode imports are business-scoped and CSV barcodes stay unverified', async (t) => {
  const server = await startServer();
  const accounts = [];
  const catalogueIds = [];
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    for (const account of accounts) {
      await cleanupBusiness(db, account.businessId, account.userId);
    }
    for (const id of catalogueIds) {
      await cleanupGlobalCatalogueProduct(db, id);
    }
    await db.end();
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const first = await register(baseUrl, `catalogue-one-${suffix}@example.com`, `Catalogue One ${suffix}`);
  const second = await register(baseUrl, `catalogue-two-${suffix}@example.com`, `Catalogue Two ${suffix}`);
  const platformAdmin = await register(baseUrl, `catalogue-admin-${suffix}@example.com`, `Catalogue Admin ${suffix}`);
  for (const account of [first, second, platformAdmin]) {
    const [sessions] = await db.execute('SELECT user_id, business_id FROM sessions WHERE id = ?', [account.sessionToken]);
    accounts.push({ businessId: sessions[0].business_id, userId: sessions[0].user_id });
  }
  const verifiedBarcode = ean8();
  const secondBarcodeValue = ean8();
  const delayedBarcodeValue = ean8();
  const csvBarcode = ean8();
  const fixtureName = `Fixture item ${suffix}`;
  const secondFixtureName = `Second fixture item ${suffix}`;
  const delayedFixtureName = `Delayed verification fixture ${suffix}`;
  assert.equal((await (await request(baseUrl, platformAdmin.sessionToken, '/api/admin/catalogue-access')).json()).isAdmin, true);
  assert.equal((await (await request(baseUrl, first.sessionToken, '/api/admin/catalogue-access')).json()).isAdmin, false);
  assert.equal((await request(baseUrl, first.sessionToken, '/api/admin/global-catalogue')).status, 403);
  const candidateCreate = await request(baseUrl, platformAdmin.sessionToken, '/api/admin/global-catalogue', {
    method: 'POST',
    body: JSON.stringify({
      productName: `Candidate fixture ${suffix}`,
      brand: 'Synthetic test brand',
      dataSource: 'Automated test fixture',
    }),
  });
  assert.equal(candidateCreate.status, 201);
  const candidateId = (await candidateCreate.json()).product.id;
  catalogueIds.push(candidateId);
  const candidateResponse = await request(
    baseUrl,
    first.sessionToken,
    `/api/global-catalogue?q=${encodeURIComponent(`Candidate fixture ${suffix}`)}`
  );
  const candidate = (await candidateResponse.json()).products.find(
    (item) => item.product_name === `Candidate fixture ${suffix}`
  );
  assert.equal(candidate.verification_status, 'incomplete');
  assert.equal(candidate.barcode, null, 'starter catalogue must not invent a GTIN');

  const deniedAdminAction = await request(baseUrl, first.sessionToken, '/api/admin/global-catalogue', {
    method: 'POST',
    body: JSON.stringify({ productName: `Must not be global-admin-created ${suffix}`, dataSource: 'test' }),
  });
  assert.equal(deniedAdminAction.status, 403);

  const createCatalogue = await request(baseUrl, platformAdmin.sessionToken, '/api/admin/global-catalogue', {
    method: 'POST',
    body: JSON.stringify({ productName: fixtureName, brand: 'Test-only brand', packagingSize: 'test pack', category: 'Fixtures', description: 'Synthetic test fixture only', dataSource: 'Automated test fixture' }),
  });
  assert.equal(createCatalogue.status, 201);
  const catalogueId = (await createCatalogue.json()).product.id;
  catalogueIds.push(catalogueId);

  const addBarcode = await request(baseUrl, platformAdmin.sessionToken, `/api/admin/global-catalogue/${catalogueId}/barcodes`, {
    method: 'POST',
    body: JSON.stringify({ barcode: verifiedBarcode, dataSource: 'Synthetic automated test fixture' }),
  });
  assert.equal(addBarcode.status, 201);
  const barcodeId = (await addBarcode.json()).barcode.id;

  const rejectInsecureVerification = await request(baseUrl, platformAdmin.sessionToken, `/api/admin/global-catalogue/barcodes/${barcodeId}/verify`, {
    method: 'POST', body: JSON.stringify({ sourceUrl: 'http://example.test/record' }),
  });
  assert.equal(rejectInsecureVerification.status, 400);
  const verified = await request(baseUrl, platformAdmin.sessionToken, `/api/admin/global-catalogue/barcodes/${barcodeId}/verify`, {
    method: 'POST', body: JSON.stringify({ sourceUrl: 'https://example.test/verified-test-fixture' }),
  });
  assert.equal(verified.status, 200);
  const adminList = await request(baseUrl, platformAdmin.sessionToken, `/api/admin/global-catalogue?q=${encodeURIComponent(fixtureName)}`);
  assert.equal(adminList.status, 200);
  assert.ok((await adminList.json()).products.some((entry) => entry.barcode === verifiedBarcode && entry.barcode_verification_status === 'verified'));

  const secondGlobalResponse = await request(baseUrl, platformAdmin.sessionToken, '/api/admin/global-catalogue', {
    method: 'POST',
    body: JSON.stringify({ productName: secondFixtureName, brand: 'Fixture brand', category: 'Fixtures', dataSource: 'Automated test fixture' }),
  });
  const secondGlobal = (await secondGlobalResponse.json()).product;
  catalogueIds.push(secondGlobal.id);
  const duplicateBarcodeClaim = await request(baseUrl, platformAdmin.sessionToken, `/api/admin/global-catalogue/${secondGlobal.id}/barcodes`, {
    method: 'POST', body: JSON.stringify({ barcode: verifiedBarcode, dataSource: 'Duplicate test claim' }),
  });
  assert.equal(duplicateBarcodeClaim.status, 409);
  const secondBarcodeResponse = await request(baseUrl, platformAdmin.sessionToken, `/api/admin/global-catalogue/${secondGlobal.id}/barcodes`, {
    method: 'POST', body: JSON.stringify({ barcode: secondBarcodeValue, dataSource: 'Synthetic automated test fixture' }),
  });
  const secondBarcode = (await secondBarcodeResponse.json()).barcode;
  assert.equal(secondBarcodeResponse.status, 201);
  assert.equal((await request(baseUrl, platformAdmin.sessionToken, `/api/admin/global-catalogue/barcodes/${secondBarcode.id}/verify`, {
    method: 'POST', body: JSON.stringify({ sourceUrl: 'https://example.test/second-fixture' }),
  })).status, 200);

  const delayedGlobalResponse = await request(baseUrl, platformAdmin.sessionToken, '/api/admin/global-catalogue', {
    method: 'POST',
    body: JSON.stringify({ productName: delayedFixtureName, brand: 'Fixture brand', category: 'Fixtures', dataSource: 'Automated test fixture' }),
  });
  const delayedGlobal = (await delayedGlobalResponse.json()).product;
  catalogueIds.push(delayedGlobal.id);
  const delayedImportResponse = await request(baseUrl, first.sessionToken, `/api/global-catalogue/${delayedGlobal.id}/import`, {
    method: 'POST', body: JSON.stringify({ price: 7.25, cost: 3, initialStock: 4, reorderLevel: 1 }),
  });
  const delayedImported = (await delayedImportResponse.json()).product;
  assert.equal(delayedImportResponse.status, 201);
  assert.equal((await request(baseUrl, first.sessionToken, `/api/products/barcode/${delayedBarcodeValue}`)).status, 404);
  const delayedBarcodeResponse = await request(baseUrl, platformAdmin.sessionToken, `/api/admin/global-catalogue/${delayedGlobal.id}/barcodes`, {
    method: 'POST', body: JSON.stringify({ barcode: delayedBarcodeValue, dataSource: 'Synthetic automated test fixture' }),
  });
  const delayedBarcode = (await delayedBarcodeResponse.json()).barcode;
  assert.equal(delayedBarcodeResponse.status, 201);
  assert.equal((await request(baseUrl, platformAdmin.sessionToken, `/api/admin/global-catalogue/barcodes/${delayedBarcode.id}/verify`, {
    method: 'POST', body: JSON.stringify({ sourceUrl: 'https://example.test/delayed-fixture' }),
  })).status, 200);
  const delayedLookup = await request(baseUrl, first.sessionToken, `/api/products/barcode/${delayedBarcodeValue}`);
  assert.equal(delayedLookup.status, 200);
  const delayedScanned = (await delayedLookup.json()).product;
  assert.equal(delayedScanned.id, delayedImported.id);
  assert.equal(delayedScanned.price_cents, 725);
  assert.equal(delayedScanned.quantity_on_hand, 4);

  const catalogueSearch = await request(baseUrl, first.sessionToken, `/api/global-catalogue?q=${encodeURIComponent(fixtureName)}`);
  assert.equal(catalogueSearch.status, 200);
  const catalogueResults = (await catalogueSearch.json()).products;
  assert.equal(catalogueResults.find((product) => product.product_name === fixtureName).barcode, verifiedBarcode);
  assert.equal(Object.hasOwn(catalogueResults[0], 'price_cents'), false, 'shared catalogue must not expose business pricing');

  const importResponse = await request(baseUrl, first.sessionToken, `/api/global-catalogue/${catalogueId}/import`, {
    method: 'POST',
    body: JSON.stringify({ price: 4.5, cost: 2, initialStock: 5, reorderLevel: 1 }),
  });
  assert.equal(importResponse.status, 201);
  const imported = (await importResponse.json()).product;
  assert.equal(imported.barcode, verifiedBarcode);
  assert.equal(imported.barcode_status, 'verified');
  assert.equal(imported.price_cents, 450);

  const secondImportResponse = await request(baseUrl, first.sessionToken, `/api/global-catalogue/${secondGlobal.id}/import`, {
    method: 'POST', body: JSON.stringify({ price: 12, cost: 5, initialStock: 3, reorderLevel: 1 }),
  });
  assert.equal(secondImportResponse.status, 201);
  const secondImported = (await secondImportResponse.json()).product;

  const scanResponse = await request(baseUrl, first.sessionToken, `/api/products/barcode/${verifiedBarcode}`);
  assert.equal(scanResponse.status, 200);
  const scanned = (await scanResponse.json()).product;
  assert.equal(scanned.id, imported.id);
  assert.equal(scanned.price_cents, 450);
  assert.equal(scanned.quantity_on_hand, 5);
  assert.equal(scanned.barcode, verifiedBarcode);

  const secondTenantLookup = await request(baseUrl, second.sessionToken, `/api/products/barcode/${verifiedBarcode}`);
  assert.equal(secondTenantLookup.status, 404, 'verified barcode in one tenant must not expose its product to another tenant');

  const search = await request(baseUrl, first.sessionToken, `/api/products/search?q=${encodeURIComponent(fixtureName)}`);
  const searchProduct = (await search.json()).products.find((product) => product.barcode === verifiedBarcode);
  assert.equal(searchProduct.sku, null);
  assert.equal(searchProduct.quantity_on_hand, 5);
  assert.equal(searchProduct.barcode, verifiedBarcode);

  const csvResponse = await request(baseUrl, first.sessionToken, '/api/products/import-csv', {
    method: 'POST',
    body: JSON.stringify({
      csv: `name,brand,barcode,sku,category,price,cost,initialStock,reorderLevel\nCSV item ${suffix},Example,${csvBarcode},CSV-1,Other,10,4,3,1\nCSV duplicate ${suffix},Example,${csvBarcode},CSV-3,Other,10,4,3,1\nCSV item 2 ${suffix},Example,invalid,CSV-2,Other,10,4,3,1\n`,
    }),
  });
  assert.equal(csvResponse.status, 200, await csvResponse.clone().text());
  const summary = (await csvResponse.json()).summary;
  assert.equal(summary.imported, 1);
  assert.equal(summary.duplicates, 1);
  assert.equal(summary.invalid, 1);
  assert.equal(summary.incomplete, 1, 'CSV barcode is not verified by importing an asserted status');

  const csvScan = await request(baseUrl, first.sessionToken, `/api/products/barcode/${csvBarcode}`);
  assert.equal(csvScan.status, 404, 'checksum-valid CSV barcode is not treated as verified product identity');

  const multiSaleResponse = await request(baseUrl, first.sessionToken, '/api/sales', {
    method: 'POST',
    headers: { 'Idempotency-Key': 'barcode-catalogue-sale-1' },
    body: JSON.stringify({ items: [{ productId: imported.id, quantity: 2 }, { productId: secondImported.id, quantity: 1 }], paymentMethod: 'cash' }),
  });
  assert.equal(multiSaleResponse.status, 201);
  assert.equal((await multiSaleResponse.json()).sale.total_cents, 2100);
  const inventory = await request(baseUrl, first.sessionToken, '/api/inventory');
  const stockRows = (await inventory.json()).inventory;
  assert.equal(stockRows.find((row) => row.product_id === imported.id).quantity_on_hand, 3);
  assert.equal(stockRows.find((row) => row.product_id === secondImported.id).quantity_on_hand, 2);
  const dashboard = await (await request(baseUrl, first.sessionToken, '/api/dashboard')).json();
  assert.equal(dashboard.summary.today.revenueCents, 2100);
  assert.equal(dashboard.summary.today.itemsSold, 3);

  const exportResponse = await request(baseUrl, first.sessionToken, '/api/products/export.csv');
  assert.equal(exportResponse.status, 200);
  assert.match(exportResponse.headers.get('content-type'), /text\/csv/);
  assert.match(await exportResponse.text(), new RegExp(fixtureName));
});

test('EAN and UPC check digits validate supported formats and reject invalid input', () => {
  const { normalizeBarcode } = require('../src/api/barcodes');
  assert.deepEqual(normalizeBarcode('12345670'), { barcode: '12345670', format: 'EAN-8' });
  assert.throws(() => normalizeBarcode('12345671'), { message: 'INVALID_BARCODE' });
  assert.throws(() => normalizeBarcode('not-a-barcode'), { message: 'INVALID_BARCODE' });
});
