const crypto = require('node:crypto');
const db = require('./database');
const { hashPassword, verifyPassword, createSession } = require('./service');

async function getOne(sql, params = [], connection = db) {
  const [rows] = await connection.execute(sql, params);
  return rows[0] || null;
}

async function getMany(sql, params = [], connection = db) {
  const [rows] = await connection.execute(sql, params);
  return rows;
}

async function execute(sql, params = [], connection = db) {
  const [result] = await connection.execute(sql, params);
  return result;
}

async function withTransaction(callback) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    try {
      await connection.rollback();
    } catch (rollbackError) {
      console.error('Payroll access transaction rollback failed:', rollbackError.message);
    }
    throw error;
  } finally {
    connection.release();
  }
}

async function assertOwner(businessId, userId, connection = db) {
  const owner = await getOne(
    'SELECT id FROM businesses WHERE id = ? AND owner_user_id = ?',
    [businessId, userId],
    connection
  );
  if (!owner) throw new Error('FORBIDDEN');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

async function createEmployeePortalInvitation({ businessId, userId, employeeId }) {
  await assertOwner(businessId, userId);
  if (!Number.isSafeInteger(employeeId) || employeeId <= 0) throw new Error('INVALID_EMPLOYEE');
  const employee = await getOne(
    `SELECT id, email, portal_user_id FROM employees
     WHERE business_id = ? AND id = ?`,
    [businessId, employeeId]
  );
  if (!employee) throw new Error('EMPLOYEE_NOT_FOUND');
  const email = String(employee.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('EMPLOYEE_EMAIL_REQUIRED');
  }
  if (employee.portal_user_id) throw new Error('EMPLOYEE_PORTAL_ALREADY_LINKED');

  const invitationToken = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await withTransaction(async (connection) => {
    await assertOwner(businessId, userId, connection);
    await execute(
      `INSERT INTO employee_portal_invitations
       (business_id, employee_id, email, token_hash, expires_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE email = VALUES(email), token_hash = VALUES(token_hash),
         expires_at = VALUES(expires_at), created_by = VALUES(created_by),
         created_at = CURRENT_TIMESTAMP`,
      [businessId, employeeId, email, hashToken(invitationToken), expiresAt, userId],
      connection
    );
    await execute(
      `INSERT INTO employee_audit_events (business_id, employee_id, actor_user_id, action)
       VALUES (?, ?, ?, 'employee_portal_invited')`,
      [businessId, employeeId, userId],
      connection
    );
  });

  return { invitationToken, expiresAt: expiresAt.toISOString() };
}

async function revokeEmployeePortalAccess({ businessId, userId, employeeId }) {
  await assertOwner(businessId, userId);
  if (!Number.isSafeInteger(employeeId) || employeeId <= 0) throw new Error('INVALID_EMPLOYEE');
  return withTransaction(async (connection) => {
    await assertOwner(businessId, userId, connection);
    const employee = await getOne(
      'SELECT id, portal_user_id FROM employees WHERE business_id = ? AND id = ? FOR UPDATE',
      [businessId, employeeId],
      connection
    );
    if (!employee) throw new Error('EMPLOYEE_NOT_FOUND');
    await execute(
      `DELETE FROM employee_portal_invitations
       WHERE business_id = ? AND employee_id = ?`,
      [businessId, employeeId],
      connection
    );
    if (employee.portal_user_id) {
      await execute(
        'UPDATE employees SET portal_user_id = NULL WHERE business_id = ? AND id = ?',
        [businessId, employeeId],
        connection
      );
      await execute(
        `INSERT INTO employee_audit_events (business_id, employee_id, actor_user_id, action)
         VALUES (?, ?, ?, 'employee_portal_revoked')`,
        [businessId, employeeId, userId],
        connection
      );
    }
    return { revoked: Boolean(employee.portal_user_id) };
  });
}

async function activateEmployeePortal({ token, password }) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token) ||
      typeof password !== 'string' || password.length < 12 || password.length > 200) {
    throw new Error('INVALID_EMPLOYEE_PORTAL_ACTIVATION');
  }

  const passwordHash = hashPassword(password);
  const userId = await withTransaction(async (connection) => {
    const invitation = await getOne(
      `SELECT i.business_id, i.employee_id, i.email, e.first_name, e.last_name,
         e.portal_user_id
       FROM employee_portal_invitations i
       JOIN employees e ON e.id = i.employee_id AND e.business_id = i.business_id
       WHERE i.token_hash = ? AND i.expires_at > UTC_TIMESTAMP()
       FOR UPDATE`,
      [hashToken(token)],
      connection
    );
    if (!invitation) throw new Error('EMPLOYEE_PORTAL_INVITATION_INVALID');

    let user = await getOne(
      'SELECT id, password_hash FROM users WHERE email = ? FOR UPDATE',
      [invitation.email],
      connection
    );
    if (user && !verifyPassword(password, user.password_hash)) {
      throw new Error('EMPLOYEE_PORTAL_ACCOUNT_EXISTS');
    }
    if (!user) {
      const result = await execute(
        `INSERT INTO users (first_name, last_name, email, password_hash)
         VALUES (?, ?, ?, ?)`,
        [invitation.first_name, invitation.last_name, invitation.email, passwordHash],
        connection
      );
      user = { id: result.insertId };
    }
    if (invitation.portal_user_id &&
        Number(invitation.portal_user_id) !== Number(user.id)) {
      throw new Error('EMPLOYEE_PORTAL_ALREADY_LINKED');
    }
    const existingLink = await getOne(
      `SELECT id FROM employees
       WHERE business_id = ? AND portal_user_id = ? AND id <> ?`,
      [invitation.business_id, user.id, invitation.employee_id],
      connection
    );
    if (existingLink) throw new Error('EMPLOYEE_PORTAL_ALREADY_LINKED');

    await execute(
      `UPDATE employees SET portal_user_id = ?
       WHERE business_id = ? AND id = ?`,
      [user.id, invitation.business_id, invitation.employee_id],
      connection
    );
    await execute(
      `DELETE FROM employee_portal_invitations
       WHERE business_id = ? AND employee_id = ?`,
      [invitation.business_id, invitation.employee_id],
      connection
    );
    await execute(
      `INSERT INTO employee_audit_events (business_id, employee_id, actor_user_id, action)
       VALUES (?, ?, ?, 'employee_portal_activated')`,
      [invitation.business_id, invitation.employee_id, user.id],
      connection
    );
    return user.id;
  });
  const { sessionId } = await createSession(userId, null);
  return { sessionToken: sessionId };
}

