const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('./database');
const { normalizeBarcode } = require('./barcodes');

function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}

function verifyPassword(password, hash) {
  return bcrypt.compareSync(password, hash);
}

function createSession(userId, businessId) {
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 12).toISOString();

  db.prepare(
    `INSERT INTO sessions (id, user_id, business_id, expires_at) VALUES (?, ?, ?, ?)`
  ).run(sessionId, userId, businessId ?? null, expiresAt);

  return { sessionId, expiresAt };
}

function getUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
}

function getUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function getBusinessById(id) {
  return db.prepare('SELECT * FROM businesses WHERE id = ?').get(id);
}

function createUser({ firstName, lastName, email, password }) {
  const existing = getUserByEmail(email);
  if (existing) {
    throw new Error('USER_EXISTS');
  }

  const insert = db.prepare(`
    INSERT INTO users (first_name, last_name, email, password_hash)
    VALUES (?, ?, ?, ?)
  `);

  const result = insert.run(firstName, lastName, email.toLowerCase(), hashPassword(password));
  return getUserById(result.lastInsertRowid);
}

function createBusiness({ userId, name, businessType, currency, timezone }) {
  const insert = db.prepare(`
    INSERT INTO businesses (owner_user_id, name, business_type, currency, timezone)
    VALUES (?, ?, ?, ?, ?)
  `);

  const result = insert.run(userId, name, businessType, currency || 'ZAR', timezone || 'Africa/Johannesburg');
  const businessId = result.lastInsertRowid;

  db.prepare(`
    INSERT INTO business_memberships (user_id, business_id, role)
    VALUES (?, ?, 'admin')
  `).run(userId, businessId);

  db.prepare(`
    INSERT INTO business_settings (business_id, operating_hours, contact_email)
    VALUES (?, ?, ?)
  `).run(businessId, '09:00-17:00', null);

  return getBusinessById(businessId);
}

function updateBusinessSettings({ businessId, userId, payload }) {
  const membership = db.prepare(`
    SELECT * FROM business_memberships WHERE business_id = ? AND user_id = ?
  `).get(businessId, userId);

  if (!membership) {
    throw new Error('FORBIDDEN');
  }

  const settings = db.prepare(`
    SELECT * FROM business_settings WHERE business_id = ?
  `).get(businessId);

  if (!settings) {
    db.prepare(`
      INSERT INTO business_settings (business_id, operating_hours, contact_email, phone, address)
      VALUES (?, ?, ?, ?, ?)
    `).run(businessId, payload.operatingHours || null, payload.contactEmail || null, payload.phone || null, payload.address || null);
    return db.prepare(`SELECT * FROM business_settings WHERE business_id = ?`).get(businessId);
  }

  db.prepare(`
    UPDATE business_settings
    SET operating_hours = ?, contact_email = ?, phone = ?, address = ?, updated_at = CURRENT_TIMESTAMP
    WHERE business_id = ?
  `).run(
    payload.operatingHours ?? settings.operating_hours,
    payload.contactEmail ?? settings.contact_email,
    payload.phone ?? settings.phone,
    payload.address ?? settings.address,
    businessId
  );

  return db.prepare(`SELECT * FROM business_settings WHERE business_id = ?`).get(businessId);
}

function getBusinessMembershipsForUser(userId) {
  return db.prepare(`
    SELECT bm.*, b.name as business_name, b.business_type, b.currency, b.timezone
    FROM business_memberships bm
    JOIN businesses b ON b.id = bm.business_id
    WHERE bm.user_id = ?
    ORDER BY b.name ASC
  `).all(userId);
}

function getCurrentBusinessForUser(userId, businessId) {
  return db.prepare(`
    SELECT b.*
    FROM businesses b
    JOIN business_memberships bm ON bm.business_id = b.id
    WHERE bm.user_id = ? AND b.id = ?
  `).get(userId, businessId);
}

