const db = require('./database');

const PAYMENT_METHODS = new Set(['bank_transfer', 'cash', 'cheque', 'other']);

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
      console.error('Payroll payment transaction rollback failed:', rollbackError.message);
    }
    throw error;
  } finally {
    connection.release();
  }
}

function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function dateOnly(value) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

async function assertOwner(businessId, userId, connection = db) {
  const owner = await getOne(
    'SELECT id FROM businesses WHERE id = ? AND owner_user_id = ?',
    [businessId, userId],
    connection
  );
  if (!owner) throw new Error('FORBIDDEN');
}

function serializePayment(payment) {
  if (!payment) return null;
  payment.amount_cents = Number(payment.amount_cents);
  payment.paid_at = dateOnly(payment.paid_at);
  return payment;
}

async function recordPayment({ businessId, userId, runId, payload = {} }) {
  const employeeId = Number(payload.employeeId);
  const amountCents = payload.amountCents;
  const paymentMethod = payload.paymentMethod;
  const paidAt = payload.paidAt;
  const idempotencyKey = payload.idempotencyKey;
  const paymentReference = payload.paymentReference === undefined ||
    payload.paymentReference === null || payload.paymentReference === ''
    ? null
    : String(payload.paymentReference).trim();
  if (!Number.isSafeInteger(runId) || runId <= 0 ||
      !Number.isSafeInteger(employeeId) || employeeId <= 0 ||
      !Number.isSafeInteger(amountCents) || amountCents <= 0 ||
      !PAYMENT_METHODS.has(paymentMethod) || !isValidDate(paidAt) ||
      typeof idempotencyKey !== 'string' ||
      !/^[A-Za-z0-9._:-]{16,100}$/.test(idempotencyKey) ||
      (paymentReference !== null && paymentReference.length > 100)) {
    throw new Error('INVALID_PAYROLL_PAYMENT');
  }

  try {
    return await withTransaction(async (connection) => {
      await assertOwner(businessId, userId, connection);
      const run = await getOne(
        `SELECT id, status FROM payroll_runs
         WHERE business_id = ? AND id = ? FOR UPDATE`,
        [businessId, runId],
        connection
      );
      if (!run) throw new Error('PAYROLL_RUN_NOT_FOUND');
      if (run.status !== 'finalized') throw new Error('PAYROLL_RUN_NOT_PAYABLE');

      const existing = await getOne(
        `SELECT * FROM payroll_run_payments
         WHERE business_id = ? AND idempotency_key = ?`,
        [businessId, idempotencyKey],
        connection
      );
      if (existing) {
        const sameRequest = Number(existing.payroll_run_id) === runId &&
          Number(existing.employee_id) === employeeId &&
          Number(existing.amount_cents) === amountCents &&
          dateOnly(existing.paid_at) === paidAt &&
          existing.payment_method === paymentMethod &&
          (existing.payment_reference || null) === paymentReference;
        if (!sameRequest) throw new Error('PAYROLL_PAYMENT_KEY_CONFLICT');
        return { payment: serializePayment(existing), replayed: true };
      }

      const line = await getOne(
        `SELECT net_cents FROM payroll_run_lines
         WHERE business_id = ? AND payroll_run_id = ? AND employee_id = ?`,
        [businessId, runId, employeeId],
        connection
      );
      if (!line) throw new Error('PAYROLL_RUN_LINE_NOT_FOUND');
      const totals = await getOne(
        `SELECT COALESCE(SUM(amount_cents), 0) AS paid_cents
         FROM payroll_run_payments
         WHERE business_id = ? AND payroll_run_id = ? AND employee_id = ?`,
        [businessId, runId, employeeId],
        connection
      );
      const paidCents = Number(totals.paid_cents);
      const remainingCents = Number(line.net_cents) - paidCents;
      if (amountCents > remainingCents) throw new Error('PAYROLL_PAYMENT_EXCEEDS_BALANCE');

      const result = await execute(
        `INSERT INTO payroll_run_payments
         (business_id, payroll_run_id, employee_id, amount_cents, paid_at,
          payment_method, payment_reference, idempotency_key, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          businessId, runId, employeeId, amountCents, paidAt, paymentMethod,
          paymentReference, idempotencyKey, userId,
        ],
        connection
      );
      await execute(
        `INSERT INTO payroll_run_audit_events
         (business_id, payroll_run_id, actor_user_id, action)
         VALUES (?, ?, ?, 'payment_recorded')`,
        [businessId, runId, userId],
        connection
      );
      const payment = await getOne(
        'SELECT * FROM payroll_run_payments WHERE id = ? AND business_id = ?',
        [result.insertId, businessId],
        connection
      );
      return {
        payment: serializePayment(payment),
        replayed: false,
        remainingCents: remainingCents - amountCents,
      };
    });
  } catch (error) {
    if (error?.code === 'ER_DUP_ENTRY' || error?.errno === 1062) {
      throw new Error('PAYROLL_PAYMENT_KEY_CONFLICT');
    }
    throw error;
  }
}

async function listRunPayments({ businessId, userId, runId }) {
  await assertOwner(businessId, userId);
  if (!Number.isSafeInteger(runId) || runId <= 0) throw new Error('INVALID_PAYROLL_RUN');
  const run = await getOne(
    'SELECT id FROM payroll_runs WHERE business_id = ? AND id = ?',
    [businessId, runId]
  );
  if (!run) throw new Error('PAYROLL_RUN_NOT_FOUND');
  const payments = await getMany(
    `SELECT p.*, e.employee_number, e.first_name, e.last_name
     FROM payroll_run_payments p
     JOIN employees e ON e.id = p.employee_id AND e.business_id = p.business_id
     WHERE p.business_id = ? AND p.payroll_run_id = ?
     ORDER BY p.paid_at, p.id`,
    [businessId, runId]
  );
  return payments.map(serializePayment);
}

module.exports = { recordPayment, listRunPayments };
