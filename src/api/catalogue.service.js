
const db = require('./database');
const { normalizeBarcode } = require('./barcodes');

// --------------------------------------------------
// DATABASE HELPERS
// --------------------------------------------------

async function queryOne(sql, params = [], connection = db) {
  const [rows] = await connection.execute(sql, params);
  return rows[0] || null;
}

async function queryMany(sql, params = [], connection = db) {
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
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

function escapeLike(value) {
  return String(value).replace(/[!%_]/g, '!$&');
}

function currentDateTime() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

// --------------------------------------------------
// MEMBERSHIP
// --------------------------------------------------

async function requireMembership(businessId, userId) {
  const membership = await queryOne(
    `SELECT role
     FROM business_memberships
     WHERE business_id = ? AND user_id = ?`,
    [businessId, userId]
  );

  if (!membership) throw new Error('FORBIDDEN');

  return membership;
}

// --------------------------------------------------
// BUSINESS PRODUCT SEARCH
// --------------------------------------------------

async function searchBusinessProducts({
  businessId,
  userId,
  query = '',
}) {
  await requireMembership(businessId, userId);

  const value = String(query).trim().slice(0, 100);
  if (!value) return [];

  const searchValue = `%${escapeLike(value)}%`;

  return queryMany(
    `
    SELECT
      p.id,
      p.name,
      p.brand,
      COALESCE(
        p.barcode,
        (
          SELECT pb.barcode
          FROM product_barcodes pb
          WHERE pb.global_product_id = p.global_catalogue_id
            AND pb.verification_status = 'verified'
          ORDER BY pb.id
          LIMIT 1
        )
      ) AS barcode,
      CASE
        WHEN p.barcode_status = 'verified'
          OR EXISTS (
            SELECT 1
            FROM product_barcodes pb
            WHERE pb.global_product_id = p.global_catalogue_id
              AND pb.verification_status = 'verified'
          )
        THEN 'verified'
        ELSE 'unverified'
      END AS barcode_status,
      p.sku,
      p.category,
      p.description,
      p.packaging_size,
      p.price_cents,
      p.cost_cents,
      p.cost_is_known,
      p.is_active,
      i.quantity_on_hand,
      i.reorder_level
    FROM products p
    JOIN inventory i
      ON i.product_id = p.id
      AND i.business_id = p.business_id
    WHERE p.business_id = ?
      AND p.is_active = 1
      AND (
        p.name LIKE ? ESCAPE '!'
        OR p.sku LIKE ? ESCAPE '!'
        OR (
          (p.barcode = ? AND p.barcode_status = 'verified')
          OR EXISTS (
            SELECT 1
            FROM product_barcodes pb
            WHERE pb.global_product_id = p.global_catalogue_id
              AND pb.barcode = ?
              AND pb.verification_status = 'verified'
          )
        )
      )
    ORDER BY
      CASE
        WHEN p.sku = ? THEN 0
        WHEN p.barcode = ? THEN 0
        ELSE 1
      END,
      p.name ASC
    LIMIT 20
    `,
    [
      businessId,
      searchValue,
      searchValue,
      value,
      value,
      value,
      value,
    ]
  );
}

// --------------------------------------------------
// URL VALIDATION
// --------------------------------------------------

function isValidHttpsUrl(value) {
  if (String(value).length > 1000) return false;

  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

// --------------------------------------------------
// VERIFIED BARCODE LOOKUP
// --------------------------------------------------

async function lookupVerifiedBarcode({
  businessId,
  userId,
  barcode,
}) {
  const normalized = normalizeBarcode(barcode);

  await requireMembership(businessId, userId);

  const product = await queryOne(
    `
    SELECT
      p.id,
      p.name,
      p.brand,
      COALESCE(
        p.barcode,
        (
          SELECT pb.barcode
          FROM product_barcodes pb
          WHERE pb.global_product_id = p.global_catalogue_id
            AND pb.verification_status = 'verified'
          ORDER BY pb.id
          LIMIT 1
        )
      ) AS barcode,
      'verified' AS barcode_status,
      p.sku,
      p.category,
      p.description,
      p.packaging_size,
      p.price_cents,
      p.cost_cents,
      p.cost_is_known,
      p.is_active,
      i.quantity_on_hand,
      i.reorder_level
    FROM products p
    JOIN inventory i
      ON i.product_id = p.id
      AND i.business_id = p.business_id
    WHERE p.business_id = ?
      AND (
        (p.barcode = ? AND p.barcode_status = 'verified')
        OR EXISTS (
          SELECT 1
          FROM product_barcodes pb
          WHERE pb.global_product_id = p.global_catalogue_id
            AND pb.barcode = ?
            AND pb.verification_status = 'verified'
        )
      )
    `,
    [
      businessId,
      normalized.barcode,
      normalized.barcode,
    ]
  );

  if (!product) throw new Error('BARCODE_NOT_FOUND');
  if (!product.is_active) throw new Error('PRODUCT_UNAVAILABLE');

  return product;
}

// --------------------------------------------------
// GLOBAL CATALOGUE SEARCH
// --------------------------------------------------

async function searchGlobalCatalogue({
  userId,
  businessId,
  query = '',
}) {
  await requireMembership(businessId, userId);

  const value = String(query).trim().slice(0, 100);
  if (!value) return [];

  const searchValue = `%${escapeLike(value)}%`;

  return queryMany(
    `
    SELECT
      g.id,
      g.product_name,
      g.brand,
      g.packaging_size,
      g.category,
      g.description,
      g.verification_status,
      g.data_source,
      b.barcode,
      b.barcode_format,
      b.verification_status AS barcode_verification_status
    FROM global_product_catalogue g
    LEFT JOIN product_barcodes b
      ON b.global_product_id = g.id
      AND b.verification_status = 'verified'
    WHERE
      g.product_name LIKE ? ESCAPE '!'
      OR COALESCE(g.brand, '') LIKE ? ESCAPE '!'
      OR COALESCE(g.category, '') LIKE ? ESCAPE '!'
    ORDER BY
      CASE
        WHEN g.verification_status = 'verified' THEN 0
        ELSE 1
      END,
      g.brand,
      g.product_name
    LIMIT 50
    `,
    [searchValue, searchValue, searchValue]
  );
}

// --------------------------------------------------
// ADMIN CATALOGUE
// --------------------------------------------------

async function listAdminCatalogue({ query = '' } = {}) {
  const value = String(query).trim().slice(0, 100);
  const searchValue = `%${escapeLike(value)}%`;

  return queryMany(
    `
    SELECT
      g.id,
      g.product_name,
      g.brand,
      g.packaging_size,
      g.category,
      g.description,
      g.verification_status,
      g.data_source,
      g.date_added,
      g.verified_at,
      b.id AS barcode_record_id,
      b.barcode,
      b.barcode_format,
      b.verification_status AS barcode_verification_status,
      b.data_source AS barcode_source,
      b.date_added AS barcode_date_added,
      b.verified_at AS barcode_verified_at
    FROM global_product_catalogue g
    LEFT JOIN product_barcodes b
      ON b.global_product_id = g.id
    WHERE
      (? = ''
        OR g.product_name LIKE ? ESCAPE '!'
        OR COALESCE(g.brand, '') LIKE ? ESCAPE '!'
        OR COALESCE(g.category, '') LIKE ? ESCAPE '!'
        OR COALESCE(b.barcode, '') = ?
      )
    ORDER BY
      g.brand,
      g.product_name,
      b.id
    LIMIT 200
    `,
    [value, searchValue, searchValue, searchValue, value]
  );
}

// --------------------------------------------------
// IMPORT GLOBAL PRODUCT INTO BUSINESS
// --------------------------------------------------

async function importGlobalProduct({
  businessId,
  userId,
  catalogueId,
  pricing = {},
}) {
  await requireMembership(businessId, userId);

  const global = await queryOne(
    'SELECT * FROM global_product_catalogue WHERE id = ?',
    [catalogueId]
  );

  if (!global) throw new Error('CATALOGUE_PRODUCT_NOT_FOUND');

  const barcodeRow = await queryOne(
    `
    SELECT barcode
    FROM product_barcodes
    WHERE global_product_id = ?
      AND verification_status = 'verified'
    ORDER BY id
    LIMIT 1
    `,
    [catalogueId]
  );

  const barcode = barcodeRow?.barcode || null;
  const name = String(global.product_name || '').trim();

  const priceCents = Number(pricing.price || 0) * 100;
  const costPresent =
    pricing.cost !== undefined &&
    pricing.cost !== null &&
    pricing.cost !== '';
  const costCents = Number(pricing.cost || 0) * 100;
  const initialStock = Number(pricing.initialStock || 0);
  const reorderLevel = Number(pricing.reorderLevel || 0);

  if (
    !Number.isSafeInteger(Math.round(priceCents)) ||
    priceCents < 0 ||
    !Number.isSafeInteger(Math.round(costCents)) ||
    costCents < 0 ||
    !Number.isSafeInteger(initialStock) ||
    initialStock < 0 ||
    !Number.isSafeInteger(reorderLevel) ||
    reorderLevel < 0
  ) {
    throw new Error('INVALID_PRODUCT');
  }

  if (barcode) {
    const duplicate = await queryOne(
      `
      SELECT id
      FROM products
      WHERE business_id = ? AND barcode = ?
      `,
      [businessId, barcode]
    );

    if (duplicate) throw new Error('DUPLICATE_BARCODE');
  }

  const productId = await withTransaction(async (connection) => {
    const result = await execute(
      `
      INSERT INTO products (
        business_id,
        name,
        brand,
        barcode,
        barcode_status,
        category,
        description,
        packaging_size,
        price_cents,
        cost_cents,
        cost_is_known,
        is_active,
        global_catalogue_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
      `,
      [
        businessId,
        name,
        global.brand,
        barcode,
        barcode ? 'verified' : 'unverified',
        global.category,
        global.description,
        global.packaging_size,
        Math.round(priceCents),
        Math.round(costCents),
        costPresent ? 1 : 0,
        catalogueId,
      ],
      connection
    );

    const id = Number(result.insertId);
    const now = currentDateTime();

    await execute(
      `
      INSERT INTO inventory (
        business_id,
        product_id,
        quantity_on_hand,
        reorder_level,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?)
      `,
      [businessId, id, initialStock, reorderLevel, now],
      connection
    );

    if (initialStock > 0) {
      await execute(
        `
        INSERT INTO inventory_movements (
          business_id,
          product_id,
          movement_type,
          quantity,
          reference_type,
          reference_id,
          notes,
          created_at
        )
        VALUES (?, ?, 'opening', ?, 'product', ?, 'Opening stock from catalogue import', ?)
        `,
        [businessId, id, initialStock, id, now],
        connection
      );
    }

    return id;
  });

  return queryOne(
    'SELECT * FROM products WHERE id = ?',
    [productId]
  );
}

// --------------------------------------------------
// SAVE OR UPDATE GLOBAL CATALOGUE ENTRY
// --------------------------------------------------

async function saveGlobalCatalogueEntry({
  id,
  product = {},
  dataSource,
}) {
  const name = String(product.productName || '').trim();

  if (!name || name.length > 180) {
    throw new Error('INVALID_CATALOGUE_PRODUCT');
  }

  const fields = [
    name,
    String(product.brand || '').trim() || null,
    String(product.packagingSize || '').trim() || null,
    String(product.category || '').trim() || null,
    String(product.description || '').trim() || null,
    String(dataSource || '').trim().slice(0, 1000),
  ];

  if (!fields[5]) throw new Error('SOURCE_REQUIRED');

  if (id) {
    const result = await execute(
      `
      UPDATE global_product_catalogue
      SET
        product_name = ?,
        brand = ?,
        packaging_size = ?,
        category = ?,
        description = ?,
        data_source = ?,
        verification_status = 'incomplete',
        verified_at = NULL
      WHERE id = ?
      `,
      [...fields, id]
    );

    if (!result.affectedRows) {
      throw new Error('CATALOGUE_PRODUCT_NOT_FOUND');
    }

    await execute(
      `
      UPDATE product_barcodes
      SET
        verification_status = 'unverified',
        verified_at = NULL
      WHERE global_product_id = ?
      `,
      [id]
    );

    return queryOne(
      'SELECT * FROM global_product_catalogue WHERE id = ?',
      [id]
    );
  }

  const result = await execute(
    `
    INSERT INTO global_product_catalogue (
      product_name,
      brand,
      packaging_size,
      category,
      description,
      verification_status,
      data_source
    )
    VALUES (?, ?, ?, ?, ?, 'incomplete', ?)
    `,
    fields
  );

  return queryOne(
    'SELECT * FROM global_product_catalogue WHERE id = ?',
    [result.insertId]
  );
}

// --------------------------------------------------
// ADD GLOBAL BARCODE
// --------------------------------------------------

async function addGlobalBarcode({
  catalogueId,
  barcode,
  dataSource,
}) {
  const global = await queryOne(
    'SELECT id FROM global_product_catalogue WHERE id = ?',
    [catalogueId]
  );

  if (!global) throw new Error('CATALOGUE_PRODUCT_NOT_FOUND');

  const normalized = normalizeBarcode(barcode);
  const source = String(dataSource || '').trim().slice(0, 1000);

  if (!source) throw new Error('SOURCE_REQUIRED');

  const result = await execute(
    `
    INSERT INTO product_barcodes (
      global_product_id,
      barcode,
      barcode_format,
      data_source,
      verification_status
    )
    VALUES (?, ?, ?, ?, 'unverified')
    `,
    [
      catalogueId,
      normalized.barcode,
      normalized.format,
      source,
    ]
  );

  return queryOne(
    'SELECT * FROM product_barcodes WHERE id = ?',
    [result.insertId]
  );
}

// --------------------------------------------------
// VERIFY GLOBAL BARCODE
// --------------------------------------------------

async function verifyGlobalBarcode({
  barcodeId,
  sourceUrl,
}) {
  let url;

  try {
    url = new URL(sourceUrl);
  } catch {
    throw new Error('INVALID_VERIFICATION_SOURCE');
  }

  if (url.protocol !== 'https:') {
    throw new Error('INVALID_VERIFICATION_SOURCE');
  }

  const row = await queryOne(
    'SELECT * FROM product_barcodes WHERE id = ?',
    [barcodeId]
  );

  if (!row) throw new Error('BARCODE_RECORD_NOT_FOUND');

  const now = currentDateTime();

  await withTransaction(async (connection) => {
    await execute(
      `
      UPDATE product_barcodes
      SET
        verification_status = 'verified',
        verified_at = ?,
        data_source = ?
      WHERE id = ?
      `,
      [now, url.toString(), barcodeId],
      connection
    );

    await execute(
      `
      UPDATE global_product_catalogue
      SET
        verification_status = 'verified',
        verified_at = ?
      WHERE id = ?
      `,
      [now, row.global_product_id],
      connection
    );
  });

  return queryOne(
    'SELECT * FROM product_barcodes WHERE id = ?',
    [barcodeId]
  );
}

// --------------------------------------------------
// CSV PARSER
// --------------------------------------------------

function parseCsvLine(line) {
  const fields = [];
  let value = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];

    if (
      character === '"' &&
      quoted &&
      line[index + 1] === '"'
    ) {
      value += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === ',' && !quoted) {
      fields.push(value);
      value = '';
    } else {
      value += character;
    }
  }

  if (quoted) throw new Error('INVALID_CSV');

  fields.push(value);
  return fields;
}