function createProduct({ businessId, userId, payload = {} }) {
  const membership = db.prepare(`
    SELECT * FROM business_memberships WHERE business_id = ? AND user_id = ?
  `).get(businessId, userId);

  if (!membership) {
    throw new Error('FORBIDDEN');
  }

  const sanitizedName = String(payload.name || '').trim();
  const sanitizedSku = String(payload.sku || '').trim();
  const priceCents = Number(payload.price || 0) * 100;
  const costKnown = payload.cost !== undefined && payload.cost !== null && payload.cost !== '';
  const costCents = Number(payload.cost || 0) * 100;
  const initialStock = Number(payload.initialStock || 0);
  const reorderLevel = Number(payload.reorderLevel || 0);
  const unitOfMeasure = String(payload.unitOfMeasure || 'unit').trim();
  const imageUrl = normalizeImageUrl(payload.imageUrl || '');
  let barcode = null;
  if (payload.barcode) {
    try { barcode = normalizeBarcode(payload.barcode).barcode; }
    catch { throw new Error('INVALID_BARCODE'); }
  }

    if (!sanitizedName || sanitizedName.length > 180 || !Number.isFinite(priceCents) || priceCents < 0 || !Number.isSafeInteger(Math.round(priceCents)) ||
      !Number.isFinite(costCents) || costCents < 0 || !Number.isSafeInteger(Math.round(costCents)) ||
      !Number.isSafeInteger(initialStock) || initialStock < 0 || !Number.isSafeInteger(reorderLevel) || reorderLevel < 0 ||
      !unitOfMeasure || unitOfMeasure.length > 32 || (imageUrl && imageUrl.length > 1000)) {
    throw new Error('INVALID_PRODUCT');
  }

  const result = db.transaction(() => {
    const insert = db.prepare(`
      INSERT INTO products (business_id, name, brand, barcode, barcode_status, description, packaging_size, unit_of_measure, image_url, sku, category, price_cents, cost_cents, is_active, cost_is_known)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const productResult = insert.run(
      businessId,
      sanitizedName,
      String(payload.brand || '').trim() || null,
      barcode,
      'unverified',
      String(payload.description || '').trim() || null,
      String(payload.packagingSize || '').trim() || null,
      String(payload.unitOfMeasure || 'unit').trim(),
      imageUrl,
      sanitizedSku || null,
      payload.category || null,
      Number.isFinite(priceCents) ? Math.round(priceCents) : 0,
      Number.isFinite(costCents) ? Math.round(costCents) : 0,
      payload.isActive === false ? 0 : 1,
      costKnown ? 1 : 0
    );
    const productId = Number(productResult.lastInsertRowid);
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO inventory (business_id, product_id, quantity_on_hand, reorder_level, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(businessId, productId, initialStock, reorderLevel, now);

    if (initialStock > 0) {
      db.prepare(`
        INSERT INTO inventory_movements (business_id, product_id, movement_type, quantity, reference_type, reference_id, notes, created_at)
        VALUES (?, ?, 'opening', ?, 'product', ?, 'Opening stock', ?)
      `).run(businessId, productId, initialStock, productId, now);
    }

    return productId;
  })();

  return getProductById(result);
}

function getProductById(id) {
  return db.prepare(`
    SELECT p.id, p.business_id, p.name, p.brand,
      COALESCE(p.barcode, (SELECT pb.barcode FROM product_barcodes pb WHERE pb.global_product_id = p.global_catalogue_id AND pb.verification_status = 'verified' ORDER BY pb.id LIMIT 1)) AS barcode,
      CASE WHEN p.barcode_status = 'verified' OR EXISTS (SELECT 1 FROM product_barcodes pb WHERE pb.global_product_id = p.global_catalogue_id AND pb.verification_status = 'verified') THEN 'verified' ELSE 'unverified' END AS barcode_status,
      p.description, p.packaging_size, p.unit_of_measure, p.image_url, p.sku, p.category,
      p.price_cents, p.cost_cents, p.cost_is_known, p.is_active, p.created_at, p.updated_at
    FROM products p WHERE p.id = ?
  `).get(id);
}

function getProductForBusiness({ businessId, userId, productId }) {
  const membership = db.prepare('SELECT id FROM business_memberships WHERE business_id = ? AND user_id = ?').get(businessId, userId);
  if (!membership) throw new Error('FORBIDDEN');
  const product = db.prepare(`
    SELECT p.id, p.business_id, p.name, p.brand,
      COALESCE(p.barcode, (SELECT pb.barcode FROM product_barcodes pb WHERE pb.global_product_id = p.global_catalogue_id AND pb.verification_status = 'verified' ORDER BY pb.id LIMIT 1)) AS barcode,
      CASE WHEN p.barcode_status = 'verified' OR EXISTS (SELECT 1 FROM product_barcodes pb WHERE pb.global_product_id = p.global_catalogue_id AND pb.verification_status = 'verified') THEN 'verified' ELSE 'unverified' END AS barcode_status,
      p.description, p.packaging_size, p.unit_of_measure, p.image_url, p.sku, p.category,
      p.price_cents, p.cost_cents, p.cost_is_known, p.is_active, p.created_at, p.updated_at,
      i.quantity_on_hand, i.reorder_level
    FROM products p JOIN inventory i ON i.product_id = p.id AND i.business_id = p.business_id
    WHERE p.id = ? AND p.business_id = ?
  `).get(productId, businessId);
  if (!product) throw new Error('PRODUCT_NOT_FOUND');
  return product;
}

function getProductsForBusiness(businessId) {
  return db.prepare(`
    SELECT p.id, p.business_id, p.name, p.brand,
      COALESCE(p.barcode, (SELECT pb.barcode FROM product_barcodes pb WHERE pb.global_product_id = p.global_catalogue_id AND pb.verification_status = 'verified' ORDER BY pb.id LIMIT 1)) AS barcode,
      CASE WHEN p.barcode_status = 'verified' OR EXISTS (SELECT 1 FROM product_barcodes pb WHERE pb.global_product_id = p.global_catalogue_id AND pb.verification_status = 'verified') THEN 'verified' ELSE 'unverified' END AS barcode_status,
      p.description, p.packaging_size, p.unit_of_measure, p.image_url,
      p.sku, p.category, p.price_cents, p.cost_cents, p.cost_is_known, p.is_active, p.created_at, p.updated_at,
      i.quantity_on_hand, i.reorder_level
    FROM products p JOIN inventory i ON i.product_id = p.id AND i.business_id = p.business_id
    WHERE p.business_id = ? ORDER BY p.created_at DESC
  `).all(businessId);
}

function updateProduct({ businessId, userId, productId, payload = {} }) {
  const membership = db.prepare('SELECT id FROM business_memberships WHERE business_id = ? AND user_id = ?').get(businessId, userId);
  if (!membership) throw new Error('FORBIDDEN');
  if (!Number.isSafeInteger(Number(productId)) || Number(productId) <= 0) throw new Error('PRODUCT_NOT_FOUND');
  const current = db.prepare('SELECT * FROM products WHERE id = ? AND business_id = ?').get(productId, businessId);
  if (!current) throw new Error('PRODUCT_NOT_FOUND');
  const inventory = db.prepare('SELECT quantity_on_hand, reorder_level FROM inventory WHERE business_id = ? AND product_id = ?').get(businessId, productId);
  if (!inventory) throw new Error('PRODUCT_NOT_FOUND');

  const name = payload.name === undefined ? current.name : payload.name === null ? '' : String(payload.name).trim();
  const nameLength = name.length;
  const optionalText = (value) => value === null || value === undefined ? null : String(value).trim() || null;
  const brand = payload.brand === undefined ? current.brand : optionalText(payload.brand);
  const sku = payload.sku === undefined ? current.sku : optionalText(payload.sku);
  const category = payload.category === undefined ? current.category : optionalText(payload.category);
  const description = payload.description === undefined ? current.description : optionalText(payload.description);
  const packagingSize = payload.packagingSize === undefined ? current.packaging_size : optionalText(payload.packagingSize);
  const unitOfMeasure = payload.unitOfMeasure === undefined ? current.unit_of_measure : payload.unitOfMeasure === null ? '' : String(payload.unitOfMeasure).trim();
  const imageUrl = payload.imageUrl === undefined ? current.image_url : normalizeImageUrl(payload.imageUrl);

  const effectiveBarcode = current.barcode || db.prepare(`
    SELECT barcode FROM product_barcodes WHERE global_product_id = ? AND verification_status = 'verified' ORDER BY id LIMIT 1
  `).get(current.global_catalogue_id)?.barcode || null;
  let barcode = current.barcode;
  let barcodeStatus = current.barcode_status;
  let globalCatalogueId = current.global_catalogue_id;
  if (payload.barcode !== undefined) {
    const submittedBarcode = payload.barcode ? normalizeBusinessBarcode(payload.barcode) : null;
    if (submittedBarcode !== effectiveBarcode) {
      barcode = submittedBarcode;
      barcodeStatus = 'unverified';
      globalCatalogueId = null;
    }
  }
  if (payload.price !== undefined && (payload.price === null || String(payload.price).trim() === '')) throw new Error('INVALID_PRODUCT');
  if (payload.quantityOnHand !== undefined && (payload.quantityOnHand === null || String(payload.quantityOnHand).trim() === '')) throw new Error('INVALID_PRODUCT');
  if (payload.reorderLevel !== undefined && (payload.reorderLevel === null || String(payload.reorderLevel).trim() === '')) throw new Error('INVALID_PRODUCT');
  const priceCents = payload.price === undefined ? current.price_cents : Number(payload.price) * 100;
  const costPresent = payload.cost === undefined ? Boolean(current.cost_is_known) : payload.cost !== null && payload.cost !== '';
  const costCents = payload.cost === undefined ? current.cost_cents : Number(payload.cost || 0) * 100;
  const quantityOnHand = payload.quantityOnHand === undefined ? inventory.quantity_on_hand : Number(payload.quantityOnHand);
  const reorderLevel = payload.reorderLevel === undefined ? inventory.reorder_level : Number(payload.reorderLevel);
  const activeInput = payload.isActive;
  if (activeInput !== undefined && ![true, false, 0, 1, '0', '1', 'true', 'false'].includes(activeInput)) throw new Error('INVALID_PRODUCT');
  const isActive = activeInput === undefined ? current.is_active : [true, 1, '1', 'true'].includes(activeInput) ? 1 : 0;
  if (!name || nameLength > 180 || !Number.isSafeInteger(Math.round(priceCents)) || priceCents < 0 ||
      !Number.isSafeInteger(Math.round(costCents)) || costCents < 0 ||
      !Number.isSafeInteger(quantityOnHand) || quantityOnHand < 0 ||
      !Number.isSafeInteger(reorderLevel) || reorderLevel < 0 ||
      !unitOfMeasure || unitOfMeasure.length > 32 ||
      (brand && brand.length > 120) || (sku && sku.length > 80) || (category && category.length > 120) ||
      (description && description.length > 2000) || (packagingSize && packagingSize.length > 120) || (imageUrl && imageUrl.length > 1000)) {
    throw new Error('INVALID_PRODUCT');
  }

  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare(`
      UPDATE products SET name = ?, brand = ?, sku = ?, category = ?, description = ?, packaging_size = ?,
        unit_of_measure = ?, image_url = ?, barcode = ?, barcode_status = ?, global_catalogue_id = ?,
        price_cents = ?, cost_cents = ?, cost_is_known = ?, is_active = ?, updated_at = ?
      WHERE id = ? AND business_id = ?
    `).run(name, brand, sku, category, description, packagingSize, unitOfMeasure, imageUrl, barcode, barcodeStatus,
      globalCatalogueId, Math.round(priceCents), Math.round(costCents), costPresent ? 1 : 0, isActive, now, productId, businessId);

    const stockDelta = quantityOnHand - inventory.quantity_on_hand;
    db.prepare(`UPDATE inventory SET quantity_on_hand = ?, reorder_level = ?, updated_at = ? WHERE business_id = ? AND product_id = ?`)
      .run(quantityOnHand, reorderLevel, now, businessId, productId);
    if (stockDelta !== 0) {
      db.prepare(`
        INSERT INTO inventory_movements (business_id, product_id, movement_type, quantity, reference_type, reference_id, notes, created_at)
        VALUES (?, ?, ?, ?, 'product_edit', ?, ?, ?)
      `).run(businessId, productId, stockDelta > 0 ? 'receipt' : 'adjustment', stockDelta, productId,
        String(payload.stockAdjustmentReason || 'Product edit stock change').trim().slice(0, 250), now);
    }
  })();
  return getProductForBusiness({ businessId, userId, productId });
}

function normalizeBusinessBarcode(value) {
  return normalizeBarcode(value).barcode;
}

function normalizeImageUrl(value) {
  const imageUrl = String(value || '').trim();
  if (!imageUrl) return null;
  let parsedImageUrl;
  try { parsedImageUrl = new URL(imageUrl); } catch { throw new Error('INVALID_IMAGE_URL'); }
  if (parsedImageUrl.protocol !== 'https:' || !parsedImageUrl.hostname || imageUrl.length > 1000) throw new Error('INVALID_IMAGE_URL');
  return imageUrl;
}

function createCustomer({ businessId, userId, payload = {} }) {
  const membership = db.prepare(`
    SELECT * FROM business_memberships WHERE business_id = ? AND user_id = ?
  `).get(businessId, userId);

  if (!membership) {
    throw new Error('FORBIDDEN');
  }

  const name = String(payload.name || '').trim();
  if (!name) {
    throw new Error('INVALID_CUSTOMER');
  }

  const email = payload.email ? String(payload.email).trim().toLowerCase() : null;
  const phone = payload.phone ? String(payload.phone).trim() : null;

  const insert = db.prepare(`
    INSERT INTO customers (business_id, name, email, phone, loyalty_points)
    VALUES (?, ?, ?, ?, ?)
  `);

  const result = insert.run(businessId, name, email, phone, Number(payload.loyaltyPoints || 0));
  return getCustomerById(result.lastInsertRowid);
}

function getCustomerById(id) {
  return db.prepare(`
    SELECT id, business_id, name, email, phone, loyalty_points, created_at, updated_at
    FROM customers WHERE id = ?
  `).get(id);
}

function getCustomersForBusiness(businessId) {
  return db.prepare(`
    SELECT id, business_id, name, email, phone, loyalty_points, created_at, updated_at
    FROM customers
    WHERE business_id = ?
    ORDER BY created_at DESC
  `).all(businessId);
}

function getSettingsForBusiness(businessId) {
  return db.prepare('SELECT * FROM business_settings WHERE business_id = ?').get(businessId) || null;
}

function getInventoryForBusiness(businessId) {
  return db.prepare(`
    SELECT i.product_id, p.name AS product_name, p.sku, i.quantity_on_hand, i.reorder_level, i.updated_at
    FROM inventory i
    JOIN products p ON p.id = i.product_id AND p.business_id = i.business_id
    WHERE i.business_id = ?
    ORDER BY p.name ASC
  `).all(businessId);
}

function createSale({ businessId, userId, payload = {}, idempotencyKey }) {
  const membership = db.prepare('SELECT id FROM business_memberships WHERE business_id = ? AND user_id = ?').get(businessId, userId);
  if (!membership) throw new Error('FORBIDDEN');

  if (idempotencyKey) {
    const existing = db.prepare('SELECT * FROM sales WHERE business_id = ? AND idempotency_key = ?').get(businessId, idempotencyKey);
    if (existing) return { sale: existing, replayed: true };
  }

  if (!Array.isArray(payload.items) || payload.items.length === 0) throw new Error('INVALID_SALE');
  if (payload.items.length > 100) throw new Error('INVALID_SALE');

  const customerId = payload.customerId ? Number(payload.customerId) : null;
  if (customerId && !db.prepare('SELECT id FROM customers WHERE id = ? AND business_id = ?').get(customerId, businessId)) {
    throw new Error('INVALID_CUSTOMER');
  }

  const items = payload.items.map((item) => {
    const productId = Number(item.productId);
    const quantity = Number(item.quantity);
    if (!Number.isSafeInteger(productId) || !Number.isSafeInteger(quantity) || quantity <= 0) throw new Error('INVALID_SALE');

    const product = db.prepare(`
      SELECT p.id, p.business_id, p.name, p.category, p.price_cents, p.cost_cents, p.cost_is_known,
        i.quantity_on_hand
      FROM products p JOIN inventory i ON i.product_id = p.id AND i.business_id = p.business_id
      WHERE p.id = ? AND p.business_id = ? AND p.is_active = 1
    `).get(productId, businessId);
    if (!product) throw new Error('INVALID_PRODUCT');
    if (product.quantity_on_hand < quantity) throw new Error('INSUFFICIENT_STOCK');

    return {
      product,
      quantity,
      lineTotalCents: product.price_cents * quantity,
      unitCostCents: product.cost_is_known ? product.cost_cents : null,
    };
  });

  const subtotalCents = items.reduce((sum, item) => sum + item.lineTotalCents, 0);
  if (!items.every((item) => Number.isSafeInteger(item.lineTotalCents)) || !Number.isSafeInteger(subtotalCents)) {
    throw new Error('INVALID_SALE');
  }
  const now = new Date().toISOString();
  const reference = `WOS-${crypto.randomUUID()}`;

  try {
    const saleId = db.transaction(() => {
      const result = db.prepare(`
        INSERT INTO sales (business_id, customer_id, transaction_reference, idempotency_key, subtotal_cents, discount_cents, tax_cents, total_cents, payment_method, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, 'completed', ?, ?)
      `).run(businessId, customerId, reference, idempotencyKey || null, subtotalCents, subtotalCents, payload.paymentMethod || null, now, now);
      const saleId = Number(result.lastInsertRowid);

      const insertItem = db.prepare(`
        INSERT INTO sale_items (sale_id, product_id, product_name_snapshot, product_category_snapshot, quantity, unit_price_cents, unit_cost_cents, line_total_cents)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const updateStock = db.prepare(`
        UPDATE inventory SET quantity_on_hand = quantity_on_hand - ?, updated_at = ?
        WHERE business_id = ? AND product_id = ? AND quantity_on_hand >= ?
      `);
      const insertMovement = db.prepare(`
        INSERT INTO inventory_movements (business_id, product_id, movement_type, quantity, reference_type, reference_id, notes, created_at)
        VALUES (?, ?, 'sale', ?, 'sale', ?, 'Stock sold', ?)
      `);

      for (const item of items) {
        insertItem.run(saleId, item.product.id, item.product.name, item.product.category, item.quantity, item.product.price_cents, item.unitCostCents, item.lineTotalCents);
        const stockUpdate = updateStock.run(item.quantity, now, businessId, item.product.id, item.quantity);
        if (stockUpdate.changes !== 1) throw new Error('INSUFFICIENT_STOCK');
        insertMovement.run(businessId, item.product.id, -item.quantity, saleId, now);
      }

      return saleId;
    })();
    return { sale: db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId), replayed: false };
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE' && idempotencyKey) {
      const existing = db.prepare('SELECT * FROM sales WHERE business_id = ? AND idempotency_key = ?').get(businessId, idempotencyKey);
      if (existing) return { sale: existing, replayed: true };
    }
    throw error;
  }
}

