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

test('invoice drafts, issuance, numbering, payments, and tenant isolation', async (t) => {
  const server = await new Promise((resolve) => {
    const listeningServer = app.listen(0, () => resolve(listeningServer));
  });
  let owner = null;
  let other = null;
  const previousStorage = process.env.WORKFLOWOS_PRIVATE_STORAGE_DIR;
  const privateStorage = path.join(os.tmpdir(), `workflowos-invoice-documents-${crypto.randomUUID()}`);
  process.env.WORKFLOWOS_PRIVATE_STORAGE_DIR = privateStorage;

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    for (const account of [owner, other]) {
      if (!account) continue;
      const { businessId, userId } = account;
      await db.execute('DELETE FROM document_extraction_suggestions WHERE business_id = ?', [businessId]);
      await db.execute('DELETE FROM financial_audit_events WHERE business_id = ?', [businessId]);
      await db.execute('DELETE FROM invoice_email_logs WHERE business_id = ?', [businessId]);
      await db.execute('DELETE FROM invoice_credit_items WHERE business_id = ?', [businessId]);
      await db.execute('DELETE FROM invoice_credit_notes WHERE business_id = ?', [businessId]);
      await db.execute('DELETE FROM invoice_audit_events WHERE business_id = ?', [businessId]);
      await db.execute('DELETE FROM invoice_payments WHERE business_id = ?', [businessId]);
      await db.execute('DELETE FROM invoice_items WHERE business_id = ?', [businessId]);
      await db.execute('DELETE FROM invoices WHERE business_id = ?', [businessId]);
      await db.execute('DELETE FROM invoice_sequences WHERE business_id = ?', [businessId]);
      await db.execute('DELETE FROM receipt_sequences WHERE business_id = ?', [businessId]);
      await db.execute('DELETE FROM credit_note_sequences WHERE business_id = ?', [businessId]);
      await db.execute('DELETE FROM invoice_settings WHERE business_id = ?', [businessId]);
      await db.execute('DELETE FROM financial_documents WHERE business_id = ?', [businessId]);
      await db.execute('DELETE FROM customers WHERE business_id = ?', [businessId]);
      await db.execute('DELETE FROM business_settings WHERE business_id = ?', [businessId]);
      await db.execute('DELETE FROM business_memberships WHERE business_id = ?', [businessId]);
      await db.execute('DELETE FROM sessions WHERE user_id = ?', [userId]);
      await db.execute('DELETE FROM businesses WHERE id = ?', [businessId]);
      await db.execute('DELETE FROM users WHERE id = ?', [userId]);
    }
    await db.end();
    if (previousStorage === undefined) delete process.env.WORKFLOWOS_PRIVATE_STORAGE_DIR;
    else process.env.WORKFLOWOS_PRIVATE_STORAGE_DIR = previousStorage;
    await fs.rm(privateStorage, { recursive: true, force: true });
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const suffix = crypto.randomUUID();
  const register = async (label) => {
    const response = await request(baseUrl, null, '/api/register', {
      method: 'POST',
      body: JSON.stringify({
        firstName: 'Invoice',
        lastName: label,
        email: `invoice-${label}-${suffix}@example.com`,
        password: 'StrongPassword!123',
        businessName: `Invoice ${label} ${suffix}`,
        businessType: 'retail',
      }),
    });
    assert.equal(response.status, 201);
    const body = await response.json();
    const session = await (await request(baseUrl, body.sessionToken, '/api/session')).json();
    return {
      token: body.sessionToken,
      businessId: session.business.id,
      userId: session.user.id,
    };
  };
  owner = await register('Owner');
  other = await register('Other');

  const createCustomer = async (account, name) => {
    const response = await request(baseUrl, account.token, '/api/customers', {
      method: 'POST',
      body: JSON.stringify({ name, email: `${name.toLowerCase()}@example.com` }),
    });
    assert.equal(response.status, 201);
    return (await response.json()).customer;
  };
  const customer = await createCustomer(owner, 'Invoice Customer');
  const otherCustomer = await createCustomer(other, 'Other Customer');
  const today = new Date().toISOString().slice(0, 10);
  const draftPayload = {
    customerId: customer.id,
    invoiceDate: today,
    dueDate: today,
    customerBillingAddress: '1 Market Street',
    items: [
      {
        itemType: 'service',
        name: 'Consulting',
        quantity: '1.5',
        unitPriceCents: 1001,
        discountCents: 100,
        taxRateBps: 1500,
      },
      {
        itemType: 'custom',
        name: 'Tax-inclusive item',
        quantity: '1',
        unitPriceCents: 1150,
        taxRateBps: 1500,
        taxInclusive: true,
      },
    ],
  };

  const crossTenantDraft = await request(baseUrl, owner.token, '/api/invoices', {
    method: 'POST',
    body: JSON.stringify({ ...draftPayload, customerId: otherCustomer.id }),
  });
  assert.equal(crossTenantDraft.status, 400);

  const draftResponse = await request(baseUrl, owner.token, '/api/invoices', {
    method: 'POST',
    body: JSON.stringify(draftPayload),
  });
  assert.equal(draftResponse.status, 201);
  let invoice = (await draftResponse.json()).invoice;
  const invoiceId = invoice.id;
  assert.equal(invoice.status, 'draft');
  assert.equal(invoice.invoice_number, null);
  assert.equal(invoice.subtotal_cents, 2652);
  assert.equal(invoice.discount_cents, 100);
  assert.equal(invoice.tax_cents, 360);
  assert.equal(invoice.total_cents, 2762);
  assert.equal(invoice.outstanding_cents, 2762);

  const updateResponse = await request(baseUrl, owner.token, `/api/invoices/${invoiceId}`, {
    method: 'PUT',
    body: JSON.stringify({ ...draftPayload, notes: 'Updated before issue' }),
  });
  assert.equal(updateResponse.status, 200);

  const settingsResponse = await request(baseUrl, owner.token, '/api/invoices/settings', {
    method: 'PUT',
    body: JSON.stringify({ numberPrefix: 'BILL' }),
  });
  assert.equal(settingsResponse.status, 200);
  assert.equal((await settingsResponse.json()).settings.numberPrefix, 'BILL');
  const logo = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/r9sAAAAASUVORK5CYII=',
    'base64'
  );
  const logoUpload = await request(baseUrl, owner.token, '/api/business/invoice-logo', {
    method: 'POST',
    headers: { 'Content-Type': 'image/png', 'X-File-Name': 'logo.png' },
    body: logo,
  });
  assert.equal(logoUpload.status, 201);
  const logoDocumentId = (await logoUpload.json()).document.id;
  const bankSettings = await request(baseUrl, owner.token, '/api/invoices/settings', {
    method: 'PUT',
    body: JSON.stringify({
      numberPrefix: 'BILL',
      bankAccountName: 'WorkflowOS Test',
      bankName: 'Test Bank',
      bankAccountNumber: '12345678',
      bankBranchCode: '000001',
      bankAccountType: 'Cheque',
      paymentInstructions: 'Use the invoice number as your reference.',
      logoDocumentId,
    }),
  });
  assert.equal(bankSettings.status, 200);
  assert.equal((await bankSettings.json()).settings.bankName, 'Test Bank');

  const issueResponse = await request(baseUrl, owner.token, `/api/invoices/${invoiceId}/issue`, {
    method: 'POST',
  });
  assert.equal(issueResponse.status, 200);
  invoice = (await issueResponse.json()).invoice;
  assert.match(invoice.invoice_number, new RegExp(`^BILL-${new Date().getUTCFullYear()}-\\d{6}$`));
  assert.equal(invoice.status, 'issued');

  const pdfResponse = await request(baseUrl, owner.token, `/api/invoices/${invoiceId}/pdf`);
  assert.equal(pdfResponse.status, 200);
  assert.match(pdfResponse.headers.get('content-type'), /application\/pdf/);
  const pdfBytes = Buffer.from(await pdfResponse.arrayBuffer());
  assert.equal(pdfBytes.subarray(0, 5).toString(), '%PDF-');

  const immutableResponse = await request(baseUrl, owner.token, `/api/invoices/${invoiceId}`, {
    method: 'PUT',
    body: JSON.stringify(draftPayload),
  });
  assert.equal(immutableResponse.status, 409);

  const idempotencyKey = `invoice-payment-${suffix}`;
  const paymentPayload = {
    amountCents: 500,
    paymentDate: today,
    paymentMethod: 'eft',
    reference: `PAY-${suffix}`,
  };
  const simultaneousPayments = await Promise.all([1, 2].map(() => request(
    baseUrl,
    owner.token,
    `/api/invoices/${invoiceId}/payments`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(paymentPayload),
    }
  )));
  assert.deepEqual(simultaneousPayments.map((response) => response.status).sort(), [200, 201]);
  const simultaneousPaymentBodies = await Promise.all(
    simultaneousPayments.map((response) => response.json())
  );
  assert.equal(simultaneousPaymentBodies.filter((body) => body.replayed).length, 1);
  invoice = simultaneousPaymentBodies[0].invoice;
  assert.equal(invoice.status, 'partially_paid');
  assert.equal(invoice.paid_cents, 500);
  assert.equal(invoice.outstanding_cents, 2262);

  const replay = await request(baseUrl, owner.token, `/api/invoices/${invoiceId}/payments`, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(paymentPayload),
  });
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).replayed, true);

  const conflict = await request(baseUrl, owner.token, `/api/invoices/${invoiceId}/payments`, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({ ...paymentPayload, amountCents: 600 }),
  });
  assert.equal(conflict.status, 409);

  const overpayment = await request(baseUrl, owner.token, `/api/invoices/${invoiceId}/payments`, {
    method: 'POST',
    headers: { 'Idempotency-Key': `overpay-${suffix}` },
    body: JSON.stringify({ ...paymentPayload, amountCents: 2263 }),
  });
  assert.equal(overpayment.status, 409);

  const finalPayment = await request(baseUrl, owner.token, `/api/invoices/${invoiceId}/payments`, {
    method: 'POST',
    headers: { 'Idempotency-Key': `final-payment-${suffix}` },
    body: JSON.stringify({ ...paymentPayload, amountCents: 2262 }),
  });
  assert.equal(finalPayment.status, 201);
  const finalPaymentBody = await finalPayment.json();
  invoice = finalPaymentBody.invoice;
  assert.equal(invoice.status, 'paid');
  assert.equal(invoice.outstanding_cents, 0);
  assert.match(finalPaymentBody.payment.receipt_number, /^RCPT-\d{4}-\d{6}$/);

  const receiptPdf = await request(
    baseUrl,
    owner.token,
    `/api/invoice-payments/${finalPaymentBody.payment.id}/receipt.pdf`
  );
  assert.equal(receiptPdf.status, 200);
  assert.equal(Buffer.from(await receiptPdf.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');

  const otherTenantRead = await request(baseUrl, other.token, `/api/invoices/${invoiceId}`);
  assert.equal(otherTenantRead.status, 404);
  const otherTenantPdf = await request(baseUrl, other.token, `/api/invoices/${invoiceId}/pdf`);
  assert.equal(otherTenantPdf.status, 404);
  const otherTenantList = await request(baseUrl, other.token, '/api/invoices');
  assert.equal(otherTenantList.status, 200);
  assert.equal((await otherTenantList.json()).total, 0);

  const creditDraftResponse = await request(baseUrl, owner.token, '/api/invoices', {
    method: 'POST',
    body: JSON.stringify(draftPayload),
  });
  assert.equal(creditDraftResponse.status, 201);
  const creditDraft = (await creditDraftResponse.json()).invoice;
  const creditIssueResponse = await request(
    baseUrl,
    owner.token,
    `/api/invoices/${creditDraft.id}/issue`,
    { method: 'POST' }
  );
  assert.equal(creditIssueResponse.status, 200);
  const creditInvoiceResponse = await request(
    baseUrl,
    owner.token,
    `/api/invoices/${creditDraft.id}`
  );
  const creditInvoice = (await creditInvoiceResponse.json()).invoice;
  const creditResponse = await request(
    baseUrl,
    owner.token,
    `/api/invoices/${creditDraft.id}/credit-notes`,
    {
      method: 'POST',
      body: JSON.stringify({
        creditDate: today,
        reason: 'Returned consulting time',
        items: [{ invoiceItemId: creditInvoice.items[0].id, quantity: '1.5' }],
      }),
    }
  );
  assert.equal(creditResponse.status, 201);
  const creditNote = (await creditResponse.json()).creditNote;
  const creditPdf = await request(baseUrl, owner.token, `/api/credit-notes/${creditNote.id}/pdf`);
  assert.equal(creditPdf.status, 200);
  assert.equal(Buffer.from(await creditPdf.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');

  const receivablesResponse = await request(
    baseUrl,
    owner.token,
    `/api/reports/receivables?period=custom&startDate=${today}&endDate=${today}&status=outstanding`
  );
  assert.equal(receivablesResponse.status, 200);
  const receivables = await receivablesResponse.json();
  assert.equal(receivables.invoices.length, 1);
  assert.equal(
    receivables.invoices[0].outstanding_cents,
    creditDraft.total_cents - creditNote.total_cents
  );

  const statementResponse = await request(
    baseUrl,
    owner.token,
    `/api/customers/${customer.id}/statement.pdf?startDate=${today}&endDate=${today}`
  );
  assert.equal(statementResponse.status, 200);
  assert.equal(Buffer.from(await statementResponse.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');

  const concurrentDraftResponses = await Promise.all(
    Array.from({ length: 3 }, () => request(baseUrl, owner.token, '/api/invoices', {
      method: 'POST',
      body: JSON.stringify(draftPayload),
    }))
  );
  const concurrentDrafts = await Promise.all(concurrentDraftResponses.map(async (response) => {
    assert.equal(response.status, 201);
    return (await response.json()).invoice;
  }));
  const concurrentIssuedResponses = await Promise.all(
    concurrentDrafts.map((draft) => request(
      baseUrl,
      owner.token,
      `/api/invoices/${draft.id}/issue`,
      { method: 'POST' }
    ))
  );
  const concurrentInvoiceNumbers = await Promise.all(concurrentIssuedResponses.map(async (response) => {
    assert.equal(response.status, 200);
    return (await response.json()).invoice.invoice_number;
  }));
  assert.equal(new Set(concurrentInvoiceNumbers).size, concurrentInvoiceNumbers.length);

  const list = await request(baseUrl, owner.token, `/api/invoices?search=${invoice.invoice_number}`);
  assert.equal(list.status, 200);
  assert.equal((await list.json()).total, 1);
});