const PAYSLIP_FIELDS = `e.id AS employee_id, e.employee_number, e.first_name,
  e.last_name, b.name AS business_name, r.id AS payroll_run_id,
  r.period_start, r.period_end, r.pay_date, r.currency,
  l.gross_cents, l.paye_cents, l.uif_employee_cents, l.uif_employer_cents,
  l.sdl_cents, l.other_deductions_cents, l.net_cents,
  COALESCE((SELECT SUM(pp.amount_cents) FROM payroll_run_payments pp
    WHERE pp.business_id = l.business_id
      AND pp.payroll_run_id = l.payroll_run_id
      AND pp.employee_id = l.employee_id), 0) AS paid_cents,
  GREATEST(l.net_cents - COALESCE((SELECT SUM(pp.amount_cents) FROM payroll_run_payments pp
    WHERE pp.business_id = l.business_id
      AND pp.payroll_run_id = l.payroll_run_id
      AND pp.employee_id = l.employee_id), 0), 0) AS outstanding_cents`;

function serializePayslip(row) {
  if (!row) return null;
  for (const field of [
    'gross_cents', 'paye_cents', 'uif_employee_cents', 'uif_employer_cents',
    'sdl_cents', 'other_deductions_cents', 'net_cents', 'paid_cents',
    'outstanding_cents',
  ]) row[field] = Number(row[field]);
  for (const field of ['period_start', 'period_end', 'pay_date']) {
    if (row[field] instanceof Date) row[field] = row[field].toISOString().slice(0, 10);
    else row[field] = String(row[field]).slice(0, 10);
  }
  return row;
}

async function getOwnerPayslip({ businessId, userId, runId, employeeId }) {
  await assertOwner(businessId, userId);
  const row = await getOne(
    `SELECT ${PAYSLIP_FIELDS}
     FROM payroll_run_lines l
     JOIN payroll_runs r ON r.id = l.payroll_run_id AND r.business_id = l.business_id
     JOIN employees e ON e.id = l.employee_id AND e.business_id = l.business_id
     JOIN businesses b ON b.id = r.business_id
     WHERE l.business_id = ? AND l.payroll_run_id = ? AND l.employee_id = ?
       AND r.status = 'finalized'`,
    [businessId, runId, employeeId]
  );
  return serializePayslip(row);
}

async function listEmployeePayslips({ userId }) {
  const rows = await getMany(
    `SELECT ${PAYSLIP_FIELDS}
     FROM employees e
     JOIN payroll_run_lines l ON l.employee_id = e.id AND l.business_id = e.business_id
     JOIN payroll_runs r ON r.id = l.payroll_run_id AND r.business_id = l.business_id
     JOIN businesses b ON b.id = r.business_id
     WHERE e.portal_user_id = ? AND r.status = 'finalized'
     ORDER BY r.period_start DESC, b.name
     LIMIT 100`,
    [userId]
  );
  return rows.map(serializePayslip);
}

async function getEmployeePayslip({ userId, runId }) {
  const row = await getOne(
    `SELECT ${PAYSLIP_FIELDS}
     FROM employees e
     JOIN payroll_run_lines l ON l.employee_id = e.id AND l.business_id = e.business_id
     JOIN payroll_runs r ON r.id = l.payroll_run_id AND r.business_id = l.business_id
     JOIN businesses b ON b.id = r.business_id
     WHERE e.portal_user_id = ? AND l.payroll_run_id = ? AND r.status = 'finalized'`,
    [userId, runId]
  );
  return serializePayslip(row);
}

module.exports = {
  createEmployeePortalInvitation,
  revokeEmployeePortalAccess,
  activateEmployeePortal,
  getOwnerPayslip,
  listEmployeePayslips,
  getEmployeePayslip,
};