// --------------------------------------------------
// CSV PRODUCT IMPORT
// --------------------------------------------------

async function importProductsCsv({
  businessId,
  userId,
  csv,
}) {
  await requireMembership(businessId, userId);

  if (
    typeof csv !== 'string' ||
    csv.length > 1024 * 1024
  ) {
    throw new Error('INVALID_CSV');
  }

  const lines = csv
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim());

  if (lines.length < 2) throw new Error('INVALID_CSV');

  const headers = parseCsvLine(lines.shift())
    .map((header) =>
      header.trim().toLowerCase().replace(/[_\s-]/g, '')
    );

  const column = (name) =>
    headers.indexOf(
      name.toLowerCase().replace(/[_\s-]/g, '')
    );

  if (column('name') < 0) throw new Error('INVALID_CSV');

  const summary = {
    imported: 0,
    duplicates: 0,
    invalid: 0,
    incomplete: 0,
    errors: [],
  };

  await withTransaction(async (connection) => {
    for (const [index, line] of lines.entries()) {
      let cells;

      try {
        cells = parseCsvLine(line);
      } catch {
        summary.invalid += 1;
        summary.errors.push({
          row: index + 2,
          reason: 'Malformed CSV row',
        });
        continue;
      }

      const get = (name) =>
        column(name) >= 0
          ? (cells[column(name)] || '').trim()
          : '';

      const name = get('name');
      const barcodeValue = get('barcode');
      const sku = get('sku') || null;
      const price = Number(get('price') || 0);
      const costText = get('cost');
      const cost = Number(costText || 0);
      const quantity = Number(get('initialstock') || 0);
      const reorder = Number(get('reorderlevel') || 0);
      const unitOfMeasure = get('unitofmeasure') || 'unit';
      const imageUrl = get('imageurl') || null;

      if (imageUrl && !isValidHttpsUrl(imageUrl)) {
        summary.invalid += 1;
        summary.errors.push({
          row: index + 2,
          reason: 'Image URL must use HTTPS',
        });
        continue;
      }

      if (
        !name ||
        !Number.isFinite(price) ||
        price < 0 ||
        !Number.isFinite(cost) ||
        cost < 0 ||
        !Number.isSafeInteger(Math.round(price * 100)) ||
        !Number.isSafeInteger(Math.round(cost * 100)) ||
        !Number.isSafeInteger(quantity) ||
        quantity < 0 ||
        !Number.isSafeInteger(reorder) ||
        reorder < 0 ||
        !unitOfMeasure ||
        unitOfMeasure.length > 32
      ) {
        summary.invalid += 1;
        summary.errors.push({
          row: index + 2,
          reason: 'Invalid name, price, cost, or stock value',
        });
        continue;
      }

      if (sku) {
        const duplicateSku = await queryOne(
          `
          SELECT id
          FROM products
          WHERE business_id = ? AND sku = ?
          `,
          [businessId, sku],
          connection
        );

        if (duplicateSku) {
          summary.duplicates += 1;
          continue;
        }
      }

      let barcode = null;

      if (barcodeValue) {
        try {
          barcode = normalizeBarcode(barcodeValue).barcode;
        } catch {
          summary.invalid += 1;
          summary.errors.push({
            row: index + 2,
            reason: 'Barcode is not a valid EAN-13, EAN-8, or UPC-A check-digit value',
          });
          continue;
        }

        const duplicateBarcode = await queryOne(
          `
          SELECT id
          FROM products
          WHERE business_id = ? AND barcode = ?
          `,
          [businessId, barcode],
          connection
        );

        if (duplicateBarcode) {
          summary.duplicates += 1;
          continue;
        }
      }

      const result = await execute(
        `
        INSERT INTO products (
          business_id,
          name,
          brand,
          barcode,
          barcode_status,
          sku,
          category,
          description,
          packaging_size,
          unit_of_measure,
          image_url,
          price_cents,
          cost_cents,
          cost_is_known,
          is_active
        )
        VALUES (?, ?, ?, ?, 'unverified', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        `,
        [
          businessId,
          name,
          get('brand') || null,
          barcode,
          sku,
          get('category') || null,
          get('description') || null,
          get('packagingsize') || null,
          unitOfMeasure,
          imageUrl,
          Math.round(price * 100),
          Math.round(cost * 100),
          costText ? 1 : 0,
        ],
        connection
      );

      const productId = Number(result.insertId);

      await execute(
        `
        INSERT INTO inventory (
          business_id,
          product_id,
          quantity_on_hand,
          reorder_level
        )
        VALUES (?, ?, ?, ?)
        `,
        [businessId, productId, quantity, reorder],
        connection
      );

      if (quantity > 0) {
        await execute(
          `
          INSERT INTO inventory_movements (
            business_id,
            product_id,
            movement_type,
            quantity,
            reference_type,
            reference_id,
            notes,
            created_at
          )
          VALUES (?, ?, 'opening', ?, 'product', ?, 'Opening stock from CSV import', ?)
          `,
          [
            businessId,
            productId,
            quantity,
            productId,
            currentDateTime(),
          ],
          connection
        );
      }

      summary.imported += 1;
      summary.incomplete += 1;
    }
  });

  return summary;
}

