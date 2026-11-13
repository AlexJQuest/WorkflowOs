'use strict';

const db = require('../../api/database');
const { normalizeBarcode } = require('../../api/barcodes');

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const { pipeline } = require('node:stream/promises');
const { Readable, Transform } = require('node:stream');
const zlib = require('node:zlib');
const readline = require('node:readline');

const SOURCE = 'Open Prices (Open Food Facts) - ODbL 1.0';
const BASE_URL = 'https://prices.openfoodfacts.org/data';
const EXPECTED_DATABASE = 'workflowos_test';
const EXPECTED_HOST = 'workflow-main-idle-pine.bulrush.cloud.layerbase.dev';
const BATCH_SIZE = 300;
const DOWNLOAD_TIMEOUT = 30 * 60 * 1000;

function valueText(value) {
  if (Array.isArray(value)) {
    return value.map(valueText).filter(Boolean).join(', ');
  }

  if (value && typeof value === 'object') return '';

  return value == null ? '' : String(value).trim();
}

function firstValue(...values) {
  for (const value of values) {
    const result = valueText(value);
    if (result) return result;
  }

  return null;
}

function safeDate(value) {
  if (!value) return null;

  const result = String(value).slice(0, 10);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) return null;

  const date = new Date(`${result}T00:00:00Z`);

  return Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== result
    ? null
    : result;
}

function parseMoney(value) {
  if (value === null || value === undefined || value === '') return null;

  const number = Number(value);

  return Number.isFinite(number) && number >= 0 ? number : null;
}

function safeInteger(value) {
  const number = Number(value);

  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function assertTestDatabase(identity) {
  if (
    identity.databaseName !== EXPECTED_DATABASE ||
    process.env.TEST_DB_HOST !== EXPECTED_HOST
  ) {
    throw new Error(
      `SAFETY STOP: Expected ${EXPECTED_DATABASE} on ${EXPECTED_HOST}. ` +
      `Connected database: ${identity.databaseName}.`
    );
  }
}

function placeholders(rowCount, columnCount) {
  const row = `(${Array(columnCount).fill('?').join(',')})`;

  return Array(rowCount).fill(row).join(',');
}

async function downloadExport(name, directory) {
  const url = `${BASE_URL}/${name}.jsonl.gz`;
  const destination = path.join(directory, `${name}.jsonl.gz`);

  console.log(`\n[DOWNLOAD] ${name}`);
  console.log(`URL: ${url}`);

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'WorkflowOS/0.1 (Open Prices data integration)',
    },
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT),
  });

  if (!response.ok || !response.body) {
    throw new Error(`Download failed for ${name}: HTTP ${response.status}`);
  }

  const expectedBytes = Number(response.headers.get('content-length')) || 0;
  let downloadedBytes = 0;
  let lastReportedMB = 0;

  const progress = new Transform({
    transform(chunk, encoding, callback) {
      downloadedBytes += chunk.length;

      const currentMB = Math.floor(downloadedBytes / 5_000_000);

      if (currentMB > lastReportedMB) {
        lastReportedMB = currentMB;

        const current = (downloadedBytes / 1_000_000).toFixed(1);
        const total = expectedBytes
          ? ` / ${(expectedBytes / 1_000_000).toFixed(1)} MB`
          : '';

        process.stdout.write(`\rDownloading ${name}: ${current}${total} MB`);
      }

      callback(null, chunk);
    },
  });

  await pipeline(
    Readable.fromWeb(response.body),
    progress,
    fs.createWriteStream(destination)
  );

  const actualMB = (downloadedBytes / 1_000_000).toFixed(2);

  console.log(`\n[DOWNLOADED] ${name}: ${actualMB} MB`);

  return destination;
}

async function* readJsonlGzip(filePath) {
  const input = fs.createReadStream(filePath).pipe(zlib.createGunzip());

  const lines = readline.createInterface({
    input,
    crlfDelay: Infinity,
  });

  let lineNumber = 0;

  try {
    for await (const line of lines) {
      lineNumber++;

      if (!line.trim()) continue;

      try {
        yield JSON.parse(line);
      } catch {
        throw new Error(
          `Invalid JSON in ${path.basename(filePath)}, line ${lineNumber}.`
        );
      }
    }
  } finally {
    lines.close();
    input.destroy();
  }
}

