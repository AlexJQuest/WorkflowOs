const db = require('./database');

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
      console.error('Payroll run transaction rollback failed:', rollbackError.message);
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

function roundRate(amount, rateBps) {
  return Number((BigInt(amount) * BigInt(rateBps) + 5000n) / 10000n);
}

async function assertOwner(businessId, userId, connection = db) {
  const owner = await getOne(
    'SELECT id, currency FROM businesses WHERE id = ? AND owner_user_id = ?',
    [businessId, userId],
    connection
  );
  if (!owner) throw new Error('FORBIDDEN');
  if (owner.currency !== 'ZAR') throw new Error('PAYROLL_CURRENCY_NOT_ZAR');
}

function serializeRun(row) {
  if (!row) return null;
  for (const field of [
    'total_gross_cents', 'total_paye_cents', 'total_uif_employee_cents',
    'total_uif_employer_cents', 'total_sdl_cents',
    'total_other_deductions_cents', 'total_net_cents', 'total_paid_cents',
    'total_outstanding_cents',
  ]) {
    if (row[field] !== undefined) row[field] = Number(row[field]);
  }
  return row;
}

async function getRun({ businessId, userId, runId, connection = db }) {
  await assertOwner(businessId, userId, connection);
  const run = await getOne(
    'SELECT * FROM payroll_runs WHERE business_id = ? AND id = ?',
    [businessId, runId],
    connection
  );
  if (!run) return null;
  serializeRun(run);
  run.lines = await getMany(
    `SELECT l.*, e.employee_number, e.first_name, e.last_name,
       COALESCE(p.paid_cents, 0) AS paid_cents,
       GREATEST(l.net_cents - COALESCE(p.paid_cents, 0), 0) AS outstanding_cents
     FROM payroll_run_lines l
     JOIN employees e ON e.id = l.employee_id AND e.business_id = l.business_id
     LEFT JOIN (
       SELECT business_id, payroll_run_id, employee_id, SUM(amount_cents) AS paid_cents
       FROM payroll_run_payments
       WHERE business_id = ? AND payroll_run_id = ?
       GROUP BY business_id, payroll_run_id, employee_id
     ) p ON p.business_id = l.business_id
       AND p.payroll_run_id = l.payroll_run_id AND p.employee_id = l.employee_id
     WHERE l.business_id = ? AND l.payroll_run_id = ?
     ORDER BY e.last_name, e.first_name, e.employee_number`,
    [businessId, runId, businessId, runId],
    connection
  );
  for (const line of run.lines) {
    for (const field of [
      'base_rate_cents', 'gross_cents', 'annualized_taxable_cents', 'paye_cents',
      'uif_employee_cents', 'uif_employer_cents', 'sdl_cents',
      'other_deductions_cents', 'net_cents', 'paid_cents', 'outstanding_cents',
    ]) line[field] = line[field] === null ? null : Number(line[field]);
  }
  const paymentTotals = await getOne(
    `SELECT COALESCE(SUM(amount_cents), 0) AS total_paid_cents
     FROM payroll_run_payments
     WHERE business_id = ? AND payroll_run_id = ?`,
    [businessId, runId],
    connection
  );
  run.total_paid_cents = Number(paymentTotals.total_paid_cents);
  run.total_outstanding_cents = Math.max(run.total_net_cents - run.total_paid_cents, 0);
  return run;
}

async function listRuns({ businessId, userId }) {
  await assertOwner(businessId, userId);
  const rows = await getMany(
    `SELECT r.*,
       COALESCE(p.total_paid_cents, 0) AS total_paid_cents,
       GREATEST(r.total_net_cents - COALESCE(p.total_paid_cents, 0), 0)
         AS total_outstanding_cents
     FROM payroll_runs r
     LEFT JOIN (
       SELECT business_id, payroll_run_id, SUM(amount_cents) AS total_paid_cents
       FROM payroll_run_payments
       GROUP BY business_id, payroll_run_id
     ) p ON p.business_id = r.business_id AND p.payroll_run_id = r.id
     WHERE r.business_id = ?
     ORDER BY r.period_start DESC, r.id DESC LIMIT 100`,
    [businessId]
  );
  return rows.map(serializeRun);
}

