const db = require('./database');
const { normalizeBarcode } = require('./barcodes');

function requireMembership(businessId, userId) {
  const membership = db.prepare('SELECT role FROM business_memberships WHERE business_id = ? AND user_id = ?').get(businessId, userId);
  if (!membership) throw new Error('FORBIDDEN');
  return membership;
}

function searchBusinessProducts({ businessId, userId, query = '' }) {
  requireMembership(businessId, userId);
  const value = String(query).trim().slice(0, 100);
  if (!value) return [];
  const rows = db.prepare(`
    SELECT p.id, p.name, p.brand,
      COALESCE(p.barcode, (SELECT pb.barcode FROM product_barcodes pb WHERE pb.global_product_id = p.global_catalogue_id AND pb.verification_status = 'verified' ORDER BY pb.id LIMIT 1)) AS barcode,
      CASE WHEN p.barcode_status = 'verified' OR EXISTS (SELECT 1 FROM product_barcodes pb WHERE pb.global_product_id = p.global_catalogue_id AND pb.verification_status = 'verified') THEN 'verified' ELSE 'unverified' END AS barcode_status,
      p.sku, p.category, p.description, p.packaging_size, p.price_cents, p.cost_cents, p.cost_is_known,
      p.is_active, i.quantity_on_hand, i.reorder_level
    FROM products p JOIN inventory i ON i.product_id = p.id AND i.business_id = p.business_id
    WHERE p.business_id = ? AND p.is_active = 1 AND (
      p.name LIKE ? ESCAPE '\\' OR p.sku LIKE ? ESCAPE '\\' OR
      ((p.barcode = ? AND p.barcode_status = 'verified') OR EXISTS (
        SELECT 1 FROM product_barcodes pb WHERE pb.global_product_id = p.global_catalogue_id
          AND pb.barcode = ? AND pb.verification_status = 'verified'
      ))
    )
    ORDER BY CASE WHEN p.sku = ? THEN 0 WHEN p.barcode = ? THEN 0 ELSE 1 END, p.name ASC
    LIMIT 20
  `).all(businessId, `%${escapeLike(value)}%`, `%${escapeLike(value)}%`, value, value, value, value);
  return rows;
}

function escapeLike(value) {
  return value.replace(/[\\%_]/g, '\\$&');
}