async function getExistingBarcodes(connection, barcodes) {
  if (!barcodes.length) return new Map();

  const [rows] = await connection.execute(
    `SELECT barcode, global_product_id
     FROM product_barcodes
     WHERE barcode IN (${barcodes.map(() => '?').join(',')})`,
    barcodes
  );

  return new Map(
    rows.map((row) => [
      row.barcode,
      Number(row.global_product_id),
    ])
  );
}

async function processProductsBatch(connection, batch, stats, dryRun) {
  const unique = new Map();

  for (const product of batch) {
    const code = firstValue(product.code, product.product_code);

    if (!code) {
      stats.productsSkipped++;
      continue;
    }

    let normalized;

    try {
      normalized = normalizeBarcode(code);
    } catch {
      stats.invalidBarcodes++;
      continue;
    }

    const barcode = normalized.barcode;

    if (unique.has(barcode)) {
      stats.productsDuplicate++;
      continue;
    }

    const name = firstValue(product.product_name, product.product_name_en);

    if (!name) {
      stats.productsSkipped++;
      continue;
    }

    const quantity = firstValue(
      product.product_quantity && product.product_quantity_unit
        ? `${product.product_quantity} ${product.product_quantity_unit}`
        : null,
      product.quantity
    );

    const categories = firstValue(
      product.categories_tags,
      product.category
    );

    unique.set(barcode, {
      barcode,
      format: normalized.format,
      name,
      brand: firstValue(product.brands, product.brand),
      packaging: quantity,
      category: categories,
      description: firstValue(product.generic_name, product.description),
    });
  }

  const products = [...unique.values()];

  if (!products.length) return;

  const existing = await getExistingBarcodes(
    connection,
    products.map((product) => product.barcode)
  );

  const missing = products.filter(
    (product) => !existing.has(product.barcode)
  );

  stats.productsMatched += products.length - missing.length;
  stats.barcodesExisting += products.length - missing.length;

  if (dryRun) {
    stats.productsWouldInsert += missing.length;
    stats.barcodesWouldInsert += missing.length;
    return;
  }

  if (!missing.length) return;

  await connection.beginTransaction();

  try {
    const catalogueValues = [];
    const catalogueParams = [];

    for (const product of missing) {
      catalogueValues.push(
        product.name,
        product.brand,
        product.packaging,
        product.category,
        product.description,
        SOURCE
      );
    }

    const catalogueSql = `
      INSERT INTO global_product_catalogue
        (product_name, brand, packaging_size, category, description,
         verification_status, data_source)
      VALUES ${placeholders(missing.length, 6)
        .replaceAll('?', '?')
        .replace(/\(([^()]*)\)/g, (match) =>
          match.replace(/,\s*$/, '')
        )}
    `;

    // Each imported product receives an incomplete verification status.
    const catalogueRows = missing.map(() => (
      '(?, ?, ?, ?, ?, ?, ?)'
    ));

    const finalCatalogueParams = [];

    for (const product of missing) {
      finalCatalogueParams.push(
        product.name,
        product.brand,
        product.packaging,
        product.category,
        product.description,
        'incomplete',
        SOURCE
      );
    }

    const [insertResult] = await connection.execute(
      `INSERT INTO global_product_catalogue
       (product_name, brand, packaging_size, category, description,
        verification_status, data_source)
       VALUES ${catalogueRows.join(',')}`,
      finalCatalogueParams
    );

    const firstId = Number(insertResult.insertId);

    const barcodeRows = [];
    const barcodeParams = [];

    for (let index = 0; index < missing.length; index++) {
      const product = missing[index];
      const productId = firstId + index;

      barcodeRows.push('(?, ?, ?, ?, ?)');

      barcodeParams.push(
        productId,
        product.barcode,
        product.format,
        SOURCE,
        'unverified'
      );
    }

    await connection.execute(
      `INSERT INTO product_barcodes
       (global_product_id, barcode, barcode_format, data_source,
        verification_status)
       VALUES ${barcodeRows.join(',')}`,
      barcodeParams
    );

    await connection.commit();

    stats.productsInserted += missing.length;
    stats.barcodesInserted += missing.length;
  } catch (error) {
    await connection.rollback();
    throw error;
  }
}

async function importProducts(connection, filePath, stats, dryRun) {
  console.log('\n[IMPORT] Products');

  let batch = [];
  let lastReport = Date.now();

  for await (const product of readJsonlGzip(filePath)) {
    batch.push(product);
    stats.productsRead++;

    if (batch.length >= BATCH_SIZE) {
      await processProductsBatch(connection, batch, stats, dryRun);
      batch = [];
    }

    if (Date.now() - lastReport >= 3000) {
      console.log(
        `Products processed: ${stats.productsRead.toLocaleString()}`
      );
      lastReport = Date.now();
    }
  }

  if (batch.length) {
    await processProductsBatch(connection, batch, stats, dryRun);
  }

  console.log(
    `[COMPLETE] Products: ${stats.productsRead.toLocaleString()} records`
  );
}

