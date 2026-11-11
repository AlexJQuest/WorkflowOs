const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('./database');
const { normalizeBarcode } = require('./barcodes');
// -----------------------------------------------------------------------------
// DATABASE HELPERS
// -----------------------------------------------------------------------------

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
      console.error('Transaction rollback failed:', rollbackError.message);
    }

    throw error;
  } finally {
    connection.release();
  }
}

function isDuplicateEntry(error) {
  return error?.code === 'ER_DUP_ENTRY' || error?.errno === 1062;
}

// -----------------------------------------------------------------------------
// AUTHENTICATION AND USERS
// -----------------------------------------------------------------------------

function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}

function verifyPassword(password, hash) {
  return bcrypt.compareSync(password, hash);
}

async function createSession(userId, businessId) {
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 12);

  await execute(
    `INSERT INTO sessions (id, user_id, business_id, expires_at)
     VALUES (?, ?, ?, ?)`,
    [sessionId, userId, businessId ?? null, expiresAt]
  );

  return { sessionId, expiresAt };
}

async function getUserByEmail(email) {
  return getOne(
    'SELECT * FROM users WHERE email = ?',
    [String(email).trim().toLowerCase()]
  );
}

async function getUserById(id) {
  return getOne('SELECT * FROM users WHERE id = ?', [id]);
}

async function getBusinessById(id) {
  return getOne('SELECT * FROM businesses WHERE id = ?', [id]);
}

async function createUser({ firstName, lastName, email, password }) {
  const normalizedEmail = String(email).trim().toLowerCase();

  const existing = await getUserByEmail(normalizedEmail);

  if (existing) {
    throw new Error('USER_EXISTS');
  }

  try {
    const result = await execute(
      `INSERT INTO users (first_name, last_name, email, password_hash)
       VALUES (?, ?, ?, ?)`,
      [
        firstName,
        lastName,
        normalizedEmail,
        hashPassword(password),
      ]
    );

    return await getUserById(result.insertId);
  } catch (error) {
    if (isDuplicateEntry(error)) {
      throw new Error('USER_EXISTS');
    }

    throw error;
  }
}

async function createBusiness({
  userId,
  name,
  businessType,
  currency,
  timezone,
}) {
  const businessId = await withTransaction(async (connection) => {
    const result = await execute(
      `INSERT INTO businesses
       (owner_user_id, name, business_type, currency, timezone)
       VALUES (?, ?, ?, ?, ?)`,
      [
        userId,
        name,
        businessType,
        currency || 'ZAR',
        timezone || 'Africa/Johannesburg',
      ],
      connection
    );

    const id = result.insertId;

    await execute(
      `INSERT INTO business_memberships (user_id, business_id, role)
       VALUES (?, ?, 'admin')`,
      [userId, id],
      connection
    );

    await execute(
      `INSERT INTO business_settings
       (business_id, operating_hours, contact_email)
       VALUES (?, ?, ?)`,
      [id, '09:00-17:00', null],
      connection
    );

    return id;
  });

  return getBusinessById(businessId);
}

// -----------------------------------------------------------------------------
// BUSINESS SETTINGS AND MEMBERSHIPS
// -----------------------------------------------------------------------------

async function updateBusinessSettings({
  businessId,
  userId,
  payload = {},
}) {
  const membership = await getOne(
    `SELECT id FROM business_memberships
     WHERE business_id = ? AND user_id = ?`,
    [businessId, userId]
  );

  if (!membership) {
    throw new Error('FORBIDDEN');
  }

  await withTransaction(async (connection) => {
    const settings = await getOne(
      `SELECT * FROM business_settings
       WHERE business_id = ?
       FOR UPDATE`,
      [businessId],
      connection
    );

    if (!settings) {
      await execute(
        `INSERT INTO business_settings
         (business_id, operating_hours, contact_email, phone, address)
         VALUES (?, ?, ?, ?, ?)`,
        [
          businessId,
          payload.operatingHours || null,
          payload.contactEmail || null,
          payload.phone || null,
          payload.address || null,
        ],
        connection
      );

      return;
    }

    await execute(
      `UPDATE business_settings
       SET operating_hours = ?,
           contact_email = ?,
           phone = ?,
           address = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE business_id = ?`,
      [
        payload.operatingHours ?? settings.operating_hours,
        payload.contactEmail ?? settings.contact_email,
        payload.phone ?? settings.phone,
        payload.address ?? settings.address,
        businessId,
      ],
      connection
    );
  });

  return getOne(
    'SELECT * FROM business_settings WHERE business_id = ?',
    [businessId]
  );
}

