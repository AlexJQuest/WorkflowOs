const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateSaleTotals } = require('../src/api/sales-calculations');

test('sale totals apply a manual discount before adding tax', () => {
  assert.deepEqual(
    calculateSaleTotals([2500, 1500], {
      discountCents: 500,
      taxCents: 350,
    }),
    {
      subtotalCents: 4000,
      discountCents: 500,
      taxCents: 350,
      totalCents: 3850,
      lineDiscountsCents: [313, 187],
    }
  );
});

test('sale totals default discount and tax to zero', () => {
  assert.deepEqual(calculateSaleTotals([1999]), {
    subtotalCents: 1999,
    discountCents: 0,
    taxCents: 0,
    totalCents: 1999,
    lineDiscountsCents: [0],
  });
});

test('sale totals reject discounts above the subtotal', () => {
  assert.throws(
    () => calculateSaleTotals([1000], { discountCents: 1001 }),
    { message: 'INVALID_SALE' }
  );
});

test('line discount allocations exactly match the sale discount', () => {
  const result = calculateSaleTotals([1001, 2002, 3003], {
    discountCents: 1235,
  });

  assert.deepEqual(result.lineDiscountsCents, [206, 412, 617]);
  assert.equal(
    result.lineDiscountsCents.reduce((sum, amount) => sum + amount, 0),
    result.discountCents
  );
});

test('sale totals reject invalid or unsafe amounts', () => {
  for (const values of [
    { lineTotals: [1000], options: { discountCents: -1 } },
    { lineTotals: [1000], options: { taxCents: 1.5 } },
    { lineTotals: [Number.MAX_SAFE_INTEGER, 1], options: {} },
    { lineTotals: [1], options: { taxCents: Number.MAX_SAFE_INTEGER } },
  ]) {
    assert.throws(
      () => calculateSaleTotals(values.lineTotals, values.options),
      { message: 'INVALID_SALE' }
    );
  }
});