async function createRun({ businessId, userId, payload = {} }) {
  const { periodStart, periodEnd, payDate } = payload;
  if (!isDate(periodStart) || !isDate(periodEnd) || !isDate(payDate)) {
    throw new Error('INVALID_PAYROLL_RUN');
  }
  const start = new Date(`${periodStart}T00:00:00.000Z`);
  const end = new Date(`${periodEnd}T00:00:00.000Z`);
  const firstDay = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1))
    .toISOString().slice(0, 10);
  const lastDay = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0))
    .toISOString().slice(0, 10);
  if (periodStart !== firstDay || periodEnd !== lastDay || payDate < periodEnd ||
      !Array.isArray(payload.lines) || payload.lines.length > 10000) {
    throw new Error('INVALID_PAYROLL_RUN');
  }

  return withTransaction(async (connection) => {
    await assertOwner(businessId, userId, connection);
    const ruleSet = await getOne(
      `SELECT * FROM payroll_rule_sets
       WHERE business_id = ? AND effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?)
       ORDER BY effective_from DESC LIMIT 1 FOR UPDATE`,
      [businessId, periodStart, periodEnd],
      connection
    );
    if (!ruleSet) throw new Error('PAYROLL_RULE_SET_MISSING');
    const bands = await getMany(
      `SELECT band_order, lower_cents, upper_cents, rate_bps, base_tax_cents
       FROM payroll_paye_bands WHERE business_id = ? AND rule_set_id = ?
       ORDER BY band_order`,
      [businessId, ruleSet.id],
      connection
    );
    if (!bands.length || bands[bands.length - 1].upper_cents !== null) {
      throw new Error('PAYROLL_RULE_SET_MISSING');
    }
    const employees = await getMany(
      `SELECT e.id, e.employee_number, e.first_name, e.last_name,
         c.pay_structure, c.base_rate_cents
       FROM employees e
       LEFT JOIN employee_compensation c
         ON c.employee_id = e.id AND c.business_id = e.business_id
         AND c.effective_from <= ? AND (c.effective_to IS NULL OR c.effective_to >= ?)
       WHERE e.business_id = ? AND e.employment_status <> 'archived'
         AND e.employment_start_date <= ?
         AND (e.employment_end_date IS NULL OR e.employment_end_date >= ?)
       ORDER BY e.id FOR UPDATE`,
      [periodEnd, periodEnd, businessId, periodEnd, periodStart],
      connection
    );
    if (!employees.length || employees.length !== payload.lines.length) {
      throw new Error('INVALID_PAYROLL_RUN_LINES');
    }
    const employeeById = new Map(employees.map((employee) => [Number(employee.id), employee]));
    const seen = new Set();
    const annualRebate = Number(ruleSet.annual_rebate_cents);
    const uifCap = Number(ruleSet.uif_monthly_cap_cents);
    const preparedLines = [];
    let grossTotal = 0;
    let annualizedGrossTotal = 0n;

    for (const input of payload.lines) {
      const employeeId = Number(input?.employeeId);
      const employee = employeeById.get(employeeId);
      const gross = input?.grossCents;
      const otherDeductions = input?.otherDeductionsCents ?? 0;
      if (!employee || seen.has(employeeId) ||
          !Number.isSafeInteger(gross) || gross < 0 ||
          !Number.isSafeInteger(otherDeductions) || otherDeductions < 0) {
        throw new Error('INVALID_PAYROLL_RUN_LINES');
      }
      seen.add(employeeId);
      const annualized = BigInt(gross) * 12n;
      if (annualized > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('INVALID_PAYROLL_RUN_LINES');
      const annualizedCents = Number(annualized);
      annualizedGrossTotal += annualized;
      if (annualizedGrossTotal > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('INVALID_PAYROLL_RUN_LINES');
      const band = bands.find((item) => annualizedCents >= Number(item.lower_cents) &&
        (item.upper_cents === null || annualizedCents < Number(item.upper_cents)));
      if (!band) throw new Error('PAYROLL_RULE_SET_MISSING');
      const marginalTax = roundRate(
        annualizedCents - Number(band.lower_cents),
        Number(band.rate_bps)
      );
      const annualTax = Math.max(0, Number(band.base_tax_cents) + marginalTax - annualRebate);
      const paye = Math.floor((annualTax + 6) / 12);
      const cappedIncome = Math.min(gross, uifCap);
      const uifEmployee = roundRate(cappedIncome, Number(ruleSet.uif_employee_rate_bps));
      const uifEmployer = roundRate(cappedIncome, Number(ruleSet.uif_employer_rate_bps));
      const netBeforeSdl = gross - paye - uifEmployee - otherDeductions;
      if (netBeforeSdl < 0) throw new Error('PAYROLL_NET_NEGATIVE');
      grossTotal += gross;
      if (!Number.isSafeInteger(grossTotal)) throw new Error('INVALID_PAYROLL_RUN_LINES');
      preparedLines.push({
        employee,
        gross,
        annualizedCents,
        paye,
        uifEmployee,
        uifEmployer,
        otherDeductions,
        netBeforeSdl,
        bandOrder: Number(band.band_order),
      });
    }

    const sdlApplies = annualizedGrossTotal > BigInt(ruleSet.sdl_annual_threshold_cents);
    let totalPaye = 0;
    let totalUifEmployee = 0;
    let totalUifEmployer = 0;
    let totalSdl = 0;
    let totalDeductions = 0;
    let totalNet = 0;
    for (const line of preparedLines) {
      line.sdl = sdlApplies ? roundRate(line.gross, Number(ruleSet.sdl_rate_bps)) : 0;
      line.net = line.netBeforeSdl;
      totalPaye += line.paye;
      totalUifEmployee += line.uifEmployee;
      totalUifEmployer += line.uifEmployer;
      totalSdl += line.sdl;
      totalDeductions += line.otherDeductions;
      totalNet += line.net;
    }
    const runResult = await execute(
      `INSERT INTO payroll_runs
       (business_id, rule_set_id, period_start, period_end, pay_date, currency,
        total_gross_cents, total_paye_cents, total_uif_employee_cents,
        total_uif_employer_cents, total_sdl_cents, total_other_deductions_cents,
        total_net_cents, created_by)
       VALUES (?, ?, ?, ?, ?, 'ZAR', ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        businessId, ruleSet.id, periodStart, periodEnd, payDate, grossTotal,
        totalPaye, totalUifEmployee, totalUifEmployer, totalSdl,
        totalDeductions, totalNet, userId,
      ],
      connection
    );
    for (const line of preparedLines) {
      await execute(
        `INSERT INTO payroll_run_lines
         (business_id, payroll_run_id, employee_id, pay_structure, base_rate_cents,
          gross_cents, annualized_taxable_cents, paye_cents, uif_employee_cents,
          uif_employer_cents, sdl_cents, other_deductions_cents, net_cents,
          calculation_snapshot)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          businessId, runResult.insertId, line.employee.id, line.employee.pay_structure,
          line.employee.base_rate_cents, line.gross, line.annualizedCents, line.paye,
          line.uifEmployee, line.uifEmployer, line.sdl, line.otherDeductions,
          line.net, JSON.stringify({
            ruleSetId: Number(ruleSet.id),
            payeBandOrder: line.bandOrder,
            annualRebateCents: annualRebate,
            sdlApplied: sdlApplies,
            grossEnteredByOwner: true,
          }),
        ],
        connection
      );
    }
    await execute(
      `INSERT INTO payroll_run_audit_events (business_id, payroll_run_id, actor_user_id, action)
       VALUES (?, ?, ?, 'run_created')`,
      [businessId, runResult.insertId, userId],
      connection
    );
    return getRun({ businessId, userId, runId: runResult.insertId, connection });
  });
}