async function processLocationsBatch(connection, batch, stats, dryRun) {
  if (!batch.length) return;

  const valid = [];

  for (const location of batch) {
    const id = safeInteger(location.id);

    if (!id) {
      stats.locationsSkipped++;
      continue;
    }

    valid.push([
      id,
      firstValue(location.osm_name, location.osm_brand),
      firstValue(location.osm_address_country),
      firstValue(location.osm_address_country_code),
      firstValue(location.osm_address_city),
      firstValue(location.osm_display_name),
      JSON.stringify(location),
    ]);
  }

  if (!valid.length) return;

  if (dryRun) {
    stats.locationsUpserted += valid.length;
    return;
  }

  const params = valid.flat();

  await connection.execute(
    `INSERT INTO open_prices_locations
     (source_location_id, name, country, country_code, city, address, raw_data)
     VALUES ${placeholders(valid.length, 7)}
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       country = VALUES(country),
       country_code = VALUES(country_code),
       city = VALUES(city),
       address = VALUES(address),
       raw_data = VALUES(raw_data)`,
    params
  );

  stats.locationsUpserted += valid.length;
}

async function importLocations(connection, filePath, stats, dryRun) {
  console.log('\n[IMPORT] Locations');

  let batch = [];
  let lastReport = Date.now();

  for await (const location of readJsonlGzip(filePath)) {
    batch.push(location);
    stats.locationsRead++;

    if (batch.length >= BATCH_SIZE) {
      await processLocationsBatch(connection, batch, stats, dryRun);
      batch = [];
    }

    if (Date.now() - lastReport >= 3000) {
      console.log(
        `Locations processed: ${stats.locationsRead.toLocaleString()}`
      );
      lastReport = Date.now();
    }
  }

  if (batch.length) {
    await processLocationsBatch(connection, batch, stats, dryRun);
  }

  console.log(
    `[COMPLETE] Locations: ${stats.locationsRead.toLocaleString()} records`
  );
}

async function processPricesBatch(connection, batch, stats, dryRun) {
  if (!batch.length) return;

  const valid = [];
  const codes = new Set();

  for (const price of batch) {
    const sourceId = safeInteger(price.id);
    const amount = parseMoney(price.price);
    const currency = firstValue(price.currency);
    const date = safeDate(price.date);

    if (!sourceId || amount === null || !currency || !date) {
      stats.pricesSkipped++;
      continue;
    }

    const code = firstValue(price.product_code);

    if (code) {
      try {
        codes.add(normalizeBarcode(code).barcode);
      } catch {
        stats.invalidPriceBarcodes++;
      }
    }

    valid.push({
      sourceId,
      code,
      amount,
      currency,
      date,
      pricePer: firstValue(price.price_per),
      discounted: price.price_is_discounted ? 1 : 0,
      originalPrice: parseMoney(price.price_without_discount),
      locationId: safeInteger(price.location_id),
      proofId: safeInteger(price.proof_id),
      type: firstValue(price.type),
      productName: firstValue(price.product_name),
      raw: JSON.stringify(price),
    });
  }

  if (!valid.length) return;

  const productMap = new Map();

  const codeList = [...codes];

  for (let offset = 0; offset < codeList.length; offset += 500) {
    const chunk = codeList.slice(offset, offset + 500);
    const matches = await getExistingBarcodes(connection, chunk);

    for (const [barcode, productId] of matches) {
      productMap.set(barcode, productId);
    }
  }

  const rows = [];

  for (const price of valid) {
    let productId = null;

    if (price.code) {
      try {
        productId = productMap.get(
          normalizeBarcode(price.code).barcode
        ) || null;
      } catch {
        // The observation is retained even if its barcode is invalid.
      }
    }

    if (productId) stats.pricesMatched++;
    else stats.pricesUnmatched++;

    rows.push([
      price.sourceId,
      price.code,
      productId,
      price.amount,
      price.currency,
      price.date,
      price.pricePer,
      price.discounted,
      price.originalPrice,
      price.locationId,
      price.proofId,
      price.type,
      price.productName,
      price.raw,
    ]);
  }

  if (!dryRun) {
    await connection.execute(
      `INSERT INTO open_prices_observations
       (source_price_id, product_code, global_product_id, price, currency,
        price_date, price_per, price_is_discounted, price_without_discount,
        source_location_id, source_proof_id, source_type, product_name, raw_data)
       VALUES ${placeholders(rows.length, 14)}
       ON DUPLICATE KEY UPDATE
         product_code = VALUES(product_code),
         global_product_id = VALUES(global_product_id),
         price = VALUES(price),
         currency = VALUES(currency),
         price_date = VALUES(price_date),
         price_per = VALUES(price_per),
         price_is_discounted = VALUES(price_is_discounted),
         price_without_discount = VALUES(price_without_discount),
         source_location_id = VALUES(source_location_id),
         source_proof_id = VALUES(source_proof_id),
         source_type = VALUES(source_type),
         product_name = VALUES(product_name),
         raw_data = VALUES(raw_data)`,
      rows.flat()
    );
  }

  stats.pricesUpserted += rows.length;
}

