function identifyBarcodeFormat(value) {
  const barcode = String(value ?? '').trim();
  if (!/^\d+$/.test(barcode)) return null;
  if (barcode.length === 13) return 'EAN-13';
  if (barcode.length === 8) return 'EAN-8';
  if (barcode.length === 12) return 'UPC-A';
  return null;
}

function isValidBarcode(value) {
  const barcode = String(value ?? '').trim();
  const format = identifyBarcodeFormat(barcode);
  if (!format) return false;

  const digits = [...barcode].map(Number);
  const checkDigit = digits.pop();
  const sum = digits.reduce((total, digit, index) => {
    const weight = (digits.length - 1 - index) % 2 === 0 ? 3 : 1;
    return total + digit * weight;
  }, 0);

  return (10 - (sum % 10)) % 10 === checkDigit;
}

function normalizeBarcode(value) {
  const barcode = String(value ?? '').trim();
  if (!/^\d+$/.test(barcode)) throw new Error('INVALID_BARCODE');
  const format = identifyBarcodeFormat(barcode);
  if (!format || !isValidBarcode(barcode)) throw new Error('INVALID_BARCODE');
  return { barcode, format };
}

module.exports = {
  identifyBarcodeFormat,
  isValidBarcode,
  normalizeBarcode,
};
