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
      console.error('Payroll rule transaction rollback failed:', rollbackError.message);
    }
    throw error;
  } finally {
    connection.release();
  }
}

function isDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isCents(value, allowZero = true) {
  return Number.isSafeInteger(value) && (allowZero ? value >= 0 : value > 0);
}

function validateBands(input) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 20) {
    throw new Error('INVALID_PAYROLL_RULE_SET');
  }
  const bands = [];
  let expectedLower = 0;
  let expectedBaseTax = 0;
  let previousRate = -1;
  for (const [index, band] of input.entries()) {
    const lowerCents = band?.lowerCents;
    const upperCents = band?.upperCents;
    const rateBps = band?.rateBps;
    if (!isCents(lowerCents) || lowerCents !== expectedLower ||
        (upperCents !== null && !isCents(upperCents, false)) ||
        (upperCents !== null && upperCents <= lowerCents) ||
        !Number.isSafeInteger(rateBps) || rateBps < 0 || rateBps > 10000 ||
        rateBps < previousRate ||
        (index < input.length - 1 && upperCents === null) ||
        (index === input.length - 1 && upperCents !== null)) {
      throw new Error('INVALID_PAYROLL_RULE_SET');
    }
    bands.push({ bandOrder: index + 1, lowerCents, upperCents, rateBps, baseTaxCents: expectedBaseTax });
    if (upperCents !== null) {
      const taxableWidth = upperCents - lowerCents;
      expectedBaseTax += Number(
        (BigInt(taxableWidth) * BigInt(rateBps) + 5000n) / 10000n
      );
      if (!Number.isSafeInteger(expectedBaseTax)) throw new Error('INVALID_PAYROLL_RULE_SET');
      expectedLower = upperCents;
    }
    previousRate = rateBps;
  }
  return bands;
}

async function assertOwner(businessId, userId, connection = db) {
  const business = await getOne(
    'SELECT id, currency FROM businesses WHERE id = ? AND owner_user_id = ?',
    [businessId, userId],
    connection
  );
  if (!business) throw new Error('FORBIDDEN');
  if (business.currency !== 'ZAR') throw new Error('PAYROLL_CURRENCY_NOT_ZAR');
  return business;
}

async function readRuleSet(businessId, ruleSetId, connection = db) {
  const ruleSet = await getOne(
    `SELECT id, label, effective_from, effective_to, annual_rebate_cents,
       uif_employee_rate_bps, uif_employer_rate_bps, uif_monthly_cap_cents,
       sdl_rate_bps, sdl_annual_threshold_cents, created_at
     FROM payroll_rule_sets WHERE business_id = ? AND id = ?`,
    [businessId, ruleSetId],
    connection
  );
  if (!ruleSet) return null;
  ruleSet.annual_rebate_cents = Number(ruleSet.annual_rebate_cents);
  ruleSet.uif_monthly_cap_cents = Number(ruleSet.uif_monthly_cap_cents);
  ruleSet.sdl_annual_threshold_cents = Number(ruleSet.sdl_annual_threshold_cents);
  ruleSet.paye_bands = await getMany(
    `SELECT band_order, lower_cents, upper_cents, rate_bps, base_tax_cents
     FROM payroll_paye_bands WHERE business_id = ? AND rule_set_id = ?
     ORDER BY band_order`,
    [businessId, ruleSetId],
    connection
  );
  for (const band of ruleSet.paye_bands) {
    band.lower_cents = Number(band.lower_cents);
    band.upper_cents = band.upper_cents === null ? null : Number(band.upper_cents);
    band.base_tax_cents = Number(band.base_tax_cents);
  }
  return ruleSet;
}

async function listRuleSets({ businessId, userId }) {
  await assertOwner(businessId, userId);
  const rows = await getMany(
    'SELECT id FROM payroll_rule_sets WHERE business_id = ? ORDER BY effective_from DESC, id DESC',
    [businessId]
  );
  const ruleSets = [];
  for (const row of rows) ruleSets.push(await readRuleSet(businessId, row.id));
  return ruleSets;
}

async function createRuleSet({ businessId, userId, payload = {} }) {
  const label = typeof payload.label === 'string' ? payload.label.trim().slice(0, 100) : '';
  const effectiveFrom = payload.effectiveFrom;
  const effectiveTo = payload.effectiveTo || null;
  const annualRebateCents = payload.annualRebateCents;
  const uifEmployeeRateBps = payload.uifEmployeeRateBps;
  const uifEmployerRateBps = payload.uifEmployerRateBps;
  const uifMonthlyCapCents = payload.uifMonthlyCapCents;
  const sdlRateBps = payload.sdlRateBps;
  const sdlAnnualThresholdCents = payload.sdlAnnualThresholdCents;
  const bands = validateBands(payload.payeBands);

  if (!label || !isDate(effectiveFrom) ||
      (effectiveTo !== null && (!isDate(effectiveTo) || effectiveTo < effectiveFrom)) ||
      !isCents(annualRebateCents) ||
      !Number.isSafeInteger(uifEmployeeRateBps) || uifEmployeeRateBps < 0 || uifEmployeeRateBps > 10000 ||
      !Number.isSafeInteger(uifEmployerRateBps) || uifEmployerRateBps < 0 || uifEmployerRateBps > 10000 ||
      !isCents(uifMonthlyCapCents, false) ||
      !Number.isSafeInteger(sdlRateBps) || sdlRateBps < 0 || sdlRateBps > 10000 ||
      !isCents(sdlAnnualThresholdCents)) {
    throw new Error('INVALID_PAYROLL_RULE_SET');
  }

  return withTransaction(async (connection) => {
    await assertOwner(businessId, userId, connection);
    const overlapping = await getOne(
      `SELECT id FROM payroll_rule_sets
       WHERE business_id = ?
         AND effective_from <= COALESCE(?, '9999-12-31')
         AND (effective_to IS NULL OR effective_to >= ?)
       LIMIT 1 FOR UPDATE`,
      [businessId, effectiveTo, effectiveFrom],
      connection
    );
    if (overlapping) throw new Error('PAYROLL_RULE_DATE_OVERLAP');
    const result = await execute(
      `INSERT INTO payroll_rule_sets
       (business_id, label, effective_from, effective_to, annual_rebate_cents,
        uif_employee_rate_bps, uif_employer_rate_bps, uif_monthly_cap_cents,
        sdl_rate_bps, sdl_annual_threshold_cents, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        businessId, label, effectiveFrom, effectiveTo, annualRebateCents,
        uifEmployeeRateBps, uifEmployerRateBps, uifMonthlyCapCents,
        sdlRateBps, sdlAnnualThresholdCents, userId,
      ],
      connection
    );
    for (const band of bands) {
      await execute(
        `INSERT INTO payroll_paye_bands
         (business_id, rule_set_id, band_order, lower_cents, upper_cents, rate_bps, base_tax_cents)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          businessId, result.insertId, band.bandOrder, band.lowerCents,
          band.upperCents, band.rateBps, band.baseTaxCents,
        ],
        connection
      );
    }
    await execute(
      `INSERT INTO payroll_rule_audit_events (business_id, rule_set_id, actor_user_id, action)
       VALUES (?, ?, ?, 'rules_created')`,
      [businessId, result.insertId, userId],
      connection
    );
    return readRuleSet(businessId, result.insertId, connection);
  });
}

module.exports = { listRuleSets, createRuleSet };
