'use strict';

const db = require('./database');
const { syncOpenPrices } = require('../integrations/open-prices/importer');

async function getOpenPricesStatus() {
  const [databaseRows] = await db.execute('SELECT DATABASE() AS databaseName');
  const [productRows] = await db.execute(
    'SELECT COUNT(*) AS total FROM global_product_catalogue'
  );
  const [barcodeRows] = await db.execute(
    'SELECT COUNT(*) AS total FROM product_barcodes'
  );
  const [priceRows] = await db.execute(
    'SELECT COUNT(*) AS total, MAX(price_date) AS latestPriceDate FROM open_prices_observations'
  );
  const [locationRows] = await db.execute(
    'SELECT COUNT(*) AS total FROM open_prices_locations'
  );

  return {
    database: databaseRows[0].databaseName,
    source: 'Open Prices / Open Food Facts',
    licence: 'Open Database Licence (ODbL) 1.0',
    products: Number(productRows[0].total),
    barcodes: Number(barcodeRows[0].total),
    priceObservations: Number(priceRows[0].total),
    latestPriceDate: priceRows[0].latestPriceDate,
    locations: Number(locationRows[0].total),
  };
}

async function updateOpenPrices(options = {}) {
  return syncOpenPrices({
    dryRun: options.dryRun !== false,
    exports: options.exports || ['products', 'locations', 'prices'],
  });
}

async function searchWorldwidePrices({ barcode, query, countryCode, limit = 50 } = {}) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
  const conditions = [];
  const params = [];

  if (barcode) {
    conditions.push('p.product_code = ?');
    params.push(String(barcode).trim());
  }
  if (query) {
    conditions.push('(p.product_name LIKE ? OR c.product_name LIKE ? OR c.brand LIKE ?)');
    const term = `%${String(query).trim()}%`;
    params.push(term, term, term);
  }
  if (countryCode) {
    conditions.push('l.country_code = ?');
    params.push(String(countryCode).trim().toUpperCase());
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const [rows] = await db.execute(
    `SELECT p.source_price_id, p.product_code, p.global_product_id,
            COALESCE(p.product_name, c.product_name) AS product_name,
            c.brand, c.packaging_size, p.price, p.currency, p.price_date,
            p.price_per, p.price_is_discounted, p.price_without_discount,
            l.name AS store_name, l.country, l.country_code, l.city
     FROM open_prices_observations p
     LEFT JOIN global_product_catalogue c ON c.id = p.global_product_id
     LEFT JOIN open_prices_locations l ON l.source_location_id = p.source_location_id
     ${where}
     ORDER BY p.price_date DESC, p.source_price_id DESC
     LIMIT ${safeLimit}`,
    params
  );

  return rows;
}

module.exports = {
  getOpenPricesStatus,
  updateOpenPrices,
  searchWorldwidePrices,
};
