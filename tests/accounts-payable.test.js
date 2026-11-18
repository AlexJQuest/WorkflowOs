const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
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

test('supplier invoices link expenses, record payments, receive stock, and isolate tenants', async (t) => {
  const server = await new Promise((resolve) => {
    const listeningServer = app.listen(0, () => resolve(listeningServer));
  });
  let owner = null;
  let other = null;
  let privateStorage = null;
  const previousStorage = process.env.WORKFLOWOS_PRIVATE_STORAGE_DIR;

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    for (const account of [owner, other]) {
      if (!account) continue;
      const { businessId, userId } = account;
      await db.execute('DELETE FROM document_extraction_suggestions WHERE business_id = ?', [businessId]);
      await db.execute('DELETE FROM financial_documents WHERE business_id = ?', [businessId]);
      await db.execute('DELETE FROM financial_audit_events WHERE business_id = ?', [businessId]);
      await db.execute('DELETE FROM supplier_stock_receipt_items WHERE business_id = ?', [businessId]);
      await db.execute('DELETE FROM supplier_stock_receipts WHERE business_id = ?', [businessId]);
      await db.execute('DELETE FROM product_cost_history WHERE business_id = ?', [businessId]);
      await db.execute('DELETE FROM supplier_invoice_audit_events WHERE business_id = ?', [businessId]);
      await db.execute('DELETE FROM supplier_invoice_payments WHERE business_id = ?', [businessId]);
      await db.execute('DELETE FROM supplier_invoice_items WHERE business_id = ?', [businessId]);
      await db.execute('DELETE FROM supplier_invoices WHERE business_id = ?', [businessId]);
      await db.execute('DELETE FROM expense_payments WHERE business_id = ?', [businessId]);
      await db.execute('DELETE FROM expenses WHERE business_id = ?', [businessId]);
      await db.execute('DELETE FROM inventory_movements WHERE business_id = ?', [businessId]);
      await db.execute('DELETE FROM inventory WHERE business_id = ?', [businessId]);
      await db.execute('DELETE FROM products WHERE business_id = ?', [businessId]);
      await db.execute('DELETE FROM expense_suppliers WHERE business_id = ?', [businessId]);
      await db.execute('DELETE FROM business_settings WHERE business_id = ?', [businessId]);
      await db.execute('DELETE FROM business_memberships WHERE business_id = ?', [businessId]);
      await db.execute('DELETE FROM sessions WHERE user_id = ?', [userId]);
      await db.execute('DELETE FROM businesses WHERE id = ?', [businessId]);
      await db.execute('DELETE FROM users WHERE id = ?', [userId]);
    }
    await db.end();
    if (previousStorage === undefined) delete process.env.WORKFLOWOS_PRIVATE_STORAGE_DIR;
    else process.env.WORKFLOWOS_PRIVATE_STORAGE_DIR = previousStorage;
    if (privateStorage) await fs.rm(privateStorage, { recursive: true, force: true });
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const suffix = crypto.randomUUID();
  const register = async (label) => {
    const response = await request(baseUrl, null, '/api/register', {
      method: 'POST',
      body: JSON.stringify({
        firstName: 'Payables',
        lastName: label,
        email: `payables-${label}-${suffix}@example.com`,
        password: 'StrongPassword!123',
        businessName: `Payables ${label} ${suffix}`,
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

  const supplierResponse = await request(baseUrl, owner.token, '/api/expenses/suppliers', {
    method: 'POST',
    body: JSON.stringify({ name: `Supplier ${suffix}`, email: 'supplier@example.com' }),
  });
  assert.equal(supplierResponse.status, 201);
  const supplier = (await supplierResponse.json()).supplier;
  const productResponse = await request(baseUrl, owner.token, '/api/products', {
    method: 'POST',
    body: JSON.stringify({
      name: `Received product ${suffix}`,
      price: 12,
      cost: 4,
      initialStock: 0,
      reorderLevel: 1,
    }),
  });
  assert.equal(productResponse.status, 201);
  const product = (await productResponse.json()).product;
  const today = new Date().toISOString().slice(0, 10);
  const invoicePayload = {
    supplierId: supplier.id,
    supplierInvoiceNumber: `SUP-${suffix}`,
    invoiceDate: today,
    receivedDate: today,
    dueDate: today,
    items: [{ productId: product.id, quantity: '2', unitPriceCents: 500 }],
  };

  const invoiceResponse = await request(baseUrl, owner.token, '/api/supplier-invoices', {
    method: 'POST',
    body: JSON.stringify(invoicePayload),
  });
  assert.equal(invoiceResponse.status, 201);
  const invoice = (await invoiceResponse.json()).supplierInvoice;
  assert.equal(invoice.total_cents, 1000);
  assert.equal(invoice.outstanding_cents, 1000);
  assert.equal(invoice.items.length, 1);

  privateStorage = path.join(os.tmpdir(), `workflowos-financial-documents-${suffix}`);
  process.env.WORKFLOWOS_PRIVATE_STORAGE_DIR = privateStorage;
  const pdfBuffer = Buffer.from('%PDF-1.7\n% private supplier invoice\n');
  const documentUpload = await request(
    baseUrl,
    owner.token,
    `/api/supplier-invoices/${invoice.id}/documents`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/pdf', 'X-File-Name': 'supplier-invoice.pdf' },
      body: pdfBuffer,
    }
  );
  assert.equal(documentUpload.status, 201);
  const documentId = (await documentUpload.json()).document.id;
  const documentPreview = await request(baseUrl, owner.token, `/api/documents/${documentId}/preview`);
  assert.equal(documentPreview.status, 200);
  assert.equal(Buffer.from(await documentPreview.arrayBuffer()).toString(), pdfBuffer.toString());
  const crossTenantDocument = await request(
    baseUrl,
    other.token,
    `/api/documents/${documentId}/preview`
  );
  assert.equal(crossTenantDocument.status, 404);
  const invalidDocument = await request(
    baseUrl,
    owner.token,
    `/api/supplier-invoices/${invoice.id}/documents`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/pdf', 'X-File-Name': 'fake.pdf' },
      body: Buffer.from('not a PDF'),
    }
  );
  assert.equal(invalidDocument.status, 400);

  const duplicate = await request(baseUrl, owner.token, '/api/supplier-invoices', {
    method: 'POST',
    body: JSON.stringify(invoicePayload),
  });
  assert.equal(duplicate.status, 409);

  const existingExpenseResponse = await request(baseUrl, owner.token, '/api/expenses', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Existing supplier bill',
      supplierId: supplier.id,
      referenceNumber: invoice.supplier_invoice_number,
      expenseDate: today,
      dueDate: today,
      subtotalCents: invoice.total_cents,
      taxCents: 0,
    }),
  });
  assert.equal(existingExpenseResponse.status, 201);
  const existingExpense = (await existingExpenseResponse.json()).expense;
  const automaticLink = await request(
    baseUrl,
    owner.token,
    `/api/supplier-invoices/${invoice.id}/expense`,
    { method: 'POST', body: JSON.stringify({}) }
  );
  assert.equal(automaticLink.status, 409);
  assert.equal(
    (await automaticLink.json()).error,
    'An expense already uses this supplier invoice reference; link the existing expense'
  );
  const linked = await request(
    baseUrl,
    owner.token,
    `/api/supplier-invoices/${invoice.id}/expense`,
    { method: 'POST', body: JSON.stringify({ expenseId: existingExpense.id }) }
  );
  assert.equal(linked.status, 200);
  const expenseId = (await linked.json()).expenseId;
  assert.equal(expenseId, existingExpense.id);

  const directExpensePayment = await request(
    baseUrl,
    owner.token,
    `/api/expenses/${expenseId}/payments`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': `direct-expense-payment-${suffix}` },
      body: JSON.stringify({ amountCents: 100, paymentDate: today, paymentMethod: 'eft' }),
    }
  );
  assert.equal(directExpensePayment.status, 409);
  const editLinkedExpense = await request(baseUrl, owner.token, `/api/expenses/${expenseId}`, {
    method: 'PUT',
    body: JSON.stringify({ title: 'Do not detach this payable' }),
  });
  assert.equal(editLinkedExpense.status, 409);
  const cancelLinkedExpense = await request(baseUrl, owner.token, `/api/expenses/${expenseId}`, {
    method: 'DELETE',
  });
  assert.equal(cancelLinkedExpense.status, 409);

  const summaryResponse = await request(baseUrl, owner.token, '/api/supplier-invoices/summary');
  assert.equal(summaryResponse.status, 200);
  const summary = (await summaryResponse.json()).summary;
  assert.equal(summary.outstandingCents, 1000);

  const paymentPayload = {
    amountCents: 400,
    paymentDate: today,
    paymentMethod: 'eft',
    reference: `BANK-${suffix}`,
  };
  const paymentResponses = await Promise.all([1, 2].map(() => request(
    baseUrl,
    owner.token,
    `/api/supplier-invoices/${invoice.id}/payments`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': `supplier-payment-${suffix}` },
      body: JSON.stringify(paymentPayload),
    }
  )));
  assert.deepEqual(paymentResponses.map((response) => response.status).sort(), [200, 201]);
  const paymentBodies = await Promise.all(paymentResponses.map((response) => response.json()));
  assert.equal(paymentBodies.filter((body) => body.replayed).length, 1);
  assert.equal(paymentBodies[0].invoice.outstanding_cents, 600);
  const expensePayments = await request(baseUrl, owner.token, `/api/expenses/${expenseId}/payments`);
  assert.equal(expensePayments.status, 200);
  assert.equal((await expensePayments.json()).payments.length, 1);

  const stockPayload = {
    notes: 'First delivery',
    items: [{ supplierInvoiceItemId: invoice.items[0].id, quantity: 1, updateCost: true }],
  };
  const stockHeaders = { 'Idempotency-Key': `stock-receipt-${suffix}` };
  const stockResponses = await Promise.all([1, 2].map(() => request(
    baseUrl,
    owner.token,
    `/api/supplier-invoices/${invoice.id}/stock-receipts`,
    { method: 'POST', headers: stockHeaders, body: JSON.stringify(stockPayload) }
  )));
  assert.deepEqual(stockResponses.map((response) => response.status).sort(), [200, 201]);
  const stockBodies = await Promise.all(stockResponses.map((response) => response.json()));
  assert.equal(stockBodies.filter((body) => body.replayed).length, 1);

  const inventoryResponse = await request(baseUrl, owner.token, '/api/inventory');
  const inventory = (await inventoryResponse.json()).inventory;
  assert.equal(Number(inventory.find((row) => row.product_id === product.id).quantity_on_hand), 1);

  const payableReport = await request(
    baseUrl,
    owner.token,
    `/api/reports/payables?period=custom&startDate=${today}&endDate=${today}&status=outstanding`
  );
  assert.equal(payableReport.status, 200);
  const report = await payableReport.json();
  assert.equal(report.summary.outstandingCents, 600);
  assert.equal(report.invoices.length, 1);

  const supplierStatement = await request(
    baseUrl,
    owner.token,
    `/api/suppliers/${supplier.id}/statement.pdf?startDate=${today}&endDate=${today}`
  );
  assert.equal(supplierStatement.status, 200);
  assert.equal(
    Buffer.from(await supplierStatement.arrayBuffer()).subarray(0, 5).toString(),
    '%PDF-'
  );

  const otherTenantRead = await request(baseUrl, other.token, `/api/supplier-invoices/${invoice.id}`);
  assert.equal(otherTenantRead.status, 404);
});
