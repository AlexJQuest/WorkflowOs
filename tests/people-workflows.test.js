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

test('attendance and leave workflows enforce owner access and ledger rules', async (t) => {
  const server = await new Promise((resolve) => {
    const listeningServer = app.listen(0, () => resolve(listeningServer));
  });
  let owner = null;
  let other = null;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    for (const account of [owner, other]) {
      if (account) {
        await db.execute('DELETE FROM sessions WHERE user_id = ?', [account.userId]);
      }
    }
    for (const account of [owner, other]) {
      if (!account) continue;
      const { businessId, userId } = account;
      await db.execute('DELETE FROM leave_audit_events WHERE business_id = ?', [businessId]);
      await db.execute('DELETE FROM attendance_adjustments WHERE business_id = ?', [businessId]);
      await db.execute('DELETE FROM leave_balance_entries WHERE business_id = ?', [businessId]);
      await db.execute('DELETE FROM leave_requests WHERE business_id = ?', [businessId]);
      await db.execute('DELETE FROM attendance_records WHERE business_id = ?', [businessId]);
      await db.execute('DELETE FROM leave_types WHERE business_id = ?', [businessId]);
      await db.execute('DELETE FROM employee_audit_events WHERE business_id = ?', [businessId]);
      await db.execute('DELETE FROM employee_compensation WHERE business_id = ?', [businessId]);
      await db.execute('DELETE FROM employees WHERE business_id = ?', [businessId]);
      await db.execute('DELETE FROM business_settings WHERE business_id = ?', [businessId]);
      await db.execute('DELETE FROM business_memberships WHERE business_id = ?', [businessId]);
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
        firstName: 'Workflow',
        lastName: label,
        email: `people-${label}-${suffix}@example.com`,
        password: 'StrongPassword!123',
        businessName: `People ${label} ${suffix}`,
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
  await db.execute(
    'UPDATE sessions SET business_id = ? WHERE user_id = ?',
    [owner.businessId, other.userId]
  );

  const today = new Date().toISOString().slice(0, 10);
  const employeeResponse = await request(baseUrl, owner.token, '/api/employees', {
    method: 'POST',
    body: JSON.stringify({
      employeeNumber: `EMP-${suffix.slice(0, 8)}`,
      firstName: 'Taylor',
      lastName: 'Workflow',
      jobTitle: 'Operations assistant',
      employmentType: 'permanent',
      employmentStatus: 'active',
      employmentStartDate: today,
      payStructure: 'monthly_salary',
      payFrequency: 'monthly',
      baseRateCents: 1500000,
      effectiveFrom: today,
    }),
  });
  assert.equal(employeeResponse.status, 201);
  const employee = (await employeeResponse.json()).employee;

  const attendanceResponse = await request(baseUrl, owner.token, '/api/attendance', {
    method: 'POST',
    body: JSON.stringify({
      employeeId: employee.id,
      workDate: today,
      ordinaryMinutes: 600,
      idempotencyKey: `attendance-${suffix}`,
    }),
  });
  assert.equal(attendanceResponse.status, 201);
  const attendance = (await attendanceResponse.json()).attendance;
  const duplicateAttendance = await request(baseUrl, owner.token, '/api/attendance', {
    method: 'POST',
    body: JSON.stringify({
      employeeId: employee.id,
      workDate: today,
      ordinaryMinutes: 600,
      idempotencyKey: `attendance-${suffix}`,
    }),
  });
  assert.equal(duplicateAttendance.status, 409);

  const unauthorizedAttendance = await request(baseUrl, other.token, '/api/attendance');
  assert.equal(unauthorizedAttendance.status, 403);
  const adjustment = await request(
    baseUrl,
    owner.token,
    `/api/attendance/${attendance.id}/adjustments`,
    {
      method: 'POST',
      body: JSON.stringify({
        fieldName: 'overtime_minutes',
        adjustedMinutes: 60,
        reason: 'Corrected from approved source timesheet',
      }),
    }
  );
  assert.equal(adjustment.status, 200);
  const reviewedAttendance = await request(
    baseUrl,
    owner.token,
    `/api/attendance/${attendance.id}/review`,
    { method: 'POST', body: JSON.stringify({ decision: 'approved' }) }
  );
  assert.equal(reviewedAttendance.status, 200);
  assert.equal((await reviewedAttendance.json()).attendance.status, 'approved');
  const immutableAttendance = await request(
    baseUrl,
    owner.token,
    `/api/attendance/${attendance.id}/adjustments`,
    {
      method: 'POST',
      body: JSON.stringify({
        fieldName: 'ordinary_minutes',
        adjustedMinutes: 540,
        reason: 'Attempt to alter approved record',
      }),
    }
  );
  assert.equal(immutableAttendance.status, 409);
  const attendanceList = await request(baseUrl, owner.token, `/api/attendance?startDate=${today}&endDate=${today}`);
  assert.equal((await attendanceList.json()).total, 1);
  const [adjustmentRows] = await db.execute(
    'SELECT previous_minutes, adjusted_minutes FROM attendance_adjustments WHERE attendance_id = ?',
    [attendance.id]
  );
  assert.equal(Number(adjustmentRows[0].previous_minutes), 0);
  assert.equal(Number(adjustmentRows[0].adjusted_minutes), 60);

  const leaveTypeResponse = await request(baseUrl, owner.token, '/api/leave-types', {
    method: 'POST',
    body: JSON.stringify({
      code: `annual-${suffix.slice(0, 8)}`,
      name: 'Annual leave',
      unit: 'days',
      requiresBalance: true,
      isPaid: true,
      allowBalanceOverride: true,
    }),
  });
  assert.equal(leaveTypeResponse.status, 201);
  const leaveType = (await leaveTypeResponse.json()).leaveType;
  const balanceResponse = await request(baseUrl, owner.token, '/api/leave-balances', {
    method: 'POST',
    body: JSON.stringify({
      employeeId: employee.id,
      leaveTypeId: leaveType.id,
      sourceType: 'opening_balance',
      unitsMillis: 2000,
      idempotencyKey: `opening-${suffix}`,
      reason: 'Opening balance imported',
    }),
  });
  assert.equal(balanceResponse.status, 201);
  assert.equal(Number((await balanceResponse.json()).balance.balance_millis), 2000);

  const excessiveRequest = await request(baseUrl, owner.token, '/api/leave-requests', {
    method: 'POST',
    body: JSON.stringify({
      employeeId: employee.id,
      leaveTypeId: leaveType.id,
      startDate: today,
      endDate: today,
      requestedUnitsMillis: 1001,
    }),
  });
  assert.equal(excessiveRequest.status, 400);
  const rangeEnd = new Date(`${today}T00:00:00.000Z`);
  rangeEnd.setUTCDate(rangeEnd.getUTCDate() + 2);
  const endDate = rangeEnd.toISOString().slice(0, 10);
  const leaveRequestResponse = await request(baseUrl, owner.token, '/api/leave-requests', {
    method: 'POST',
    body: JSON.stringify({
      employeeId: employee.id,
      leaveTypeId: leaveType.id,
      startDate: today,
      endDate,
      requestedUnitsMillis: 3000,
    }),
  });
  assert.equal(leaveRequestResponse.status, 201);
  const leaveRequest = (await leaveRequestResponse.json()).leaveRequest;
  const overlap = await request(baseUrl, owner.token, '/api/leave-requests', {
    method: 'POST',
    body: JSON.stringify({
      employeeId: employee.id,
      leaveTypeId: leaveType.id,
      startDate: today,
      endDate,
      requestedUnitsMillis: 1000,
    }),
  });
  assert.equal(overlap.status, 409);
  const insufficient = await request(
    baseUrl,
    owner.token,
    `/api/leave-requests/${leaveRequest.id}/review`,
    { method: 'POST', body: JSON.stringify({ decision: 'approved' }) }
  );
  assert.equal(insufficient.status, 409);
  const override = await request(
    baseUrl,
    owner.token,
    `/api/leave-requests/${leaveRequest.id}/review`,
    {
      method: 'POST',
      body: JSON.stringify({
        decision: 'approved',
        overrideReason: 'Approved exception by business owner',
      }),
    }
  );
  assert.equal(override.status, 200);
  assert.equal((await override.json()).leaveRequest.status, 'approved');
  const balancesResponse = await request(
    baseUrl,
    owner.token,
    `/api/employees/${employee.id}/leave-balances`
  );
  const balances = (await balancesResponse.json()).balances;
  assert.equal(Number(balances[0].balance_millis), -1000);
  const [auditRows] = await db.execute(
    `SELECT action FROM leave_audit_events
     WHERE business_id = ? AND employee_id = ? ORDER BY id`,
    [owner.businessId, employee.id]
  );
  assert.deepEqual(auditRows.map((row) => row.action), [
    'leave_balance_adjusted',
    'leave_requested',
    'leave_approved',
  ]);
});