function refundSale({ businessId, saleId }) {
  const sale = db.prepare('SELECT * FROM sales WHERE id = ? AND business_id = ?').get(saleId, businessId);
  if (!sale) throw new Error('SALE_NOT_FOUND');
  if (sale.status !== 'completed') throw new Error('SALE_NOT_REFUNDABLE');

  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare("UPDATE sales SET status = 'refunded', updated_at = ? WHERE id = ? AND business_id = ? AND status = 'completed'").run(now, saleId, businessId);
    const items = db.prepare('SELECT product_id, quantity FROM sale_items WHERE sale_id = ?').all(saleId);
    for (const item of items) {
      db.prepare('UPDATE inventory SET quantity_on_hand = quantity_on_hand + ?, updated_at = ? WHERE business_id = ? AND product_id = ?').run(item.quantity, now, businessId, item.product_id);
      db.prepare(`
        INSERT INTO inventory_movements (business_id, product_id, movement_type, quantity, reference_type, reference_id, notes, created_at)
        VALUES (?, ?, 'refund', ?, 'sale', ?, 'Refund stock reversal', ?)
      `).run(businessId, item.product_id, item.quantity, saleId, now);
    }
  })();

  return db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId);
}

function adjustInventory({ businessId, userId, productId, quantity, reorderLevel, notes }) {
  const membership = db.prepare('SELECT id FROM business_memberships WHERE business_id = ? AND user_id = ?').get(businessId, userId);
  if (!membership) throw new Error('FORBIDDEN');
  if (!Number.isSafeInteger(quantity) || quantity === 0 || (reorderLevel !== undefined && (!Number.isSafeInteger(reorderLevel) || reorderLevel < 0))) {
    throw new Error('INVALID_ADJUSTMENT');
  }

  const now = new Date().toISOString();
  return db.transaction(() => {
    const inventoryRow = db.prepare(`
      SELECT i.quantity_on_hand FROM inventory i
      JOIN products p ON p.id = i.product_id AND p.business_id = i.business_id
      WHERE i.business_id = ? AND i.product_id = ?
    `).get(businessId, productId);
    if (!inventoryRow) throw new Error('INVALID_PRODUCT');
    if (inventoryRow.quantity_on_hand + quantity < 0) throw new Error('INSUFFICIENT_STOCK');

    db.prepare(`
      UPDATE inventory SET quantity_on_hand = quantity_on_hand + ?,
        reorder_level = COALESCE(?, reorder_level), updated_at = ?
      WHERE business_id = ? AND product_id = ?
    `).run(quantity, reorderLevel === undefined ? null : reorderLevel, now, businessId, productId);
    db.prepare(`
      INSERT INTO inventory_movements (business_id, product_id, movement_type, quantity, reference_type, reference_id, notes, created_at)
      VALUES (?, ?, ?, ?, 'adjustment', NULL, ?, ?)
    `).run(businessId, productId, quantity > 0 ? 'receipt' : 'adjustment', quantity, String(notes || '').slice(0, 250) || null, now);

    return db.prepare('SELECT * FROM inventory WHERE business_id = ? AND product_id = ?').get(businessId, productId);
  })();
}

module.exports = {
  hashPassword,
  verifyPassword,
  createSession,
  getUserByEmail,
  getUserById,
  getBusinessById,
  createUser,
  createBusiness,
  updateBusinessSettings,
  getBusinessMembershipsForUser,
  getCurrentBusinessForUser,
  createProduct,
  getProductsForBusiness,
  getProductForBusiness,
  updateProduct,
  createCustomer,
  getCustomersForBusiness,
  getSettingsForBusiness,
  getInventoryForBusiness,
  createSale,
  refundSale,
  adjustInventory,
};
