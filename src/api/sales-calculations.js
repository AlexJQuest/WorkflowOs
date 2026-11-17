function calculateSaleTotals(lineTotals, { discountCents = 0, taxCents = 0 } = {}) {
  if (
    !Array.isArray(lineTotals) ||
    lineTotals.length === 0 ||
    !Number.isSafeInteger(discountCents) ||
    discountCents < 0 ||
    !Number.isSafeInteger(taxCents) ||
    taxCents < 0
  ) {
    throw new Error('INVALID_SALE');
  }

  let subtotalCents = 0;

  for (const lineTotalCents of lineTotals) {
    if (!Number.isSafeInteger(lineTotalCents) || lineTotalCents < 0) {
      throw new Error('INVALID_SALE');
    }

    subtotalCents += lineTotalCents;

    if (!Number.isSafeInteger(subtotalCents)) {
      throw new Error('INVALID_SALE');
    }
  }

  if (discountCents > subtotalCents) {
    throw new Error('INVALID_SALE');
  }

  const lineDiscountsCents = allocateDiscount(lineTotals, discountCents, subtotalCents);
  const totalCents = subtotalCents - discountCents + taxCents;

  if (!Number.isSafeInteger(totalCents)) {
    throw new Error('INVALID_SALE');
  }

  return {
    subtotalCents,
    discountCents,
    taxCents,
    totalCents,
    lineDiscountsCents,
  };
}

function allocateDiscount(lineTotals, discountCents, subtotalCents) {
  if (discountCents === 0 || subtotalCents === 0) {
    return lineTotals.map(() => 0);
  }

  const denominator = BigInt(subtotalCents);
  const allocations = lineTotals.map((lineTotalCents, index) => {
    const numerator = BigInt(discountCents) * BigInt(lineTotalCents);

    return {
      index,
      amount: Number(numerator / denominator),
      remainder: numerator % denominator,
    };
  });

  let remaining = discountCents - allocations.reduce(
    (sum, allocation) => sum + allocation.amount,
    0
  );

  const byLargestRemainder = [...allocations].sort((left, right) => {
    if (left.remainder === right.remainder) return left.index - right.index;
    return left.remainder > right.remainder ? -1 : 1;
  });

  for (let index = 0; remaining > 0; index += 1) {
    byLargestRemainder[index].amount += 1;
    remaining -= 1;
  }

  return allocations.map((allocation) => allocation.amount);
}

module.exports = { calculateSaleTotals };