// --------------------------------------------------
// CSV PRODUCT EXPORT
// --------------------------------------------------

async function exportProductsCsv({
  businessId,
  userId,
}) {
  await requireMembership(businessId, userId);

  const rows = await queryMany(
    `
    SELECT
      p.name,
      p.brand,
      COALESCE(
        p.barcode,
        (
          SELECT pb.barcode
          FROM product_barcodes pb
          WHERE pb.global_product_id = p.global_catalogue_id
            AND pb.verification_status = 'verified'
          ORDER BY pb.id
          LIMIT 1
        )
      ) AS barcode,
      CASE
        WHEN p.barcode_status = 'verified'
          OR EXISTS (
            SELECT 1
            FROM product_barcodes pb
            WHERE pb.global_product_id = p.global_catalogue_id
              AND pb.verification_status = 'verified'
          )
        THEN 'verified'
        ELSE 'unverified'
      END AS barcode_status,
      p.sku,
      p.category,
      p.description,
      p.packaging_size,
      p.unit_of_measure,
      p.image_url,
      p.price_cents,
      p.cost_cents,
      p.cost_is_known,
      i.quantity_on_hand,
      i.reorder_level
    FROM products p
    JOIN inventory i
      ON i.product_id = p.id
      AND i.business_id = p.business_id
    WHERE p.business_id = ?
    ORDER BY p.name
    `,
    [businessId]
  );

  const header = [
    'name',
    'brand',
    'barcode',
    'barcode_status',
    'sku',
    'category',
    'description',
    'packaging_size',
    'unit_of_measure',
    'image_url',
    'price',
    'cost',
    'cost_is_known',
    'initialStock',
    'reorderLevel',
  ];

  const quote = (value) => {
    let text = String(value ?? '');

    // Prevent spreadsheet formula injection.
    if (/^[=+\-@\t\r]/.test(text)) {
      text = `'${text}`;
    }

    return `"${text.replace(/"/g, '""')}"`;
  };

  return [
    header,
    ...rows.map((row) => [
      row.name,
      row.brand,
      row.barcode,
      row.barcode_status,
      row.sku,
      row.category,
      row.description,
      row.packaging_size,
      row.unit_of_measure,
      row.image_url,
      (Number(row.price_cents) / 100).toFixed(2),
      row.cost_is_known
        ? (Number(row.cost_cents) / 100).toFixed(2)
        : '',
      row.cost_is_known,
      row.quantity_on_hand,
      row.reorder_level,
    ]),
  ]
    .map((line) => line.map(quote).join(','))
    .join('\r\n');
}

// --------------------------------------------------
// EXPORTS
// --------------------------------------------------

module.exports = {
  searchBusinessProducts,
  lookupVerifiedBarcode,
  searchGlobalCatalogue,
  listAdminCatalogue,
  importGlobalProduct,
  saveGlobalCatalogueEntry,
  addGlobalBarcode,
  verifyGlobalBarcode,
  importProductsCsv,
  exportProductsCsv,
};
