const db = require('./database');

const PAY_STRUCTURES = new Set([
  'monthly_salary',
  'hourly',
  'weekly',
  'fortnightly',
  'daily',
]);
const PAY_FREQUENCIES = new Set(['weekly', 'fortnightly', 'monthly']);
const EMPLOYMENT_TYPES = new Set(['permanent', 'fixed_term', 'casual', 'contractor', 'intern']);
const EMPLOYMENT_STATUSES = new Set(['active', 'on_leave', 'suspended', 'terminated', 'archived']);

const EMPLOYEE_SELECT = `
  SELECT e.id, e.employee_number, e.first_name, e.last_name, e.email, e.portal_user_id, e.phone,
    e.residential_address, e.emergency_contact_name, e.emergency_contact_phone,
    e.job_title, e.department, e.employment_type, e.contract_type,
    e.employment_status, e.employment_start_date, e.employment_end_date,
    e.manager_id, e.work_location, e.created_at, e.updated_at,
    c.pay_structure, c.pay_frequency, c.base_rate_cents, c.hours_per_week_millis,
    c.currency AS compensation_currency, c.effective_from AS compensation_effective_from,
    c.effective_to AS compensation_effective_to
  FROM employees e
  LEFT JOIN employee_compensation c
    ON c.employee_id = e.id AND c.business_id = e.business_id
    AND c.effective_from <= CURRENT_DATE()
    AND (c.effective_to IS NULL OR c.effective_to >= CURRENT_DATE())
`;

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
      console.error('Employee transaction rollback failed:', rollbackError.message);
    }
    throw error;
  } finally {
    connection.release();
  }
}