async function getBusinessMembershipsForUser(userId) {
  return getMany(
    `SELECT
       bm.*,
       b.name AS business_name,
       b.business_type,
       b.currency,
       b.timezone
     FROM business_memberships bm
     JOIN businesses b ON b.id = bm.business_id
     WHERE bm.user_id = ?
     ORDER BY b.name ASC`,
    [userId]
  );
}

async function getCurrentBusinessForUser(userId, businessId) {
  return getOne(
    `SELECT b.*
     FROM businesses b
     JOIN business_memberships bm ON bm.business_id = b.id
     WHERE bm.user_id = ? AND b.id = ?`,
    [userId, businessId]
  );
}

// -----------------------------------------------------------------------------
// PRODUCT HELPERS
// -----------------------------------------------------------------------------

function normalizeBusinessBarcode(value) {
  return normalizeBarcode(value).barcode;
}

function normalizeImageUrl(value) {
  const imageUrl = String(value || '').trim();

  if (!imageUrl) {
    return null;
  }

  let parsedImageUrl;

  try {
    parsedImageUrl = new URL(imageUrl);
  } catch {
    throw new Error('INVALID_IMAGE_URL');
  }

  if (
    parsedImageUrl.protocol !== 'https:' ||
    !parsedImageUrl.hostname ||
    imageUrl.length > 1000
  ) {
    throw new Error('INVALID_IMAGE_URL');
  }

  return imageUrl;
}

const PRODUCT_SELECT = `
  SELECT
    p.id,
    p.business_id,
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
    p.description,
    p.packaging_size,
    p.unit_of_measure,
    p.image_url,
    p.sku,
    p.category,
    p.price_cents,
    p.cost_cents,
    p.cost_is_known,
    p.is_active,
    p.created_at,
    p.updated_at
`;

// -----------------------------------------------------------------------------
// PRODUCT QUERIES
// -----------------------------------------------------------------------------

async function getProductById(id) {
  return getOne(
    `${PRODUCT_SELECT}
     FROM products p
     WHERE p.id = ?`,
    [id]
  );
}

async function getProductForBusiness({
  businessId,
  userId,
  productId,
}) {
  const membership = await getOne(
    `SELECT id FROM business_memberships
     WHERE business_id = ? AND user_id = ?`,
    [businessId, userId]
  );

  if (!membership) {
    throw new Error('FORBIDDEN');
  }

  const product = await getOne(
    `${PRODUCT_SELECT},
       i.quantity_on_hand,
       i.reorder_level
     FROM products p
     JOIN inventory i
       ON i.product_id = p.id
       AND i.business_id = p.business_id
     WHERE p.id = ? AND p.business_id = ?`,
    [productId, businessId]
  );

  if (!product) {
    throw new Error('PRODUCT_NOT_FOUND');
  }

  return product;
}

async function getProductsForBusiness(businessId) {
  return getMany(
    `${PRODUCT_SELECT},
       i.quantity_on_hand,
       i.reorder_level
     FROM products p
     JOIN inventory i
       ON i.product_id = p.id
       AND i.business_id = p.business_id
     WHERE p.business_id = ?
     ORDER BY p.created_at DESC`,
    [businessId]
  );
}

// -----------------------------------------------------------------------------
// CREATE PRODUCT
// -----------------------------------------------------------------------------