function isValidHttpsUrl(value) {
  if (String(value).length > 1000) return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function lookupVerifiedBarcode({ businessId, userId, barcode }) {
  const normalized = normalizeBarcode(barcode);
  requireMembership(businessId, userId);
  const product = db.prepare(`
    SELECT p.id, p.name, p.brand,
      COALESCE(p.barcode, (SELECT pb.barcode FROM product_barcodes pb WHERE pb.global_product_id = p.global_catalogue_id AND pb.verification_status = 'verified' ORDER BY pb.id LIMIT 1)) AS barcode,
      'verified' AS barcode_status,
      p.sku, p.category, p.description, p.packaging_size, p.price_cents, p.cost_cents, p.cost_is_known,
      p.is_active, i.quantity_on_hand, i.reorder_level
    FROM products p JOIN inventory i ON i.product_id = p.id AND i.business_id = p.business_id
    WHERE p.business_id = ? AND (
      (p.barcode = ? AND p.barcode_status = 'verified') OR EXISTS (
        SELECT 1 FROM product_barcodes pb WHERE pb.global_product_id = p.global_catalogue_id
          AND pb.barcode = ? AND pb.verification_status = 'verified'
      )
    )
  `).get(businessId, normalized.barcode, normalized.barcode);
  if (!product) throw new Error('BARCODE_NOT_FOUND');
  if (!product.is_active) throw new Error('PRODUCT_UNAVAILABLE');
  return product;
}

function searchGlobalCatalogue({ userId, businessId, query = '' }) {
  requireMembership(businessId, userId);
  const value = String(query).trim().slice(0, 100);
  if (!value) return [];
  const rows = db.prepare(`
    SELECT g.id, g.product_name, g.brand, g.packaging_size, g.category, g.description,
      g.verification_status, g.data_source, b.barcode, b.barcode_format,
      b.verification_status AS barcode_verification_status
    FROM global_product_catalogue g
    LEFT JOIN product_barcodes b ON b.global_product_id = g.id AND b.verification_status = 'verified'
    WHERE g.product_name LIKE ? ESCAPE '\\' OR COALESCE(g.brand, '') LIKE ? ESCAPE '\\'
      OR COALESCE(g.category, '') LIKE ? ESCAPE '\\'
    ORDER BY CASE WHEN g.verification_status = 'verified' THEN 0 ELSE 1 END, g.brand, g.product_name
    LIMIT 50
  `).all(`%${escapeLike(value)}%`, `%${escapeLike(value)}%`, `%${escapeLike(value)}%`);
  return rows;
}

function listAdminCatalogue({ query = '' } = {}) {
  const value = String(query).trim().slice(0, 100);
  return db.prepare(`
    SELECT g.id, g.product_name, g.brand, g.packaging_size, g.category, g.description,
      g.verification_status, g.data_source, g.date_added, g.verified_at,
      b.id AS barcode_record_id, b.barcode, b.barcode_format,
      b.verification_status AS barcode_verification_status, b.data_source AS barcode_source,
      b.date_added AS barcode_date_added, b.verified_at AS barcode_verified_at
    FROM global_product_catalogue g
    LEFT JOIN product_barcodes b ON b.global_product_id = g.id
    WHERE (? = '' OR g.product_name LIKE ? ESCAPE '\\' OR COALESCE(g.brand, '') LIKE ? ESCAPE '\\'
      OR COALESCE(g.category, '') LIKE ? ESCAPE '\\' OR COALESCE(b.barcode, '') = ?)
    ORDER BY g.brand, g.product_name, b.id
    LIMIT 200
  `).all(value, `%${escapeLike(value)}%`, `%${escapeLike(value)}%`, `%${escapeLike(value)}%`, value);
}

function importGlobalProduct({ businessId, userId, catalogueId, pricing = {} }) {
  requireMembership(businessId, userId);
  const global = db.prepare('SELECT * FROM global_product_catalogue WHERE id = ?').get(catalogueId);
  if (!global) throw new Error('CATALOGUE_PRODUCT_NOT_FOUND');
  const barcode = db.prepare(`
    SELECT barcode FROM product_barcodes
    WHERE global_product_id = ? AND verification_status = 'verified'
    ORDER BY id LIMIT 1
  `).get(catalogueId)?.barcode || null;
  const name = String(global.product_name || '').trim();
  const priceCents = Number(pricing.price || 0) * 100;
  const costPresent = pricing.cost !== undefined && pricing.cost !== null && pricing.cost !== '';
  const costCents = Number(pricing.cost || 0) * 100;
  const initialStock = Number(pricing.initialStock || 0);
  const reorderLevel = Number(pricing.reorderLevel || 0);
  if (!Number.isSafeInteger(Math.round(priceCents)) || priceCents < 0 || !Number.isSafeInteger(Math.round(costCents)) || costCents < 0 ||
      !Number.isSafeInteger(initialStock) || initialStock < 0 || !Number.isSafeInteger(reorderLevel) || reorderLevel < 0) {
    throw new Error('INVALID_PRODUCT');
  }
  if (barcode && db.prepare('SELECT id FROM products WHERE business_id = ? AND barcode = ?').get(businessId, barcode)) {
    throw new Error('DUPLICATE_BARCODE');
  }

  const now = new Date().toISOString();
  const productId = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO products (business_id, name, brand, barcode, barcode_status, category, description, packaging_size,
        price_cents, cost_cents, cost_is_known, is_active, global_catalogue_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `).run(
      businessId, name, global.brand, barcode, barcode ? 'verified' : 'unverified', global.category,
      global.description, global.packaging_size, Math.round(priceCents), Math.round(costCents), costPresent ? 1 : 0, catalogueId
    );
    const id = Number(result.lastInsertRowid);
    db.prepare('INSERT INTO inventory (business_id, product_id, quantity_on_hand, reorder_level, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(businessId, id, initialStock, reorderLevel, now);
    if (initialStock > 0) {
      db.prepare(`INSERT INTO inventory_movements (business_id, product_id, movement_type, quantity, reference_type, reference_id, notes, created_at)
        VALUES (?, ?, 'opening', ?, 'product', ?, 'Opening stock from catalogue import', ?)`)
        .run(businessId, id, initialStock, id, now);
    }
    return id;
  })();
  return db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
}

function saveGlobalCatalogueEntry({ id, product = {}, dataSource }) {
  const name = String(product.productName || '').trim();
  if (!name || name.length > 180) throw new Error('INVALID_CATALOGUE_PRODUCT');
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
    const result = db.prepare(`
      UPDATE global_product_catalogue
      SET product_name = ?, brand = ?, packaging_size = ?, category = ?, description = ?, data_source = ?,
        verification_status = 'incomplete', verified_at = NULL
      WHERE id = ?
    `).run(...fields, id);
    if (!result.changes) throw new Error('CATALOGUE_PRODUCT_NOT_FOUND');
    db.prepare(`UPDATE product_barcodes SET verification_status = 'unverified', verified_at = NULL WHERE global_product_id = ?`).run(id);
    return db.prepare('SELECT * FROM global_product_catalogue WHERE id = ?').get(id);
  }

  const result = db.prepare(`
    INSERT INTO global_product_catalogue (product_name, brand, packaging_size, category, description, verification_status, data_source)
    VALUES (?, ?, ?, ?, ?, 'incomplete', ?)
  `).run(...fields);
  return db.prepare('SELECT * FROM global_product_catalogue WHERE id = ?').get(result.lastInsertRowid);
}

function addGlobalBarcode({ catalogueId, barcode, dataSource }) {
  const global = db.prepare('SELECT id FROM global_product_catalogue WHERE id = ?').get(catalogueId);
  if (!global) throw new Error('CATALOGUE_PRODUCT_NOT_FOUND');
  const normalized = normalizeBarcode(barcode);
  const source = String(dataSource || '').trim().slice(0, 1000);
  if (!source) throw new Error('SOURCE_REQUIRED');
  const result = db.prepare(`
    INSERT INTO product_barcodes (global_product_id, barcode, barcode_format, data_source, verification_status)
    VALUES (?, ?, ?, ?, 'unverified')
  `).run(catalogueId, normalized.barcode, normalized.format, source);
  return db.prepare('SELECT * FROM product_barcodes WHERE id = ?').get(result.lastInsertRowid);
}

function verifyGlobalBarcode({ barcodeId, sourceUrl }) {
  let url;
  try { url = new URL(sourceUrl); } catch { throw new Error('INVALID_VERIFICATION_SOURCE'); }
  if (url.protocol !== 'https:') throw new Error('INVALID_VERIFICATION_SOURCE');
  const row = db.prepare('SELECT * FROM product_barcodes WHERE id = ?').get(barcodeId);
  if (!row) throw new Error('BARCODE_RECORD_NOT_FOUND');
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare(`UPDATE product_barcodes SET verification_status = 'verified', verified_at = ?, data_source = ? WHERE id = ?`)
      .run(now, url.toString(), barcodeId);
    db.prepare(`UPDATE global_product_catalogue SET verification_status = 'verified', verified_at = ? WHERE id = ?`)
      .run(now, row.global_product_id);
  })();
  return db.prepare('SELECT * FROM product_barcodes WHERE id = ?').get(barcodeId);
}

function parseCsvLine(line) {
  const fields = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && quoted && line[index + 1] === '"') {
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

function importProductsCsv({ businessId, userId, csv }) {
  requireMembership(businessId, userId);
  if (typeof csv !== 'string' || csv.length > 1024 * 1024) throw new Error('INVALID_CSV');
  const lines = csv.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new Error('INVALID_CSV');
  const headers = parseCsvLine(lines.shift()).map((header) => header.trim().toLowerCase().replace(/[_\s-]/g, ''));
  const column = (name) => headers.indexOf(name.toLowerCase().replace(/[_\s-]/g, ''));
  if (column('name') < 0) throw new Error('INVALID_CSV');

  const summary = { imported: 0, duplicates: 0, invalid: 0, incomplete: 0, errors: [] };
  const insert = db.prepare(`
    INSERT INTO products (business_id, name, brand, barcode, barcode_status, sku, category, description, packaging_size,
      unit_of_measure, image_url, price_cents, cost_cents, cost_is_known, is_active)
    VALUES (?, ?, ?, ?, 'unverified', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `);
  const createInventory = db.prepare(`INSERT INTO inventory (business_id, product_id, quantity_on_hand, reorder_level) VALUES (?, ?, ?, ?)`);

  db.transaction(() => {
    for (const [index, line] of lines.entries()) {
      let cells;
      try { cells = parseCsvLine(line); } catch { summary.invalid += 1; summary.errors.push({ row: index + 2, reason: 'Malformed CSV row' }); continue; }
      const get = (name) => column(name) >= 0 ? (cells[column(name)] || '').trim() : '';
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
        summary.errors.push({ row: index + 2, reason: 'Image URL must use HTTPS' });
        continue;
      }
      if (!name || !Number.isFinite(price) || price < 0 || !Number.isFinite(cost) || cost < 0 ||
          !Number.isSafeInteger(Math.round(price * 100)) || !Number.isSafeInteger(Math.round(cost * 100)) ||
          !Number.isSafeInteger(quantity) || quantity < 0 || !Number.isSafeInteger(reorder) || reorder < 0 || !unitOfMeasure || unitOfMeasure.length > 32) {
        summary.invalid += 1;
        summary.errors.push({ row: index + 2, reason: 'Invalid name, price, cost, or stock value' });
        continue;
      }
      if (sku && db.prepare('SELECT id FROM products WHERE business_id = ? AND sku = ?').get(businessId, sku)) {
        summary.duplicates += 1;
        continue;
      }
      if (barcodeValue && db.prepare('SELECT id FROM products WHERE business_id = ? AND barcode = ?').get(businessId, barcodeValue)) {
        summary.duplicates += 1;
        continue;
      }
      let barcode = null;
      if (barcodeValue) {
        try { barcode = normalizeBarcode(barcodeValue).barcode; }
        catch { summary.invalid += 1; summary.errors.push({ row: index + 2, reason: 'Barcode is not a valid EAN-13, EAN-8, or UPC-A check-digit value' }); continue; }
      }
      const result = insert.run(businessId, name, get('brand') || null, barcode, sku, get('category') || null,
        get('description') || null, get('packagingsize') || null, unitOfMeasure, imageUrl,
        Math.round(price * 100), Math.round(cost * 100), costText ? 1 : 0);
      const productId = Number(result.lastInsertRowid);
      createInventory.run(businessId, productId, quantity, reorder);
      if (quantity > 0) {
        db.prepare(`INSERT INTO inventory_movements (business_id, product_id, movement_type, quantity, reference_type, reference_id, notes, created_at)
          VALUES (?, ?, 'opening', ?, 'product', ?, 'Opening stock from CSV import', ?)`)
          .run(businessId, productId, quantity, productId, new Date().toISOString());
      }
      summary.imported += 1;
      summary.incomplete += 1;
    }
  })();
  return summary;
}

function exportProductsCsv({ businessId, userId }) {
  requireMembership(businessId, userId);
  const rows = db.prepare(`
    SELECT p.name, p.brand,
      COALESCE(p.barcode, (SELECT pb.barcode FROM product_barcodes pb WHERE pb.global_product_id = p.global_catalogue_id AND pb.verification_status = 'verified' ORDER BY pb.id LIMIT 1)) AS barcode,
      CASE WHEN p.barcode_status = 'verified' OR EXISTS (SELECT 1 FROM product_barcodes pb WHERE pb.global_product_id = p.global_catalogue_id AND pb.verification_status = 'verified') THEN 'verified' ELSE 'unverified' END AS barcode_status,
      p.sku, p.category, p.description, p.packaging_size, p.unit_of_measure, p.image_url,
      p.price_cents, p.cost_cents, p.cost_is_known, i.quantity_on_hand, i.reorder_level
    FROM products p JOIN inventory i ON i.product_id = p.id AND i.business_id = p.business_id
    WHERE p.business_id = ? ORDER BY p.name
  `).all(businessId);
  const header = ['name', 'brand', 'barcode', 'barcode_status', 'sku', 'category', 'description', 'packaging_size', 'unit_of_measure', 'image_url', 'price', 'cost', 'cost_is_known', 'initialStock', 'reorderLevel'];
  const quote = (value) => {
    let text = String(value ?? '');
    if (/^[=+@\-\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  return [header, ...rows.map((row) => [row.name, row.brand, row.barcode, row.barcode_status, row.sku, row.category, row.description,
    row.packaging_size, row.unit_of_measure, row.image_url, (row.price_cents / 100).toFixed(2), row.cost_is_known ? (row.cost_cents / 100).toFixed(2) : '',
    row.cost_is_known, row.quantity_on_hand, row.reorder_level])].map((line) => line.map(quote).join(',')).join('\r\n');
}

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
