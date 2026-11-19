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

test('payroll statutory rules are effective-dated, owner-only, and have no implicit rates', async (t) => {
  const server = await new Promise((resolve) => {
    const listeningServer = app.listen(0, () => resolve(listeningServer));
  });
  const accounts = [];
  let portalUserId = null;
  let portalEmail = null;
  let invitationToken = null;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    if (!portalUserId && portalEmail) {
      const [portalUsers] = await db.execute('SELECT id FROM users WHERE email = ?', [portalEmail]);
      portalUserId = portalUsers[0]?.id || null;
    }
    for (const account of accounts) {
      await db.execute('DELETE FROM sessions WHERE user_id = ?', [account.userId]);
    }
    if (portalUserId) {
      await db.execute('DELETE FROM sessions WHERE user_id = ?', [portalUserId]);
    }
    for (const account of accounts) {
      await db.execute('DELETE FROM employee_portal_invitations WHERE business_id = ?', [account.businessId]);
      await db.execute('DELETE FROM payroll_run_payments WHERE business_id = ?', [account.businessId]);
      await db.execute('DELETE FROM payroll_run_audit_events WHERE business_id = ?', [account.businessId]);
      await db.execute('DELETE FROM payroll_run_lines WHERE business_id = ?', [account.businessId]);
      await db.execute('DELETE FROM payroll_runs WHERE business_id = ?', [account.businessId]);
      await db.execute('DELETE FROM payroll_rule_audit_events WHERE business_id = ?', [account.businessId]);
      await db.execute('DELETE FROM payroll_paye_bands WHERE business_id = ?', [account.businessId]);
      await db.execute('DELETE FROM payroll_rule_sets WHERE business_id = ?', [account.businessId]);
      await db.execute('DELETE FROM employee_audit_events WHERE business_id = ?', [account.businessId]);
      await db.execute('DELETE FROM employee_compensation WHERE business_id = ?', [account.businessId]);
      await db.execute('DELETE FROM employees WHERE business_id = ?', [account.businessId]);
      await db.execute('DELETE FROM business_settings WHERE business_id = ?', [account.businessId]);
      await db.execute('DELETE FROM business_memberships WHERE business_id = ?', [account.businessId]);
    }
    for (const account of accounts) {
      await db.execute('DELETE FROM businesses WHERE id = ?', [account.businessId]);
      await db.execute('DELETE FROM users WHERE id = ?', [account.userId]);
    }
    if (portalUserId) await db.execute('DELETE FROM users WHERE id = ?', [portalUserId]);
    await db.end();
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const suffix = crypto.randomUUID();
  portalEmail = `payroll-employee-${suffix}@example.com`;
  const register = async (label) => {
    const response = await request(baseUrl, null, '/api/register', {
      method: 'POST',
      body: JSON.stringify({
        firstName: 'Rules',
        lastName: label,
        email: `payroll-rules-${label}-${suffix}@example.com`,
        password: 'StrongPassword!123',
        businessName: `Payroll Rules ${label} ${suffix}`,
        businessType: 'retail',
      }),
    });
    assert.equal(response.status, 201);
    const body = await response.json();
    const session = await (await request(baseUrl, body.sessionToken, '/api/session')).json();
    const account = {
      token: body.sessionToken,
      businessId: session.business.id,
      userId: session.user.id,
    };
    accounts.push(account);
    return account;
  };
  const owner = await register('Owner');
  const other = await register('Other');

  const initial = await request(baseUrl, owner.token, '/api/payroll/rules');
  assert.equal(initial.status, 200);
  assert.deepEqual((await initial.json()).ruleSets, []);

  const today = new Date().toISOString().slice(0, 10);
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  const periodStart = monthStart.toISOString().slice(0, 10);
  const monthEnd = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0));
  const periodEnd = monthEnd.toISOString().slice(0, 10);
  const payload = {
    label: `User-entered schedule ${suffix.slice(0, 8)}`,
    effectiveFrom: periodStart,
    annualRebateCents: 500000,
    uifEmployeeRateBps: 100,
    uifEmployerRateBps: 100,
    uifMonthlyCapCents: 1771200,
    sdlRateBps: 100,
    sdlAnnualThresholdCents: 50000000,
    payeBands: [
      { lowerCents: 0, upperCents: 100000000, rateBps: 500 },
      { lowerCents: 100000000, upperCents: null, rateBps: 1000 },
    ],
  };
  const created = await request(baseUrl, owner.token, '/api/payroll/rules', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  assert.equal(created.status, 201);
  const ruleSet = (await created.json()).ruleSet;
  assert.equal(ruleSet.label, payload.label);
  assert.equal(ruleSet.paye_bands.length, 2);
  assert.equal(Number(ruleSet.paye_bands[0].base_tax_cents), 0);
  assert.equal(Number(ruleSet.paye_bands[1].base_tax_cents), 5000000);
  assert.equal(Number(ruleSet.uif_employee_rate_bps), payload.uifEmployeeRateBps);

  const employeeResponse = await request(baseUrl, owner.token, '/api/employees', {
    method: 'POST',
    body: JSON.stringify({
      employeeNumber: `PAY-${suffix.slice(0, 8)}`,
      firstName: 'Payroll',
      lastName: 'Employee',
      email: portalEmail,
      jobTitle: 'Assistant',
      employmentType: 'permanent',
      employmentStatus: 'active',
      employmentStartDate: today,
      payStructure: 'monthly_salary',
      payFrequency: 'monthly',
      baseRateCents: 100000,
      effectiveFrom: today,
    }),
  });
  assert.equal(employeeResponse.status, 201);
  const employee = (await employeeResponse.json()).employee;
  const runResponse = await request(baseUrl, owner.token, '/api/payroll/runs', {
    method: 'POST',
    body: JSON.stringify({
      periodStart,
      periodEnd,
      payDate: periodEnd,
      lines: [{ employeeId: employee.id, grossCents: 5000000, otherDeductionsCents: 1000 }],
    }),
  });
  assert.equal(runResponse.status, 201);
  const run = (await runResponse.json()).run;
  assert.equal(run.status, 'draft');
  assert.equal(Number(run.total_gross_cents), 5000000);
  assert.equal(Number(run.total_paye_cents), 208333);
  assert.equal(Number(run.total_uif_employee_cents), 17712);
  assert.equal(Number(run.total_sdl_cents), 50000);
  assert.equal(Number(run.total_net_cents), 4772955);
  assert.equal(run.lines.length, 1);
  const duplicateRun = await request(baseUrl, owner.token, '/api/payroll/runs', {
    method: 'POST',
    body: JSON.stringify({
      periodStart,
      periodEnd,
      payDate: periodEnd,
      lines: [{ employeeId: employee.id, grossCents: 5000000, otherDeductionsCents: 1000 }],
    }),
  });
  assert.equal(duplicateRun.status, 409);

  const negativeNetRun = await request(baseUrl, owner.token, '/api/payroll/runs', {
    method: 'POST',
    body: JSON.stringify({
      periodStart,
      periodEnd,
      payDate: periodEnd,
      lines: [{ employeeId: employee.id, grossCents: 1, otherDeductionsCents: 2 }],
    }),
  });
  assert.equal(negativeNetRun.status, 409);
  assert.match((await negativeNetRun.json()).error, /Deductions exceed gross pay/);

  const missingRulesRun = await request(baseUrl, other.token, '/api/payroll/runs', {
    method: 'POST',
    body: JSON.stringify({ periodStart, periodEnd, payDate: periodEnd, lines: [] }),
  });
  assert.equal(missingRulesRun.status, 409);
  assert.match((await missingRulesRun.json()).error, /No complete statutory rule set/);

  const unpaidDraftPayment = await request(baseUrl, owner.token, `/api/payroll/runs/${run.id}/payments`, {
    method: 'POST',
    body: JSON.stringify({
      employeeId: employee.id,
      amountCents: 1000,
      paidAt: periodEnd,
      paymentMethod: 'bank_transfer',
      idempotencyKey: `payroll-payment-draft-${suffix.slice(0, 8)}`,
    }),
  });
  assert.equal(unpaidDraftPayment.status, 409);

  const approvedRun = await request(baseUrl, owner.token, `/api/payroll/runs/${run.id}/transition`, {
    method: 'POST',
    body: JSON.stringify({ decision: 'approved' }),
  });
  assert.equal((await approvedRun.json()).run.status, 'approved');
  const finalizedRun = await request(baseUrl, owner.token, `/api/payroll/runs/${run.id}/transition`, {
    method: 'POST',
    body: JSON.stringify({ decision: 'finalized' }),
  });
  assert.equal((await finalizedRun.json()).run.status, 'finalized');
  const payrollRange = `period=custom&startDate=${periodStart}&endDate=${periodEnd}`;
  const payrollReportResponse = await request(
    baseUrl,
    owner.token,
    `/api/reports/payroll?${payrollRange}`
  );
  assert.equal(payrollReportResponse.status, 200);
  const payrollReport = await payrollReportResponse.json();
  assert.equal(payrollReport.summary.grossCents, 5000000);
  assert.equal(payrollReport.summary.netCents, 4772955);
  assert.equal(payrollReport.summary.outstandingCents, 4772955);
  assert.equal(payrollReport.employeeLines[0].employee_number, employee.employee_number);
  const payrollCsvResponse = await request(
    baseUrl,
    owner.token,
    `/api/reports/payroll.csv?${payrollRange}`
  );
  assert.equal(payrollCsvResponse.status, 200);
  const payrollCsv = await payrollCsvResponse.text();
  assert.match(payrollCsv, /PAYE estimate in cents/);
  assert.match(payrollCsv, new RegExp(employee.employee_number));

  const dashboardResponse = await request(baseUrl, owner.token, '/api/dashboard');
  assert.equal(dashboardResponse.status, 200);
  const dashboard = await dashboardResponse.json();
  assert.equal(dashboard.summary.financial.payroll.outstandingCents, 4772955);
  assert.equal(
    dashboard.summary.financial.actionItems.some((item) => item.type === 'payroll_payment_outstanding'),
    true
  );

  const ownerPayslip = await request(
    baseUrl,
    owner.token,
    `/api/payroll/runs/${run.id}/employees/${employee.id}/payslip.pdf`
  );
  assert.equal(ownerPayslip.status, 200);
  assert.match(ownerPayslip.headers.get('content-type'), /application\/pdf/);
  assert.equal((await ownerPayslip.arrayBuffer()).byteLength > 1000, true);

  const inviteResponse = await request(
    baseUrl,
    owner.token,
    `/api/employees/${employee.id}/portal-invitation`,
    { method: 'POST' }
  );
  assert.equal(inviteResponse.status, 201);
  invitationToken = (await inviteResponse.json()).invitation.invitationToken;
  assert.match(invitationToken, /^[a-f0-9]{64}$/);
  const crossTenantInvite = await request(
    baseUrl,
    other.token,
    `/api/employees/${employee.id}/portal-invitation`,
    { method: 'POST' }
  );
  assert.equal(crossTenantInvite.status, 404);

  const activationResponse = await request(baseUrl, null, '/api/employee-portal/activate', {
    method: 'POST',
    body: JSON.stringify({ token: invitationToken, password: 'EmployeePortal!123' }),
  });
  assert.equal(activationResponse.status, 201);
  const portalSessionToken = (await activationResponse.json()).sessionToken;
  const portalSession = await request(baseUrl, portalSessionToken, '/api/session');
  const portalSessionBody = await portalSession.json();
  portalUserId = portalSessionBody.user.id;
  assert.equal(portalSessionBody.business, null);
  const linkedInvite = await request(
    baseUrl,
    owner.token,
    `/api/employees/${employee.id}/portal-invitation`,
    { method: 'POST' }
  );
  assert.equal(linkedInvite.status, 409);

  const employeePayslips = await request(baseUrl, portalSessionToken, '/api/employee-portal/payslips');
  assert.equal(employeePayslips.status, 200);
  const payslips = (await employeePayslips.json()).payslips;
  assert.equal(payslips.length, 1);
  assert.equal(Number(payslips[0].outstanding_cents), 4772955);
  const employeePayslip = await request(
    baseUrl,
    portalSessionToken,
    `/api/employee-portal/payslips/${run.id}.pdf`
  );
  assert.equal(employeePayslip.status, 200);
  assert.match(employeePayslip.headers.get('content-type'), /application\/pdf/);
  assert.deepEqual(
    (await (await request(baseUrl, other.token, '/api/employee-portal/payslips')).json()).payslips,
    []
  );

  const firstPaymentKey = `payroll-payment-one-${suffix.slice(0, 8)}`;
  const partialPaymentResponse = await request(baseUrl, owner.token, `/api/payroll/runs/${run.id}/payments`, {
    method: 'POST',
    body: JSON.stringify({
      employeeId: employee.id,
      amountCents: 2000000,
      paidAt: periodEnd,
      paymentMethod: 'bank_transfer',
      paymentReference: 'BANK-001',
      idempotencyKey: firstPaymentKey,
    }),
  });
  assert.equal(partialPaymentResponse.status, 201);
  assert.equal((await partialPaymentResponse.json()).remainingCents, 2772955);
  const replayedPayment = await request(baseUrl, owner.token, `/api/payroll/runs/${run.id}/payments`, {
    method: 'POST',
    body: JSON.stringify({
      employeeId: employee.id,
      amountCents: 2000000,
      paidAt: periodEnd,
      paymentMethod: 'bank_transfer',
      paymentReference: 'BANK-001',
      idempotencyKey: firstPaymentKey,
    }),
  });
  assert.equal((await replayedPayment.json()).replayed, true);

  const overpayment = await request(baseUrl, owner.token, `/api/payroll/runs/${run.id}/payments`, {
    method: 'POST',
    body: JSON.stringify({
      employeeId: employee.id,
      amountCents: 2772956,
      paidAt: periodEnd,
      paymentMethod: 'bank_transfer',
      idempotencyKey: `payroll-payment-over-${suffix.slice(0, 8)}`,
    }),
  });
  assert.equal(overpayment.status, 409);

  const finalPayment = await request(baseUrl, owner.token, `/api/payroll/runs/${run.id}/payments`, {
    method: 'POST',
    body: JSON.stringify({
      employeeId: employee.id,
      amountCents: 2772955,
      paidAt: periodEnd,
      paymentMethod: 'bank_transfer',
      idempotencyKey: `payroll-payment-final-${suffix.slice(0, 8)}`,
    }),
  });
  assert.equal(finalPayment.status, 201);
  const refreshedRun = (await (await request(baseUrl, owner.token, `/api/payroll/runs/${run.id}`)).json()).run;
  assert.equal(refreshedRun.total_paid_cents, 4772955);
  assert.equal(refreshedRun.total_outstanding_cents, 0);
  assert.equal(refreshedRun.lines[0].paid_cents, 4772955);
  assert.equal((await (await request(baseUrl, portalSessionToken, '/api/employee-portal/payslips')).json()).payslips[0].paid_cents, 4772955);

  const backwardsTransition = await request(baseUrl, owner.token, `/api/payroll/runs/${run.id}/transition`, {
    method: 'POST',
    body: JSON.stringify({ decision: 'approved' }),
  });
  assert.equal(backwardsTransition.status, 409);

  const overlap = await request(baseUrl, owner.token, '/api/payroll/rules', {
    method: 'POST',
    body: JSON.stringify({ ...payload, label: 'Overlapping version' }),
  });
  assert.equal(overlap.status, 409);

  const invalidBands = await request(baseUrl, owner.token, '/api/payroll/rules', {
    method: 'POST',
    body: JSON.stringify({
      ...payload,
      effectiveFrom: '2027-01-01',
      payeBands: [
        { lowerCents: 0, upperCents: 100000000, rateBps: 2000 },
        { lowerCents: 100000001, upperCents: null, rateBps: 1000 },
      ],
    }),
  });
  assert.equal(invalidBands.status, 400);

  const isolated = await request(baseUrl, other.token, '/api/payroll/rules');
  assert.equal(isolated.status, 200);
  assert.deepEqual((await isolated.json()).ruleSets, []);
  const isolatedRuns = await request(baseUrl, other.token, '/api/payroll/runs');
  assert.deepEqual((await isolatedRuns.json()).runs, []);

  const member = await register('Member');
  await db.execute(
    'INSERT INTO business_memberships (user_id, business_id, role) VALUES (?, ?, ?)',
    [member.userId, owner.businessId, 'admin']
  );
  await db.execute(
    'UPDATE sessions SET business_id = ? WHERE user_id = ?',
    [owner.businessId, member.userId]
  );
  const memberPayrollReport = await request(
    baseUrl,
    member.token,
    `/api/reports/payroll?${payrollRange}`
  );
  assert.equal(memberPayrollReport.status, 403);
  const memberDashboard = await (
    await request(baseUrl, member.token, '/api/dashboard')
  ).json();
  assert.equal(memberDashboard.summary.financial.payroll, null);
  assert.equal(
    memberDashboard.summary.financial.actionItems.some((item) => item.type === 'payroll_payment_outstanding'),
    false
  );

  const [auditRows] = await db.execute(
    'SELECT action FROM payroll_rule_audit_events WHERE business_id = ?',
    [owner.businessId]
  );
  assert.deepEqual(auditRows.map((row) => row.action), ['rules_created']);
  const [runAuditRows] = await db.execute(
    'SELECT action FROM payroll_run_audit_events WHERE business_id = ? ORDER BY id',
    [owner.businessId]
  );
  assert.deepEqual(runAuditRows.map((row) => row.action), [
    'run_created',
    'run_approved',
    'run_finalized',
    'payment_recorded',
    'payment_recorded',
  ]);

  const revokePortal = await request(
    baseUrl,
    owner.token,
    `/api/employees/${employee.id}/portal-access`,
    { method: 'DELETE' }
  );
  assert.deepEqual(await revokePortal.json(), { revoked: true });
  assert.deepEqual(
    (await (await request(baseUrl, portalSessionToken, '/api/employee-portal/payslips')).json()).payslips,
    []
  );
  const revokedPayslip = await request(
    baseUrl,
    portalSessionToken,
    `/api/employee-portal/payslips/${run.id}.pdf`
  );
  assert.equal(revokedPayslip.status, 404);
  const reusedInvitation = await request(baseUrl, null, '/api/employee-portal/activate', {
    method: 'POST',
    body: JSON.stringify({ token: invitationToken, password: 'EmployeePortal!123' }),
  });
  assert.equal(reusedInvitation.status, 410);
});