async function createProduct({
  businessId,
  userId,
  payload = {},
}) {
  const membership = await getOne(
    `SELECT id FROM business_memberships
     WHERE business_id = ? AND user_id = ?`,
    [businessId, userId]
  );

  if (!membership) {
    throw new Error('FORBIDDEN');
  }

  const sanitizedName = String(payload.name || '').trim();
  const sanitizedSku = String(payload.sku || '').trim();

  const priceCents = Number(payload.price || 0) * 100;

  const costKnown =
    payload.cost !== undefined &&
    payload.cost !== null &&
    payload.cost !== '';

  const costCents = Number(payload.cost || 0) * 100;

  const initialStock = Number(payload.initialStock || 0);
  const reorderLevel = Number(payload.reorderLevel || 0);

  const unitOfMeasure = String(
    payload.unitOfMeasure || 'unit'
  ).trim();

  const imageUrl = normalizeImageUrl(payload.imageUrl || '');

  let barcode = null;

  if (payload.barcode) {
    try {
      barcode = normalizeBarcode(payload.barcode).barcode;
    } catch {
      throw new Error('INVALID_BARCODE');
    }
  }

  if (
    !sanitizedName ||
    sanitizedName.length > 180 ||
    !Number.isFinite(priceCents) ||
    priceCents < 0 ||
    !Number.isSafeInteger(Math.round(priceCents)) ||
    !Number.isFinite(costCents) ||
    costCents < 0 ||
    !Number.isSafeInteger(Math.round(costCents)) ||
    !Number.isSafeInteger(initialStock) ||
    initialStock < 0 ||
    !Number.isSafeInteger(reorderLevel) ||
    reorderLevel < 0 ||
    !unitOfMeasure ||
    unitOfMeasure.length > 32 ||
    (imageUrl && imageUrl.length > 1000)
  ) {
    throw new Error('INVALID_PRODUCT');
  }

  const productId = await withTransaction(async (connection) => {
    const result = await execute(
      `INSERT INTO products
       (
         business_id,
         name,
         brand,
         barcode,
         barcode_status,
         description,
         packaging_size,
         unit_of_measure,
         image_url,
         sku,
         category,
         price_cents,
         cost_cents,
         is_active,
         cost_is_known
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        businessId,
        sanitizedName,
        String(payload.brand || '').trim() || null,
        barcode,
        'unverified',
        String(payload.description || '').trim() || null,
        String(payload.packagingSize || '').trim() || null,
        unitOfMeasure,
        imageUrl,
        sanitizedSku || null,
        payload.category || null,
        Math.round(priceCents),
        Math.round(costCents),
        payload.isActive === false ? 0 : 1,
        costKnown ? 1 : 0,
      ],
      connection
    );

    const id = result.insertId;
    const now = new Date();

    await execute(
      `INSERT INTO inventory
       (business_id, product_id, quantity_on_hand, reorder_level, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [businessId, id, initialStock, reorderLevel, now],
      connection
    );

    if (initialStock > 0) {
      await execute(
        `INSERT INTO inventory_movements
         (
           business_id,
           product_id,
           movement_type,
           quantity,
           reference_type,
           reference_id,
           notes,
           created_at
         )
         VALUES (?, ?, 'opening', ?, 'product', ?, 'Opening stock', ?)`,
        [businessId, id, initialStock, id, now],
        connection
      );
    }

    return id;
  });

  return getProductById(productId);
}

// -----------------------------------------------------------------------------
// UPDATE PRODUCT
// -----------------------------------------------------------------------------

async function updateProduct({
  businessId,
  userId,
  productId,
  payload = {},
}) {
  const membership = await getOne(
    `SELECT id FROM business_memberships
     WHERE business_id = ? AND user_id = ?`,
    [businessId, userId]
  );

  if (!membership) {
    throw new Error('FORBIDDEN');
  }

  if (
    !Number.isSafeInteger(Number(productId)) ||
    Number(productId) <= 0
  ) {
    throw new Error('PRODUCT_NOT_FOUND');
  }

  const current = await getOne(
    `SELECT * FROM products
     WHERE id = ? AND business_id = ?`,
    [productId, businessId]
  );

  if (!current) {
    throw new Error('PRODUCT_NOT_FOUND');
  }

  const inventory = await getOne(
    `SELECT quantity_on_hand, reorder_level
     FROM inventory
     WHERE business_id = ? AND product_id = ?`,
    [businessId, productId]
  );

  if (!inventory) {
    throw new Error('PRODUCT_NOT_FOUND');
  }

  const name =
    payload.name === undefined
      ? current.name
      : payload.name === null
        ? ''
        : String(payload.name).trim();

  const optionalText = (value) =>
    value === null || value === undefined
      ? null
      : String(value).trim() || null;

  const brand =
    payload.brand === undefined
      ? current.brand
      : optionalText(payload.brand);

  const sku =
    payload.sku === undefined
      ? current.sku
      : optionalText(payload.sku);

  const category =
    payload.category === undefined
      ? current.category
      : optionalText(payload.category);

  const description =
    payload.description === undefined
      ? current.description
      : optionalText(payload.description);

  const packagingSize =
    payload.packagingSize === undefined
      ? current.packaging_size
      : optionalText(payload.packagingSize);

  const unitOfMeasure =
    payload.unitOfMeasure === undefined
      ? current.unit_of_measure
      : payload.unitOfMeasure === null
        ? ''
        : String(payload.unitOfMeasure).trim();

  const imageUrl =
    payload.imageUrl === undefined
      ? current.image_url
      : normalizeImageUrl(payload.imageUrl);

  const verifiedBarcode = current.global_catalogue_id
    ? await getOne(
        `SELECT barcode
         FROM product_barcodes
         WHERE global_product_id = ?
           AND verification_status = 'verified'
         ORDER BY id
         LIMIT 1`,
        [current.global_catalogue_id]
      )
    : null;

  const effectiveBarcode =
    current.barcode || verifiedBarcode?.barcode || null;

  let barcode = current.barcode;
  let barcodeStatus = current.barcode_status;
  let globalCatalogueId = current.global_catalogue_id;

  if (payload.barcode !== undefined) {
    const submittedBarcode = payload.barcode
      ? normalizeBusinessBarcode(payload.barcode)
      : null;

    if (submittedBarcode !== effectiveBarcode) {
      barcode = submittedBarcode;
      barcodeStatus = 'unverified';
      globalCatalogueId = null;
    }
  }

  if (
    payload.price !== undefined &&
    (payload.price === null ||
      String(payload.price).trim() === '')
  ) {
    throw new Error('INVALID_PRODUCT');
  }

  if (
    payload.quantityOnHand !== undefined &&
    (payload.quantityOnHand === null ||
      String(payload.quantityOnHand).trim() === '')
  ) {
    throw new Error('INVALID_PRODUCT');
  }

  if (
    payload.reorderLevel !== undefined &&
    (payload.reorderLevel === null ||
      String(payload.reorderLevel).trim() === '')
  ) {
    throw new Error('INVALID_PRODUCT');
  }

  const priceCents =
    payload.price === undefined
      ? Number(current.price_cents)
      : Number(payload.price) * 100;

  const costPresent =
    payload.cost === undefined
      ? Boolean(current.cost_is_known)
      : payload.cost !== null && payload.cost !== '';

  const costCents =
    payload.cost === undefined
      ? Number(current.cost_cents)
      : Number(payload.cost || 0) * 100;

  const quantityOnHand =
    payload.quantityOnHand === undefined
      ? Number(inventory.quantity_on_hand)
      : Number(payload.quantityOnHand);

  const reorderLevel =
    payload.reorderLevel === undefined
      ? Number(inventory.reorder_level)
      : Number(payload.reorderLevel);

  const activeInput = payload.isActive;

  if (
    activeInput !== undefined &&
    ![
      true,
      false,
      0,
      1,
      '0',
      '1',
      'true',
      'false',
    ].includes(activeInput)
  ) {
    throw new Error('INVALID_PRODUCT');
  }

  const isActive =
    activeInput === undefined
      ? current.is_active
      : [true, 1, '1', 'true'].includes(activeInput)
        ? 1
        : 0;

  if (
    !name ||
    name.length > 180 ||
    !Number.isSafeInteger(Math.round(priceCents)) ||
    priceCents < 0 ||
    !Number.isSafeInteger(Math.round(costCents)) ||
    costCents < 0 ||
    !Number.isSafeInteger(quantityOnHand) ||
    quantityOnHand < 0 ||
    !Number.isSafeInteger(reorderLevel) ||
    reorderLevel < 0 ||
    !unitOfMeasure ||
    unitOfMeasure.length > 32 ||
    (brand && brand.length > 120) ||
    (sku && sku.length > 80) ||
    (category && category.length > 120) ||
    (description && description.length > 2000) ||
    (packagingSize && packagingSize.length > 120) ||
    (imageUrl && imageUrl.length > 1000)
  ) {
    throw new Error('INVALID_PRODUCT');
  }

  await withTransaction(async (connection) => {
    const now = new Date();

    await execute(
      `UPDATE products
       SET
         name = ?,
         brand = ?,
         sku = ?,
         category = ?,
         description = ?,
         packaging_size = ?,
         unit_of_measure = ?,
         image_url = ?,
         barcode = ?,
         barcode_status = ?,
         global_catalogue_id = ?,
         price_cents = ?,
         cost_cents = ?,
         cost_is_known = ?,
         is_active = ?,
         updated_at = ?
       WHERE id = ? AND business_id = ?`,
      [
        name,
        brand,
        sku,
        category,
        description,
        packagingSize,
        unitOfMeasure,
        imageUrl,
        barcode,
        barcodeStatus,
        globalCatalogueId,
        Math.round(priceCents),
        Math.round(costCents),
        costPresent ? 1 : 0,
        isActive,
        now,
        productId,
        businessId,
      ],
      connection
    );

    const stockDelta =
      quantityOnHand - Number(inventory.quantity_on_hand);

    await execute(
      `UPDATE inventory
       SET
         quantity_on_hand = ?,
         reorder_level = ?,
         updated_at = ?
       WHERE business_id = ? AND product_id = ?`,
      [
        quantityOnHand,
        reorderLevel,
        now,
        businessId,
        productId,
      ],
      connection
    );

    if (stockDelta !== 0) {
      await execute(
        `INSERT INTO inventory_movements
         (
           business_id,
           product_id,
           movement_type,
           quantity,
           reference_type,
           reference_id,
           notes,
           created_at
         )
         VALUES (?, ?, ?, ?, 'product_edit', ?, ?, ?)`,
        [
          businessId,
          productId,
          stockDelta > 0 ? 'receipt' : 'adjustment',
          stockDelta,
          productId,
          String(
            payload.stockAdjustmentReason ||
              'Product edit stock change'
          )
            .trim()
            .slice(0, 250),
          now,
        ],
        connection
      );
    }
  });

  return getProductForBusiness({
    businessId,
    userId,
    productId,
  });
}

// -----------------------------------------------------------------------------
// CUSTOMERS
// -----------------------------------------------------------------------------

async function createCustomer({
  businessId,
  userId,
  payload = {},
}) {
  const membership = await getOne(
    `SELECT id FROM business_memberships
     WHERE business_id = ? AND user_id = ?`,
    [businessId, userId]
  );

  if (!membership) {
    throw new Error('FORBIDDEN');
  }

  const name = String(payload.name || '').trim();

  if (!name) {
    throw new Error('INVALID_CUSTOMER');
  }

  const email = payload.email
    ? String(payload.email).trim().toLowerCase()
    : null;

  const phone = payload.phone
    ? String(payload.phone).trim()
    : null;

  const loyaltyPoints = Number(payload.loyaltyPoints || 0);

  if (
    !Number.isSafeInteger(loyaltyPoints) ||
    loyaltyPoints < 0
  ) {
    throw new Error('INVALID_CUSTOMER');
  }

  const result = await execute(
    `INSERT INTO customers
     (business_id, name, email, phone, loyalty_points)
     VALUES (?, ?, ?, ?, ?)`,
    [
      businessId,
      name,
      email,
      phone,
      loyaltyPoints,
    ]
  );

  return getCustomerById(result.insertId);
}

async function getCustomerById(id) {
  return getOne(
    `SELECT
       id,
       business_id,
       name,
       email,
       phone,
       loyalty_points,
       created_at,
       updated_at
     FROM customers
     WHERE id = ?`,
    [id]
  );
}

async function getCustomersForBusiness(businessId) {
  return getMany(
    `SELECT
       id,
       business_id,
       name,
       email,
       phone,
       loyalty_points,
       created_at,
       updated_at
     FROM customers
     WHERE business_id = ?
     ORDER BY created_at DESC`,
    [businessId]
  );
}

// -----------------------------------------------------------------------------
// SETTINGS AND INVENTORY
// -----------------------------------------------------------------------------

async function getSettingsForBusiness(businessId) {
  return getOne(
    'SELECT * FROM business_settings WHERE business_id = ?',
    [businessId]
  );
}

async function getInventoryForBusiness(businessId) {
  return getMany(
    `SELECT
       i.product_id,
       p.name AS product_name,
       p.sku,
       i.quantity_on_hand,
       i.reorder_level,
       i.updated_at
     FROM inventory i
     JOIN products p
       ON p.id = i.product_id
       AND p.business_id = i.business_id
     WHERE i.business_id = ?
     ORDER BY p.name ASC`,
    [businessId]
  );
}

// -----------------------------------------------------------------------------
// SALES
// -----------------------------------------------------------------------------

async function createSale({
  businessId,
  userId,
  payload = {},
  idempotencyKey,
}) {
  const membership = await getOne(
    `SELECT id FROM business_memberships
     WHERE business_id = ? AND user_id = ?`,
    [businessId, userId]
  );

  if (!membership) {
    throw new Error('FORBIDDEN');
  }

  if (!Array.isArray(payload.items) || payload.items.length === 0) {
    throw new Error('INVALID_SALE');
  }

  if (payload.items.length > 100) {
    throw new Error('INVALID_SALE');
  }

  try {
    const transactionResult = await withTransaction(async (connection) => {
      if (idempotencyKey) {
        const existing = await getOne(
          `SELECT * FROM sales
           WHERE business_id = ? AND idempotency_key = ?
           FOR UPDATE`,
          [businessId, idempotencyKey],
          connection
        );

        if (existing) {
          return {
            saleId: existing.id,
            replayed: true,
          };
        }
      }

      const customerId = payload.customerId
        ? Number(payload.customerId)
        : null;

      if (
        customerId &&
        !(await getOne(
          `SELECT id FROM customers
           WHERE id = ? AND business_id = ?`,
          [customerId, businessId],
          connection
        ))
      ) {
        throw new Error('INVALID_CUSTOMER');
      }

      const items = [];

      for (const item of payload.items) {
        const productId = Number(item.productId);
        const quantity = Number(item.quantity);

        if (
          !Number.isSafeInteger(productId) ||
          !Number.isSafeInteger(quantity) ||
          quantity <= 0
        ) {
          throw new Error('INVALID_SALE');
        }

        const product = await getOne(
          `SELECT
             p.id,
             p.business_id,
             p.name,
             p.category,
             p.price_cents,
             p.cost_cents,
             p.cost_is_known,
             i.quantity_on_hand
           FROM products p
           JOIN inventory i
             ON i.product_id = p.id
             AND i.business_id = p.business_id
           WHERE p.id = ?
             AND p.business_id = ?
             AND p.is_active = 1
           FOR UPDATE`,
          [productId, businessId],
          connection
        );

        if (!product) {
          throw new Error('INVALID_PRODUCT');
        }

        if (Number(product.quantity_on_hand) < quantity) {
          throw new Error('INSUFFICIENT_STOCK');
        }

        items.push({
          product,
          quantity,
          lineTotalCents:
            Number(product.price_cents) * quantity,
          unitCostCents: product.cost_is_known
            ? Number(product.cost_cents)
            : null,
        });
      }

      const subtotalCents = items.reduce(
        (sum, item) => sum + item.lineTotalCents,
        0
      );

      if (
        !items.every((item) =>
          Number.isSafeInteger(item.lineTotalCents)
        ) ||
        !Number.isSafeInteger(subtotalCents)
      ) {
        throw new Error('INVALID_SALE');
      }

      const now = new Date();
      const reference = `WOS-${crypto.randomUUID()}`;

      const saleResult = await execute(
        `INSERT INTO sales
         (
           business_id,
           customer_id,
           transaction_reference,
           idempotency_key,
           subtotal_cents,
           discount_cents,
           tax_cents,
           total_cents,
           payment_method,
           status,
           created_at,
           updated_at
         )
         VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, 'completed', ?, ?)`,
        [
          businessId,
          customerId,
          reference,
          idempotencyKey || null,
          subtotalCents,
          subtotalCents,
          payload.paymentMethod || null,
          now,
          now,
        ],
        connection
      );

      const saleId = saleResult.insertId;

      for (const item of items) {
        await execute(
          `INSERT INTO sale_items
           (
             sale_id,
             product_id,
             product_name_snapshot,
             product_category_snapshot,
             quantity,
             unit_price_cents,
             unit_cost_cents,
             line_total_cents
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            saleId,
            item.product.id,
            item.product.name,
            item.product.category,
            item.quantity,
            item.product.price_cents,
            item.unitCostCents,
            item.lineTotalCents,
          ],
          connection
        );

        const stockUpdate = await execute(
          `UPDATE inventory
           SET quantity_on_hand = quantity_on_hand - ?,
               updated_at = ?
           WHERE business_id = ?
             AND product_id = ?
             AND quantity_on_hand >= ?`,
          [
            item.quantity,
            now,
            businessId,
            item.product.id,
            item.quantity,
          ],
          connection
        );

        if (stockUpdate.affectedRows !== 1) {
          throw new Error('INSUFFICIENT_STOCK');
        }

        await execute(
          `INSERT INTO inventory_movements
           (
             business_id,
             product_id,
             movement_type,
             quantity,
             reference_type,
             reference_id,
             notes,
             created_at
           )
           VALUES (?, ?, 'sale', ?, 'sale', ?, 'Stock sold', ?)`,
          [
            businessId,
            item.product.id,
            -item.quantity,
            saleId,
            now,
          ],
          connection
        );
      }

      return {
        saleId,
        replayed: false,
      };
    });

    const sale = await getOne(
      'SELECT * FROM sales WHERE id = ?',
      [transactionResult.saleId]
    );

    return {
      sale,
      replayed: transactionResult.replayed,
    };
  } catch (error) {
    if (isDuplicateEntry(error) && idempotencyKey) {
      const existing = await getOne(
        `SELECT * FROM sales
         WHERE business_id = ? AND idempotency_key = ?`,
        [businessId, idempotencyKey]
      );

      if (existing) {
        return {
          sale: existing,
          replayed: true,
        };
      }
    }

    throw error;
  }
}

// -----------------------------------------------------------------------------
// REFUND SALE
// -----------------------------------------------------------------------------

async function refundSale({ businessId, saleId }) {
  await withTransaction(async (connection) => {
    const sale = await getOne(
      `SELECT * FROM sales
       WHERE id = ? AND business_id = ?
       FOR UPDATE`,
      [saleId, businessId],
      connection
    );

    if (!sale) {
      throw new Error('SALE_NOT_FOUND');
    }

    if (sale.status !== 'completed') {
      throw new Error('SALE_NOT_REFUNDABLE');
    }

    const now = new Date();

    const update = await execute(
      `UPDATE sales
       SET status = 'refunded',
           updated_at = ?
       WHERE id = ?
         AND business_id = ?
         AND status = 'completed'`,
      [now, saleId, businessId],
      connection
    );

    if (update.affectedRows !== 1) {
      throw new Error('SALE_NOT_REFUNDABLE');
    }

    const items = await getMany(
      `SELECT product_id, quantity
       FROM sale_items
       WHERE sale_id = ?`,
      [saleId],
      connection
    );

    for (const item of items) {
      await execute(
        `UPDATE inventory
         SET quantity_on_hand = quantity_on_hand + ?,
             updated_at = ?
         WHERE business_id = ?
           AND product_id = ?`,
        [
          item.quantity,
          now,
          businessId,
          item.product_id,
        ],
        connection
      );

      await execute(
        `INSERT INTO inventory_movements
         (
           business_id,
           product_id,
           movement_type,
           quantity,
           reference_type,
           reference_id,
           notes,
           created_at
         )
         VALUES (?, ?, 'refund', ?, 'sale', ?, 'Refund stock reversal', ?)`,
        [
          businessId,
          item.product_id,
          item.quantity,
          saleId,
          now,
        ],
        connection
      );
    }
  });

  return getOne(
    'SELECT * FROM sales WHERE id = ?',
    [saleId]
  );
}

// -----------------------------------------------------------------------------
// INVENTORY ADJUSTMENTS
// -----------------------------------------------------------------------------

async function adjustInventory({
  businessId,
  userId,
  productId,
  quantity,
  reorderLevel,
  notes,
}) {
  const membership = await getOne(
    `SELECT id FROM business_memberships
     WHERE business_id = ? AND user_id = ?`,
    [businessId, userId]
  );

  if (!membership) {
    throw new Error('FORBIDDEN');
  }

  if (
    !Number.isSafeInteger(quantity) ||
    quantity === 0 ||
    (
      reorderLevel !== undefined &&
      (
        !Number.isSafeInteger(reorderLevel) ||
        reorderLevel < 0
      )
    )
  ) {
    throw new Error('INVALID_ADJUSTMENT');
  }

  await withTransaction(async (connection) => {
    const inventoryRow = await getOne(
      `SELECT i.quantity_on_hand
       FROM inventory i
       JOIN products p
         ON p.id = i.product_id
         AND p.business_id = i.business_id
       WHERE i.business_id = ?
         AND i.product_id = ?
       FOR UPDATE`,
      [businessId, productId],
      connection
    );

    if (!inventoryRow) {
      throw new Error('INVALID_PRODUCT');
    }

    if (
      Number(inventoryRow.quantity_on_hand) + quantity < 0
    ) {
      throw new Error('INSUFFICIENT_STOCK');
    }

    const now = new Date();

    await execute(
      `UPDATE inventory
       SET quantity_on_hand = quantity_on_hand + ?,
           reorder_level = COALESCE(?, reorder_level),
           updated_at = ?
       WHERE business_id = ?
         AND product_id = ?`,
      [
        quantity,
        reorderLevel === undefined ? null : reorderLevel,
        now,
        businessId,
        productId,
      ],
      connection
    );

    await execute(
      `INSERT INTO inventory_movements
       (
         business_id,
         product_id,
         movement_type,
         quantity,
         reference_type,
         reference_id,
         notes,
         created_at
       )
       VALUES (?, ?, ?, ?, 'adjustment', NULL, ?, ?)`,
      [
        businessId,
        productId,
        quantity > 0 ? 'receipt' : 'adjustment',
        quantity,
        String(notes || '').slice(0, 250) || null,
        now,
      ],
      connection
    );
  });

  return getOne(
    `SELECT * FROM inventory
     WHERE business_id = ?
       AND product_id = ?`,
    [businessId, productId]
  );
}

// -----------------------------------------------------------------------------
// EXPORTS
// -----------------------------------------------------------------------------

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