async function transitionRun({ businessId, userId, runId, decision }) {
  if (!Number.isSafeInteger(runId) || runId <= 0 ||
      !['approved', 'finalized', 'cancelled'].includes(decision)) {
    throw new Error('INVALID_PAYROLL_RUN_TRANSITION');
  }
  return withTransaction(async (connection) => {
    await assertOwner(businessId, userId, connection);
    const run = await getOne(
      'SELECT id, status FROM payroll_runs WHERE business_id = ? AND id = ? FOR UPDATE',
      [businessId, runId],
      connection
    );
    if (!run) throw new Error('PAYROLL_RUN_NOT_FOUND');
    const validTransition = (decision === 'approved' && run.status === 'draft') ||
      (decision === 'finalized' && run.status === 'approved') ||
      (decision === 'cancelled' && run.status === 'draft');
    if (!validTransition) throw new Error('PAYROLL_RUN_NOT_TRANSITIONABLE');
    await execute(
      `UPDATE payroll_runs SET status = ?,
       approved_by = CASE WHEN ? = 'approved' THEN ? ELSE approved_by END,
       approved_at = CASE WHEN ? = 'approved' THEN UTC_TIMESTAMP() ELSE approved_at END,
       finalized_by = CASE WHEN ? = 'finalized' THEN ? ELSE finalized_by END,
       finalized_at = CASE WHEN ? = 'finalized' THEN UTC_TIMESTAMP() ELSE finalized_at END
       WHERE business_id = ? AND id = ?`,
      [decision, decision, userId, decision, decision, userId, decision, businessId, runId],
      connection
    );
    await execute(
      `INSERT INTO payroll_run_audit_events (business_id, payroll_run_id, actor_user_id, action)
       VALUES (?, ?, ?, ?)`,
      [businessId, runId, userId, `run_${decision}`],
      connection
    );
    return getRun({ businessId, userId, runId, connection });
  });
}

module.exports = { listRuns, getRun, createRun, transitionRun };