async function importPrices(connection, filePath, stats, dryRun) {
  console.log('\n[IMPORT] Price observations');

  let batch = [];
  let lastReport = Date.now();

  for await (const price of readJsonlGzip(filePath)) {
    batch.push(price);
    stats.pricesRead++;

    if (batch.length >= BATCH_SIZE) {
      await processPricesBatch(connection, batch, stats, dryRun);
      batch = [];
    }

    if (Date.now() - lastReport >= 3000) {
      console.log(
        `Price observations processed: ${stats.pricesRead.toLocaleString()}`
      );
      lastReport = Date.now();
    }
  }

  if (batch.length) {
    await processPricesBatch(connection, batch, stats, dryRun);
  }

  console.log(
    `[COMPLETE] Prices: ${stats.pricesRead.toLocaleString()} records`
  );
}

async function syncOpenPrices({
  dryRun = true,
  exports = ['products', 'locations', 'prices'],
} = {}) {
  const allowedExports = ['products', 'locations', 'prices'];

  if (!Array.isArray(exports) || exports.length === 0) {
    throw new Error('Select at least one export.');
  }

  const selectedExports = [...new Set(exports)];

  for (const name of selectedExports) {
    if (!allowedExports.includes(name)) {
      throw new Error(`Unsupported export: ${name}`);
    }
  }

  const [identityRows] = await db.execute(
    'SELECT DATABASE() AS databaseName, VERSION() AS version'
  );

  const identity = identityRows[0];

  assertTestDatabase(identity);

  const stats = {
    database: identity.databaseName,
    databaseVersion: identity.version,
    dryRun,

    productsRead: 0,
    productsInserted: 0,
    productsMatched: 0,
    productsWouldInsert: 0,
    productsSkipped: 0,
    productsDuplicate: 0,

    barcodesInserted: 0,
    barcodesWouldInsert: 0,
    barcodesExisting: 0,
    invalidBarcodes: 0,

    locationsRead: 0,
    locationsUpserted: 0,
    locationsSkipped: 0,

    pricesRead: 0,
    pricesUpserted: 0,
    pricesMatched: 0,
    pricesUnmatched: 0,
    pricesSkipped: 0,
    invalidPriceBarcodes: 0,
  };

  const directory = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'workflowos-open-prices-')
  );

  let connection;

  try {
    console.log('\nWORKFLOWOS OPEN PRICES IMPORT');
    console.log('Database:', identity.databaseName);
    console.log('Mode:', dryRun ? 'DRY RUN' : 'APPLY');
    console.log('Exports:', selectedExports.join(', '));

    connection = await db.getConnection();

    const downloaded = {};

    for (const name of selectedExports) {
      downloaded[name] = await downloadExport(name, directory);
    }

    if (downloaded.products) {
      await importProducts(
        connection,
        downloaded.products,
        stats,
        dryRun
      );
    }

    if (downloaded.locations) {
      await importLocations(
        connection,
        downloaded.locations,
        stats,
        dryRun
      );
    }

    if (downloaded.prices) {
      await importPrices(
        connection,
        downloaded.prices,
        stats,
        dryRun
      );
    }

    return stats;
  } finally {
    if (connection) {
      connection.release();
    }

    try {
      await fs.promises.rm(directory, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 500,
      });
    } catch (cleanupError) {
      console.warn(
        '[CLEANUP WARNING] Could not completely remove temporary directory:',
        cleanupError.message
      );
    }
  }
}

module.exports = { syncOpenPrices };