function isValidDate(value, nullable = false) {
  if (nullable && (value === null || value === undefined || value === '')) return true;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function dateOnly(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function normalizeText(value, maxLength) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text.slice(0, maxLength) : null;
}

async function ensureOwner(businessId, userId, connection = db) {
  const owner = await getOne(
    'SELECT id FROM businesses WHERE id = ? AND owner_user_id = ?',
    [businessId, userId],
    connection
  );
  if (!owner) throw new Error('FORBIDDEN');
}

async function validateManager(businessId, managerId, connection) {
  if (managerId === null) return;
  if (!Number.isSafeInteger(managerId) || managerId <= 0 ||
      !(await getOne(
        'SELECT id FROM employees WHERE id = ? AND business_id = ?',
        [managerId, businessId],
        connection
      ))) {
    throw new Error('INVALID_EMPLOYEE');
  }
}

function validateEmployeePayload(payload, { partial = false } = {}) {
  const values = {
    employeeNumber: normalizeText(payload.employeeNumber, 40),
    firstName: normalizeText(payload.firstName, 100),
    lastName: normalizeText(payload.lastName, 100),
    email: normalizeText(payload.email, 191),
    phone: normalizeText(payload.phone, 50),
    residentialAddress: normalizeText(payload.residentialAddress, 2000),
    emergencyContactName: normalizeText(payload.emergencyContactName, 191),
    emergencyContactPhone: normalizeText(payload.emergencyContactPhone, 50),
    jobTitle: normalizeText(payload.jobTitle, 191),
    department: normalizeText(payload.department, 100),
    employmentType: payload.employmentType,
    contractType: normalizeText(payload.contractType, 100),
    employmentStatus: payload.employmentStatus || 'active',
    employmentStartDate: payload.employmentStartDate,
    employmentEndDate: payload.employmentEndDate || null,
    managerId: payload.managerId === null || payload.managerId === undefined || payload.managerId === ''
      ? null
      : Number(payload.managerId),
    workLocation: normalizeText(payload.workLocation, 191),
  };
  if (partial) {
    for (const key of Object.keys(values)) {
      if (payload[key] === undefined) delete values[key];
    }
  }

  const requiredKeys = ['employeeNumber', 'firstName', 'lastName', 'jobTitle', 'employmentType', 'employmentStartDate'];
  if ((!partial && requiredKeys.some((key) => !values[key])) ||
      (values.employeeNumber && !/^[A-Za-z0-9._/-]+$/.test(values.employeeNumber)) ||
      (values.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) ||
      (values.employmentType && !EMPLOYMENT_TYPES.has(values.employmentType)) ||
      (values.employmentStatus && !EMPLOYMENT_STATUSES.has(values.employmentStatus)) ||
      (values.employmentStartDate !== undefined && !isValidDate(values.employmentStartDate)) ||
      (values.employmentEndDate !== undefined && !isValidDate(values.employmentEndDate, true)) ||
      (values.employmentEndDate && values.employmentStartDate &&
        values.employmentEndDate < values.employmentStartDate) ||
      (values.managerId !== undefined && values.managerId !== null &&
        (!Number.isSafeInteger(values.managerId) || values.managerId <= 0))) {
    throw new Error('INVALID_EMPLOYEE');
  }
  return values;
}

function validateCompensation(payload) {
  const baseRateCents = payload.baseRateCents;
  const hoursPerWeekMillis = payload.hoursPerWeekMillis === null ||
    payload.hoursPerWeekMillis === undefined || payload.hoursPerWeekMillis === ''
    ? null
    : Number(payload.hoursPerWeekMillis);
  if (!PAY_STRUCTURES.has(payload.payStructure) ||
      !PAY_FREQUENCIES.has(payload.payFrequency) ||
      !Number.isSafeInteger(baseRateCents) || baseRateCents <= 0 ||
      (hoursPerWeekMillis !== null &&
        (!Number.isSafeInteger(hoursPerWeekMillis) || hoursPerWeekMillis <= 0 || hoursPerWeekMillis > 168000)) ||
      !isValidDate(payload.effectiveFrom)) {
    throw new Error('INVALID_COMPENSATION');
  }
  return { baseRateCents, hoursPerWeekMillis };
}

function serializeEmployee(row) {
  if (!row) return null;
  return {
    ...row,
    employment_start_date: dateOnly(row.employment_start_date),
    employment_end_date: dateOnly(row.employment_end_date),
    compensation_effective_from: dateOnly(row.compensation_effective_from),
    compensation_effective_to: dateOnly(row.compensation_effective_to),
    base_rate_cents: row.base_rate_cents === null ? null : Number(row.base_rate_cents),
    hours_per_week_millis: row.hours_per_week_millis === null ? null : Number(row.hours_per_week_millis),
  };
}

async function audit(businessId, employeeId, userId, action, connection) {
  await execute(
    `INSERT INTO employee_audit_events
     (business_id, employee_id, actor_user_id, action)
     VALUES (?, ?, ?, ?)`,
    [businessId, employeeId, userId, action],
    connection
  );
}

async function listEmployees({ businessId, userId, search = '', status, page = 1, pageSize = 25 }) {
  await ensureOwner(businessId, userId);
  const safePage = Math.max(1, Number.parseInt(page, 10) || 1);
  const safePageSize = Math.min(100, Math.max(1, Number.parseInt(pageSize, 10) || 25));
  const clauses = ['e.business_id = ?'];
  const params = [businessId];
  if (status) {
    if (!EMPLOYMENT_STATUSES.has(status)) throw new Error('INVALID_EMPLOYEE_FILTER');
    clauses.push('e.employment_status = ?');
    params.push(status);
  }
  const normalizedSearch = String(search || '').trim().slice(0, 100);
  if (normalizedSearch) {
    clauses.push('(e.employee_number LIKE ? OR e.first_name LIKE ? OR e.last_name LIKE ? OR e.email LIKE ? OR e.department LIKE ?)');
    params.push(...Array(5).fill(`%${normalizedSearch}%`));
  }
  const where = clauses.join(' AND ');
  const [rows, count] = await Promise.all([
    getMany(
      `${EMPLOYEE_SELECT}
       WHERE ${where}
       ORDER BY e.last_name, e.first_name, e.id
       LIMIT ? OFFSET ?`,
      [...params, safePageSize, (safePage - 1) * safePageSize]
    ),
    getOne(`SELECT COUNT(*) AS total FROM employees e WHERE ${where}`, params),
  ]);
  return {
    employees: rows.map(serializeEmployee),
    page: safePage,
    pageSize: safePageSize,
    total: Number(count.total),
  };
}

async function getEmployee({ businessId, userId, employeeId }) {
  await ensureOwner(businessId, userId);
  if (!Number.isSafeInteger(employeeId) || employeeId <= 0) throw new Error('INVALID_EMPLOYEE');
  const row = await getOne(
    `${EMPLOYEE_SELECT} WHERE e.business_id = ? AND e.id = ?`,
    [businessId, employeeId]
  );
  return serializeEmployee(row);
}

async function createEmployee({ businessId, userId, payload = {} }) {
  await ensureOwner(businessId, userId);
  const values = validateEmployeePayload(payload);
  const compensation = validateCompensation(payload);
  const business = await getOne('SELECT currency FROM businesses WHERE id = ?', [businessId]);
  if (!business) throw new Error('INVALID_BUSINESS');
  const payCurrency = business.currency || 'ZAR';
  return withTransaction(async (connection) => {
    await validateManager(businessId, values.managerId, connection);
    const result = await execute(
      `INSERT INTO employees
       (business_id, employee_number, first_name, last_name, email, phone,
        residential_address, emergency_contact_name, emergency_contact_phone,
        job_title, department, employment_type, contract_type, employment_status,
        employment_start_date, employment_end_date, manager_id, work_location, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        businessId, values.employeeNumber, values.firstName, values.lastName,
        values.email, values.phone, values.residentialAddress,
        values.emergencyContactName, values.emergencyContactPhone,
        values.jobTitle, values.department, values.employmentType,
        values.contractType, values.employmentStatus, values.employmentStartDate,
        values.employmentEndDate, values.managerId, values.workLocation, userId,
      ],
      connection
    );
    await execute(
      `INSERT INTO employee_compensation
       (business_id, employee_id, pay_structure, pay_frequency, base_rate_cents,
        hours_per_week_millis, currency, effective_from, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        businessId, result.insertId, payload.payStructure, payload.payFrequency,
        compensation.baseRateCents, compensation.hoursPerWeekMillis, payCurrency,
        payload.effectiveFrom, userId,
      ],
      connection
    );
    await audit(businessId, result.insertId, userId, 'employee_created', connection);
    await audit(businessId, result.insertId, userId, 'compensation_created', connection);
    const row = await getOne(
      `${EMPLOYEE_SELECT} WHERE e.business_id = ? AND e.id = ?`,
      [businessId, result.insertId],
      connection
    );
    return serializeEmployee(row);
  });
}

async function updateEmployee({ businessId, userId, employeeId, payload = {} }) {
  await ensureOwner(businessId, userId);
  if (!Number.isSafeInteger(employeeId) || employeeId <= 0) throw new Error('INVALID_EMPLOYEE');
  const values = validateEmployeePayload(payload, { partial: true });
  if (!Object.keys(values).length) throw new Error('INVALID_EMPLOYEE');
  return withTransaction(async (connection) => {
    const existing = await getOne(
      'SELECT * FROM employees WHERE business_id = ? AND id = ? FOR UPDATE',
      [businessId, employeeId],
      connection
    );
    if (!existing) throw new Error('EMPLOYEE_NOT_FOUND');
    const merged = {
      ...existing,
      ...values,
      employment_start_date: dateOnly(existing.employment_start_date),
      employment_end_date: values.employmentEndDate === undefined
        ? dateOnly(existing.employment_end_date)
        : values.employmentEndDate,
    };
    if (merged.employment_end_date && merged.employment_end_date < dateOnly(merged.employment_start_date)) {
      throw new Error('INVALID_EMPLOYEE');
    }
    if (values.managerId !== undefined) {
      if (values.managerId === employeeId) throw new Error('INVALID_EMPLOYEE');
      await validateManager(businessId, values.managerId, connection);
    }
    const employeeEmailChanged = values.email !== undefined &&
      String(values.email || '').trim().toLowerCase() !==
        String(existing.email || '').trim().toLowerCase();
    if (employeeEmailChanged) {
      await execute(
        `DELETE FROM employee_portal_invitations
         WHERE business_id = ? AND employee_id = ?`,
        [businessId, employeeId],
        connection
      );
      if (existing.portal_user_id) {
        await execute(
          `UPDATE employees SET portal_user_id = NULL
           WHERE business_id = ? AND id = ?`,
          [businessId, employeeId],
          connection
        );
        await audit(businessId, employeeId, userId, 'employee_portal_unlinked', connection);
      }
    }
    const columns = {
      employeeNumber: 'employee_number',
      firstName: 'first_name',
      lastName: 'last_name',
      email: 'email',
      phone: 'phone',
      residentialAddress: 'residential_address',
      emergencyContactName: 'emergency_contact_name',
      emergencyContactPhone: 'emergency_contact_phone',
      jobTitle: 'job_title',
      department: 'department',
      employmentType: 'employment_type',
      contractType: 'contract_type',
      employmentStatus: 'employment_status',
      employmentStartDate: 'employment_start_date',
      employmentEndDate: 'employment_end_date',
      managerId: 'manager_id',
      workLocation: 'work_location',
    };
    const updates = Object.entries(values);
    await execute(
      `UPDATE employees SET ${updates.map(([key]) => `${columns[key]} = ?`).join(', ')},
       updated_at = CURRENT_TIMESTAMP WHERE business_id = ? AND id = ?`,
      [...updates.map(([, value]) => value), businessId, employeeId],
      connection
    );
    await audit(
      businessId,
      employeeId,
      userId,
      values.employmentStatus && values.employmentStatus !== existing.employment_status
        ? 'employee_status_changed'
        : 'employee_updated',
      connection
    );
    return serializeEmployee(await getOne(
      `${EMPLOYEE_SELECT} WHERE e.business_id = ? AND e.id = ?`,
      [businessId, employeeId],
      connection
    ));
  });
}

async function addCompensation({ businessId, userId, employeeId, payload = {} }) {
  await ensureOwner(businessId, userId);
  if (!Number.isSafeInteger(employeeId) || employeeId <= 0) throw new Error('INVALID_EMPLOYEE');
  const compensation = validateCompensation(payload);
  const business = await getOne('SELECT currency FROM businesses WHERE id = ?', [businessId]);
  if (!business) throw new Error('INVALID_BUSINESS');
  const payCurrency = business.currency || 'ZAR';
  return withTransaction(async (connection) => {
    const employee = await getOne(
      'SELECT id FROM employees WHERE business_id = ? AND id = ? FOR UPDATE',
      [businessId, employeeId],
      connection
    );
    if (!employee) throw new Error('EMPLOYEE_NOT_FOUND');
    const current = await getOne(
      `SELECT id, effective_from FROM employee_compensation
       WHERE business_id = ? AND employee_id = ?
       ORDER BY effective_from DESC LIMIT 1 FOR UPDATE`,
      [businessId, employeeId],
      connection
    );
    if (current && dateOnly(current.effective_from) >= payload.effectiveFrom) {
      throw new Error('COMPENSATION_PERIOD_OVERLAP');
    }
    if (current) {
      const currentDetails = await getOne(
        'SELECT effective_to FROM employee_compensation WHERE id = ? AND business_id = ?',
        [current.id, businessId],
        connection
      );
      const previousEnd = dateOnly(currentDetails.effective_to);
      if (previousEnd && previousEnd >= payload.effectiveFrom) {
        throw new Error('COMPENSATION_PERIOD_OVERLAP');
      }
      if (!previousEnd) {
        const endDate = new Date(`${payload.effectiveFrom}T00:00:00.000Z`);
        endDate.setUTCDate(endDate.getUTCDate() - 1);
        await execute(
          `UPDATE employee_compensation SET effective_to = ?
           WHERE business_id = ? AND employee_id = ? AND id = ?`,
          [endDate.toISOString().slice(0, 10), businessId, employeeId, current.id],
          connection
        );
      }
    }
    await execute(
      `INSERT INTO employee_compensation
       (business_id, employee_id, pay_structure, pay_frequency, base_rate_cents,
        hours_per_week_millis, currency, effective_from, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        businessId, employeeId, payload.payStructure, payload.payFrequency,
        compensation.baseRateCents, compensation.hoursPerWeekMillis,
        payCurrency, payload.effectiveFrom, userId,
      ],
      connection
    );
    await audit(businessId, employeeId, userId, 'compensation_created', connection);
    return serializeEmployee(await getOne(
      `${EMPLOYEE_SELECT} WHERE e.business_id = ? AND e.id = ?`,
      [businessId, employeeId],
      connection
    ));
  });
}

module.exports = {
  listEmployees,
  getEmployee,
  createEmployee,
  updateEmployee,
  addCompensation,
};
