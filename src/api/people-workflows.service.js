const db = require('./database');

const MINUTE_FIELDS = new Set([
  'ordinary_minutes',
  'overtime_minutes',
  'sunday_minutes',
  'public_holiday_minutes',
  'break_minutes',
  'absence_minutes',
]);
const LEAVE_SOURCE_TYPES = new Set(['opening_balance', 'accrual', 'adjustment', 'reversal']);

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
      console.error('People workflow transaction rollback failed:', rollbackError.message);
    }
    throw error;
  } finally {
    connection.release();
  }
}

function isDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function dateTime(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/i.test(value)) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 19).replace('T', ' ');
}

function text(value, maxLength) {
  if (value === null || value === undefined) return null;
  const result = String(value).trim();
  return result ? result.slice(0, maxLength) : null;
}

function id(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function flag(value) {
  return value === true || value === 1 || value === '1';
}

async function assertOwner(businessId, userId, connection = db) {
  const owner = await getOne(
    'SELECT id FROM businesses WHERE id = ? AND owner_user_id = ?',
    [businessId, userId],
    connection
  );
  if (!owner) throw new Error('FORBIDDEN');
}

async function assertEmployee(businessId, employeeId, connection = db, lock = false) {
  if (!employeeId) throw new Error('INVALID_EMPLOYEE');
  const employee = await getOne(
    `SELECT id, employment_status FROM employees
     WHERE business_id = ? AND id = ?${lock ? ' FOR UPDATE' : ''}`,
    [businessId, employeeId],
    connection
  );
  if (!employee) throw new Error('EMPLOYEE_NOT_FOUND');
  return employee;
}

async function listAttendance({ businessId, userId, startDate, endDate, status, page = 1, pageSize = 25 }) {
  await assertOwner(businessId, userId);
  const clauses = ['a.business_id = ?'];
  const params = [businessId];
  if (startDate) {
    if (!isDate(startDate)) throw new Error('INVALID_ATTENDANCE');
    clauses.push('a.work_date >= ?');
    params.push(startDate);
  }
  if (endDate) {
    if (!isDate(endDate)) throw new Error('INVALID_ATTENDANCE');
    clauses.push('a.work_date <= ?');
    params.push(endDate);
  }
  if (startDate && endDate && startDate > endDate) throw new Error('INVALID_ATTENDANCE');
  if (status) {
    if (!['draft', 'submitted', 'approved', 'rejected'].includes(status)) {
      throw new Error('INVALID_ATTENDANCE_FILTER');
    }
    clauses.push('a.status = ?');
    params.push(status);
  }
  const safePage = Math.max(1, Number.parseInt(page, 10) || 1);
  const safePageSize = Math.min(100, Math.max(1, Number.parseInt(pageSize, 10) || 25));
  const where = clauses.join(' AND ');
  const [records, count] = await Promise.all([
    getMany(
      `SELECT a.*, e.employee_number, e.first_name, e.last_name
       FROM attendance_records a
       JOIN employees e ON e.id = a.employee_id AND e.business_id = a.business_id
       WHERE ${where}
       ORDER BY a.work_date DESC, a.id DESC LIMIT ? OFFSET ?`,
      [...params, safePageSize, (safePage - 1) * safePageSize]
    ),
    getOne(`SELECT COUNT(*) AS total FROM attendance_records a WHERE ${where}`, params),
  ]);
  return { records, page: safePage, pageSize: safePageSize, total: Number(count.total) };
}

async function createAttendance({ businessId, userId, payload = {} }) {
  await assertOwner(businessId, userId);
  const employeeId = id(payload.employeeId);
  const workDate = payload.workDate;
  const key = text(payload.idempotencyKey, 191);
  const fields = {
    ordinaryMinutes: payload.ordinaryMinutes ?? 0,
    overtimeMinutes: payload.overtimeMinutes ?? 0,
    sundayMinutes: payload.sundayMinutes ?? 0,
    publicHolidayMinutes: payload.publicHolidayMinutes ?? 0,
    breakMinutes: payload.breakMinutes ?? 0,
    absenceMinutes: payload.absenceMinutes ?? 0,
  };
  const minuteValues = Object.values(fields);
  if (!employeeId || !isDate(workDate) || !key || !key.length ||
      minuteValues.some((value) => !Number.isSafeInteger(value) || value < 0 || value > 1440) ||
      fields.ordinaryMinutes + fields.overtimeMinutes +
        fields.sundayMinutes + fields.publicHolidayMinutes > 1440) {
    throw new Error('INVALID_ATTENDANCE');
  }
  const clockInAt = dateTime(payload.clockInAt);
  const clockOutAt = dateTime(payload.clockOutAt);
  if ((payload.clockInAt && !clockInAt) || (payload.clockOutAt && !clockOutAt) ||
      Boolean(clockInAt) !== Boolean(clockOutAt) ||
      (clockInAt && clockOutAt < clockInAt)) {
    throw new Error('INVALID_ATTENDANCE');
  }
  return withTransaction(async (connection) => {
    await assertEmployee(businessId, employeeId, connection);
    const result = await execute(
      `INSERT INTO attendance_records
       (business_id, employee_id, work_date, clock_in_at, clock_out_at,
        ordinary_minutes, overtime_minutes, sunday_minutes, public_holiday_minutes,
        break_minutes, absence_minutes, status, idempotency_key, notes, submitted_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?, ?, ?)`,
      [
        businessId, employeeId, workDate, clockInAt, clockOutAt,
        fields.ordinaryMinutes, fields.overtimeMinutes, fields.sundayMinutes,
        fields.publicHolidayMinutes, fields.breakMinutes, fields.absenceMinutes,
        key, text(payload.notes, 1000), userId,
      ],
      connection
    );
    await execute(
      `INSERT INTO employee_audit_events (business_id, employee_id, actor_user_id, action)
       VALUES (?, ?, ?, 'attendance_submitted')`,
      [businessId, employeeId, userId],
      connection
    );
    return getOne(
      `SELECT a.*, e.employee_number, e.first_name, e.last_name
       FROM attendance_records a
       JOIN employees e ON e.id = a.employee_id AND e.business_id = a.business_id
       WHERE a.business_id = ? AND a.id = ?`,
      [businessId, result.insertId],
      connection
    );
  });
}

async function adjustAttendance({ businessId, userId, attendanceId, payload = {} }) {
  await assertOwner(businessId, userId);
  const recordId = id(attendanceId);
  const fieldName = payload.fieldName;
  const adjustedMinutes = payload.adjustedMinutes;
  const reason = text(payload.reason, 1000);
  if (!recordId || !MINUTE_FIELDS.has(fieldName) ||
      !Number.isSafeInteger(adjustedMinutes) || adjustedMinutes < 0 ||
      adjustedMinutes > 1440 || !reason) {
    throw new Error('INVALID_ATTENDANCE_ADJUSTMENT');
  }
  return withTransaction(async (connection) => {
    const record = await getOne(
      `SELECT * FROM attendance_records
       WHERE business_id = ? AND id = ? FOR UPDATE`,
      [businessId, recordId],
      connection
    );
    if (!record) throw new Error('ATTENDANCE_NOT_FOUND');
    if (record.status === 'approved') throw new Error('ATTENDANCE_IMMUTABLE');
    const previousMinutes = Number(record[fieldName]);
    if (previousMinutes === adjustedMinutes) throw new Error('ATTENDANCE_UNCHANGED');
    const total = fieldName.endsWith('_minutes') && fieldName !== 'break_minutes' &&
      fieldName !== 'absence_minutes'
      ? Number(record.ordinary_minutes) + Number(record.overtime_minutes) +
        Number(record.sunday_minutes) + Number(record.public_holiday_minutes) -
        (MINUTE_FIELDS.has(fieldName) && [
          'ordinary_minutes', 'overtime_minutes', 'sunday_minutes', 'public_holiday_minutes',
        ].includes(fieldName) ? previousMinutes : 0) + adjustedMinutes
      : Number(record.ordinary_minutes) + Number(record.overtime_minutes) +
        Number(record.sunday_minutes) + Number(record.public_holiday_minutes);
    if (total > 1440) throw new Error('INVALID_ATTENDANCE_ADJUSTMENT');
    await execute(
      `INSERT INTO attendance_adjustments
       (business_id, attendance_id, actor_user_id, field_name,
        previous_minutes, adjusted_minutes, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [businessId, recordId, userId, fieldName, previousMinutes, adjustedMinutes, reason],
      connection
    );
    await execute(
      `UPDATE attendance_records SET ${fieldName} = ?, status = 'submitted',
       reviewed_by = NULL, reviewed_at = NULL, review_comment = NULL
       WHERE business_id = ? AND id = ?`,
      [adjustedMinutes, businessId, recordId],
      connection
    );
    await execute(
      `INSERT INTO employee_audit_events (business_id, employee_id, actor_user_id, action)
       VALUES (?, ?, ?, 'attendance_adjusted')`,
      [businessId, record.employee_id, userId],
      connection
    );
    return getOne(
      'SELECT * FROM attendance_records WHERE business_id = ? AND id = ?',
      [businessId, recordId],
      connection
    );
  });
}

async function reviewAttendance({ businessId, userId, attendanceId, payload = {} }) {
  await assertOwner(businessId, userId);
  const recordId = id(attendanceId);
  const decision = payload.decision;
  const comment = text(payload.comment, 1000);
  if (!recordId || !['approved', 'rejected'].includes(decision) ||
      (decision === 'rejected' && !comment)) {
    throw new Error('INVALID_ATTENDANCE_REVIEW');
  }
  return withTransaction(async (connection) => {
    const record = await getOne(
      'SELECT * FROM attendance_records WHERE business_id = ? AND id = ? FOR UPDATE',
      [businessId, recordId],
      connection
    );
    if (!record) throw new Error('ATTENDANCE_NOT_FOUND');
    if (record.status !== 'submitted') throw new Error('ATTENDANCE_NOT_REVIEWABLE');
    await execute(
      `UPDATE attendance_records SET status = ?, reviewed_by = ?, reviewed_at = UTC_TIMESTAMP(),
       review_comment = ? WHERE business_id = ? AND id = ?`,
      [decision, userId, comment, businessId, recordId],
      connection
    );
    await execute(
      `INSERT INTO employee_audit_events (business_id, employee_id, actor_user_id, action)
       VALUES (?, ?, ?, ?)`,
      [businessId, record.employee_id, userId, `attendance_${decision}`],
      connection
    );
    return getOne(
      'SELECT * FROM attendance_records WHERE business_id = ? AND id = ?',
      [businessId, recordId],
      connection
    );
  });
}

async function listLeaveTypes({ businessId, userId }) {
  await assertOwner(businessId, userId);
  return getMany(
    `SELECT id, code, name, unit, requires_balance, is_paid,
       allow_balance_override, is_active, created_at, updated_at
     FROM leave_types WHERE business_id = ? ORDER BY is_active DESC, name`,
    [businessId]
  );
}

async function createLeaveType({ businessId, userId, payload = {} }) {
  await assertOwner(businessId, userId);
  const code = text(payload.code, 40);
  const name = text(payload.name, 100);
  if (!code || !/^[a-z0-9_-]+$/i.test(code) || !name ||
      !['days', 'hours'].includes(payload.unit) ||
      typeof payload.requiresBalance !== 'boolean' ||
      typeof payload.isPaid !== 'boolean' ||
      typeof payload.allowBalanceOverride !== 'boolean') {
    throw new Error('INVALID_LEAVE_TYPE');
  }
  const result = await execute(
    `INSERT INTO leave_types
     (business_id, code, name, unit, requires_balance, is_paid,
      allow_balance_override, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      businessId, code, name, payload.unit, payload.requiresBalance ? 1 : 0,
      payload.isPaid ? 1 : 0, payload.allowBalanceOverride ? 1 : 0, userId,
    ]
  );
  return getOne(
    `SELECT id, code, name, unit, requires_balance, is_paid,
       allow_balance_override, is_active
     FROM leave_types WHERE business_id = ? AND id = ?`,
    [businessId, result.insertId]
  );
}

async function setLeaveTypeActive({ businessId, userId, leaveTypeId, isActive }) {
  await assertOwner(businessId, userId);
  const typeId = id(leaveTypeId);
  if (!typeId || typeof isActive !== 'boolean') throw new Error('INVALID_LEAVE_TYPE');
  const result = await execute(
    `UPDATE leave_types SET is_active = ?, updated_at = CURRENT_TIMESTAMP
     WHERE business_id = ? AND id = ?`,
    [isActive ? 1 : 0, businessId, typeId]
  );
  if (!result.affectedRows) throw new Error('LEAVE_TYPE_NOT_FOUND');
  return getOne(
    'SELECT id, code, name, unit, requires_balance, is_paid, allow_balance_override, is_active FROM leave_types WHERE business_id = ? AND id = ?',
    [businessId, typeId]
  );
}

async function addLeaveBalance({ businessId, userId, payload = {} }) {
  await assertOwner(businessId, userId);
  const employeeId = id(payload.employeeId);
  const leaveTypeId = id(payload.leaveTypeId);
  const unitsMillis = payload.unitsMillis;
  const sourceType = payload.sourceType;
  const idempotencyKey = text(payload.idempotencyKey, 191);
  const notes = text(payload.reason, 1000);
  if (!employeeId || !leaveTypeId || !Number.isSafeInteger(unitsMillis) ||
      unitsMillis === 0 || !LEAVE_SOURCE_TYPES.has(sourceType) ||
      (['opening_balance', 'accrual'].includes(sourceType) && unitsMillis < 0) ||
      !idempotencyKey || !notes) {
    throw new Error('INVALID_LEAVE_BALANCE');
  }
  return withTransaction(async (connection) => {
    await assertEmployee(businessId, employeeId, connection, true);
    const leaveType = await getOne(
      'SELECT id FROM leave_types WHERE business_id = ? AND id = ? AND is_active = 1 FOR UPDATE',
      [businessId, leaveTypeId],
      connection
    );
    if (!leaveType) throw new Error('LEAVE_TYPE_NOT_FOUND');
    await execute(
      `INSERT INTO leave_balance_entries
       (business_id, employee_id, leave_type_id, source_type,
        idempotency_key, units_millis, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        businessId, employeeId, leaveTypeId, sourceType,
        idempotencyKey, unitsMillis, notes, userId,
      ],
      connection
    );
    await execute(
      `INSERT INTO leave_audit_events
       (business_id, employee_id, actor_user_id, action)
       VALUES (?, ?, ?, 'leave_balance_adjusted')`,
      [businessId, employeeId, userId],
      connection
    );
    return getOne(
      `SELECT COALESCE(SUM(units_millis), 0) AS balance_millis
       FROM leave_balance_entries
       WHERE business_id = ? AND employee_id = ? AND leave_type_id = ?`,
      [businessId, employeeId, leaveTypeId],
      connection
    );
  });
}

async function getLeaveBalances({ businessId, userId, employeeId }) {
  await assertOwner(businessId, userId);
  const employee = id(employeeId);
  if (!employee) throw new Error('INVALID_EMPLOYEE');
  await assertEmployee(businessId, employee);
  return getMany(
    `SELECT lt.id AS leave_type_id, lt.code, lt.name, lt.unit, lt.requires_balance,
       lt.is_paid, COALESCE(SUM(lbe.units_millis), 0) AS balance_millis
     FROM leave_types lt
     LEFT JOIN leave_balance_entries lbe
       ON lbe.business_id = lt.business_id AND lbe.leave_type_id = lt.id
       AND lbe.employee_id = ?
     WHERE lt.business_id = ? AND lt.is_active = 1
     GROUP BY lt.id, lt.code, lt.name, lt.unit, lt.requires_balance, lt.is_paid
     ORDER BY lt.name`,
    [employee, businessId]
  );
}

async function createLeaveRequest({ businessId, userId, payload = {} }) {
  await assertOwner(businessId, userId);
  const employeeId = id(payload.employeeId);
  const leaveTypeId = id(payload.leaveTypeId);
  const startDate = payload.startDate;
  const endDate = payload.endDate;
  const requestedUnitsMillis = payload.requestedUnitsMillis;
  if (!employeeId || !leaveTypeId || !isDate(startDate) || !isDate(endDate) ||
      endDate < startDate || !Number.isSafeInteger(requestedUnitsMillis) ||
      requestedUnitsMillis <= 0 || requestedUnitsMillis > 366000) {
    throw new Error('INVALID_LEAVE_REQUEST');
  }
  return withTransaction(async (connection) => {
    await assertEmployee(businessId, employeeId, connection, true);
    const leaveType = await getOne(
      `SELECT id, unit FROM leave_types
       WHERE business_id = ? AND id = ? AND is_active = 1`,
      [businessId, leaveTypeId],
      connection
    );
    if (!leaveType) throw new Error('LEAVE_TYPE_NOT_FOUND');
    const calendarDays = (Date.parse(`${endDate}T00:00:00Z`) -
      Date.parse(`${startDate}T00:00:00Z`)) / 86400000 + 1;
    const maximumUnits = calendarDays * (leaveType.unit === 'days' ? 1000 : 24000);
    if (requestedUnitsMillis > maximumUnits) throw new Error('INVALID_LEAVE_REQUEST');
    const overlap = await getOne(
      `SELECT id FROM leave_requests
       WHERE business_id = ? AND employee_id = ? AND status IN ('pending', 'approved')
         AND start_date <= ? AND end_date >= ? LIMIT 1`,
      [businessId, employeeId, endDate, startDate],
      connection
    );
    if (overlap) throw new Error('LEAVE_DATES_OVERLAP');
    const result = await execute(
      `INSERT INTO leave_requests
       (business_id, employee_id, leave_type_id, start_date, end_date,
        requested_units_millis, employee_comment, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        businessId, employeeId, leaveTypeId, startDate, endDate,
        requestedUnitsMillis, text(payload.comment, 1000), userId,
      ],
      connection
    );
    await execute(
      `INSERT INTO leave_audit_events
       (business_id, leave_request_id, employee_id, actor_user_id, action)
       VALUES (?, ?, ?, ?, 'leave_requested')`,
      [businessId, result.insertId, employeeId, userId],
      connection
    );
    return getOne(
      `SELECT lr.*, lt.code AS leave_type_code, lt.name AS leave_type_name
       FROM leave_requests lr
       JOIN leave_types lt ON lt.id = lr.leave_type_id AND lt.business_id = lr.business_id
       WHERE lr.business_id = ? AND lr.id = ?`,
      [businessId, result.insertId],
      connection
    );
  });
}

async function listLeaveRequests({ businessId, userId, status }) {
  await assertOwner(businessId, userId);
  if (status && !['pending', 'approved', 'rejected', 'cancelled'].includes(status)) {
    throw new Error('INVALID_LEAVE_REQUEST');
  }
  const params = [businessId];
  const statusFilter = status ? 'AND lr.status = ?' : '';
  if (status) params.push(status);
  return getMany(
    `SELECT lr.*, lt.code AS leave_type_code, lt.name AS leave_type_name,
       e.employee_number, e.first_name, e.last_name
     FROM leave_requests lr
     JOIN leave_types lt ON lt.id = lr.leave_type_id AND lt.business_id = lr.business_id
     JOIN employees e ON e.id = lr.employee_id AND e.business_id = lr.business_id
     WHERE lr.business_id = ? ${statusFilter}
     ORDER BY CASE lr.status WHEN 'pending' THEN 0 ELSE 1 END, lr.start_date, lr.id`,
    params
  );
}

async function reviewLeaveRequest({ businessId, userId, leaveRequestId, payload = {} }) {
  await assertOwner(businessId, userId);
  const requestId = id(leaveRequestId);
  const decision = payload.decision;
  const comment = text(payload.comment, 1000);
  const overrideReason = text(payload.overrideReason, 1000);
  if (!requestId || !['approved', 'rejected'].includes(decision) ||
      (decision === 'rejected' && !comment)) {
    throw new Error('INVALID_LEAVE_REVIEW');
  }
  return withTransaction(async (connection) => {
    const request = await getOne(
      `SELECT * FROM leave_requests WHERE business_id = ? AND id = ? FOR UPDATE`,
      [businessId, requestId],
      connection
    );
    if (!request) throw new Error('LEAVE_REQUEST_NOT_FOUND');
    if (request.status !== 'pending') throw new Error('LEAVE_REQUEST_NOT_REVIEWABLE');
    await assertEmployee(businessId, Number(request.employee_id), connection, true);
    const leaveType = await getOne(
      `SELECT id, requires_balance, allow_balance_override
       FROM leave_types WHERE business_id = ? AND id = ? FOR UPDATE`,
      [businessId, request.leave_type_id],
      connection
    );
    if (!leaveType) throw new Error('LEAVE_TYPE_NOT_FOUND');
    if (decision === 'approved' && flag(leaveType.requires_balance)) {
      const current = await getOne(
        `SELECT COALESCE(SUM(units_millis), 0) AS balance_millis
         FROM leave_balance_entries
         WHERE business_id = ? AND employee_id = ? AND leave_type_id = ?`,
        [businessId, request.employee_id, request.leave_type_id],
        connection
      );
      if (Number(current.balance_millis) < Number(request.requested_units_millis) &&
          !(flag(leaveType.allow_balance_override) && overrideReason)) {
        throw new Error('LEAVE_BALANCE_INSUFFICIENT');
      }
      const key = `leave-request-${request.id}`;
      await execute(
        `INSERT INTO leave_balance_entries
         (business_id, employee_id, leave_type_id, source_type, source_id,
          idempotency_key, units_millis, notes, created_by)
         VALUES (?, ?, ?, 'taken', ?, ?, ?, ?, ?)`,
        [
          businessId, request.employee_id, request.leave_type_id, request.id,
          key, -Number(request.requested_units_millis),
          overrideReason || `Approved leave request ${request.id}`, userId,
        ],
        connection
      );
    }
    await execute(
      `UPDATE leave_requests SET status = ?, reviewed_by = ?, reviewed_at = UTC_TIMESTAMP(),
       reviewer_comment = ?, override_reason = ?
       WHERE business_id = ? AND id = ?`,
      [
        decision, userId, comment,
        decision === 'approved' ? overrideReason : null,
        businessId, requestId,
      ],
      connection
    );
    await execute(
      `INSERT INTO leave_audit_events
       (business_id, leave_request_id, employee_id, actor_user_id, action)
       VALUES (?, ?, ?, ?, ?)`,
      [businessId, requestId, request.employee_id, userId, `leave_${decision}`],
      connection
    );
    return getOne(
      'SELECT * FROM leave_requests WHERE business_id = ? AND id = ?',
      [businessId, requestId],
      connection
    );
  });
}

module.exports = {
  listAttendance,
  createAttendance,
  adjustAttendance,
  reviewAttendance,
  listLeaveTypes,
  createLeaveType,
  setLeaveTypeActive,
  addLeaveBalance,
  getLeaveBalances,
  createLeaveRequest,
  listLeaveRequests,
  reviewLeaveRequest,
};
