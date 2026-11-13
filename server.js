require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const db = require('./src/api/database');
const {
  createUser,
  createBusiness,
  verifyPassword,
  getUserByEmail,
  createSession,
  getBusinessMembershipsForUser,
  getCurrentBusinessForUser,
  updateBusinessSettings,
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
} = require('./src/api/service');
const { getDashboardData } = require('./src/api/dashboard.service');
const {
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
} = require('./src/api/catalogue.service');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function getSessionFromRequest(req) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return null;
  }

  const row = db.prepare('SELECT * FROM sessions WHERE id = ? AND expires_at > ?').get(token, new Date().toISOString());
  return row || null;
}

function requireAuth(req, res, next) {
  const session = getSessionFromRequest(req);
  if (!session) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  req.user = { id: session.user_id };
  req.businessId = session.business_id;
  return next();
}

function requireBusinessAccess(req, res, next) {
  const businessId = Number(req.params.businessId || req.body.businessId || req.businessId);
  if (!businessId) {
    return res.status(400).json({ error: 'Missing business context' });
  }

  const match = getCurrentBusinessForUser(req.user.id, businessId);
  if (!match) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  req.businessId = businessId;
  return next();
}

function requireCatalogueAdmin(req, res, next) {
  const allowedEmails = String(process.env.CATALOGUE_ADMIN_EMAILS || '')
    .split(',').map((email) => email.trim().toLowerCase()).filter(Boolean);
  const user = db.prepare('SELECT email FROM users WHERE id = ?').get(req.user.id);
  if (!user || !allowedEmails.includes(user.email.toLowerCase())) {
    return res.status(403).json({ error: 'Platform catalogue administrator access required' });
  }
  return next();
}

function isCatalogueAdmin(userId) {
  const allowedEmails = String(process.env.CATALOGUE_ADMIN_EMAILS || '')
    .split(',').map((email) => email.trim().toLowerCase()).filter(Boolean);
  const user = db.prepare('SELECT email FROM users WHERE id = ?').get(userId);
  return Boolean(user && allowedEmails.includes(user.email.toLowerCase()));
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'workflowos' });
});

app.post('/api/register', (req, res) => {
  const { firstName, lastName, email, password, businessName, businessType } = req.body || {};

  if (!firstName || !lastName || !email || !password || !businessName || !businessType) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const user = createUser({ firstName, lastName, email, password });
    const business = createBusiness({ userId: user.id, name: businessName, businessType, currency: 'ZAR', timezone: 'Africa/Johannesburg' });
    const { sessionId } = createSession(user.id, business.id);

    return res.status(201).json({
      user: { id: user.id, firstName: user.first_name, lastName: user.last_name, email: user.email },
      business: { id: business.id, name: business.name, businessType: business.business_type },
      sessionToken: sessionId,
    });
  } catch (error) {
    if (error.message === 'USER_EXISTS') {
      return res.status(409).json({ error: 'User already exists' });
    }
    return res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  const user = getUserByEmail(email);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const memberships = getBusinessMembershipsForUser(user.id);
  const business = memberships[0];
  const { sessionId } = createSession(user.id, business ? business.business_id : null);

  return res.json({
    user: { id: user.id, firstName: user.first_name, lastName: user.last_name, email: user.email },
    business: business ? { id: business.business_id, name: business.business_name } : null,
    sessionToken: sessionId,
  });
});

app.get('/api/session', requireAuth, (req, res) => {
  const memberships = getBusinessMembershipsForUser(req.user.id);
  const activeBusiness = memberships.find((item) => item.business_id === Number(req.businessId)) || memberships[0] || null;
  const user = db.prepare('SELECT id, email, first_name, last_name FROM users WHERE id = ?').get(req.user.id);

  return res.json({
    user: { id: req.user.id, email: user.email, firstName: user.first_name, lastName: user.last_name },
    business: activeBusiness ? {
      id: activeBusiness.business_id,
      name: activeBusiness.business_name,
      businessType: activeBusiness.business_type,
      currency: activeBusiness.currency,
      timezone: activeBusiness.timezone,
    } : null,
    memberships: memberships.map((row) => ({ id: row.business_id, name: row.business_name, role: row.role })),
  });
});

app.get('/api/dashboard', requireAuth, requireBusinessAccess, (req, res) => {
  try {
    const data = getDashboardData(Number(req.businessId), {
      period: req.query.period,
      granularity: req.query.granularity,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
    });
    return res.json(data);
  } catch (error) {
    if (error.message === 'INVALID_DATE_RANGE') {
      return res.status(400).json({ error: 'Invalid reporting date range' });
    }
    return res.status(500).json({ error: 'Dashboard data could not be loaded' });
  }
});

app.put('/api/businesses/:businessId/settings', requireAuth, requireBusinessAccess, (req, res) => {
  try {
    const settings = updateBusinessSettings({
      businessId: Number(req.params.businessId),
      userId: req.user.id,
      payload: req.body || {},
    });

    return res.json({ settings });
  } catch (error) {
    if (error.message === 'FORBIDDEN') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    return res.status(500).json({ error: 'Settings update failed' });
  }
});

app.get('/api/businesses/:businessId/settings', requireAuth, requireBusinessAccess, (req, res) => {
  return res.json({ settings: getSettingsForBusiness(Number(req.businessId)) });
});

app.get('/api/inventory', requireAuth, requireBusinessAccess, (req, res) => {
  return res.json({ inventory: getInventoryForBusiness(Number(req.businessId)) });
});

app.get('/api/products', requireAuth, requireBusinessAccess, (req, res) => {
  try {
    const products = getProductsForBusiness(Number(req.businessId));
    return res.json({ products: products.map((product) => ({
      ...product,
      price: Number(product.price_cents || 0) / 100,
      cost: Number(product.cost_cents || 0) / 100,
    })) });
  } catch (error) {
    return res.status(500).json({ error: 'Could not load products' });
  }
});

app.get('/api/products/:productId(\\d+)', requireAuth, requireBusinessAccess, (req, res) => {
  try {
    const product = getProductForBusiness({
      businessId: Number(req.businessId),
      userId: req.user.id,
      productId: Number(req.params.productId),
    });
    return res.json({ product });
  } catch (error) {
    if (error.message === 'PRODUCT_NOT_FOUND') return res.status(404).json({ error: 'Product not found' });
    if (error.message === 'FORBIDDEN') return res.status(403).json({ error: 'Forbidden' });
    return res.status(500).json({ error: 'Product could not be loaded' });
  }
});

app.get('/api/products/search', requireAuth, requireBusinessAccess, (req, res) => {
  try {
    const products = searchBusinessProducts({ businessId: Number(req.businessId), userId: req.user.id, query: req.query.q || '' });
    return res.json({ products });
  } catch (error) {
    if (error.message === 'FORBIDDEN') return res.status(403).json({ error: 'Forbidden' });
    return res.status(500).json({ error: 'Product search failed' });
  }
});

app.get('/api/products/barcode/:barcode', requireAuth, requireBusinessAccess, (req, res) => {
  try {
    const product = lookupVerifiedBarcode({ businessId: Number(req.businessId), userId: req.user.id, barcode: req.params.barcode });
    return res.json({ product });
  } catch (error) {
    if (error.message === 'INVALID_BARCODE') return res.status(400).json({ error: 'Invalid EAN-13, EAN-8, or UPC-A barcode' });
    if (error.message === 'BARCODE_NOT_FOUND') return res.status(404).json({ error: 'No verified business product matches this barcode' });
    if (error.message === 'PRODUCT_UNAVAILABLE') return res.status(409).json({ error: 'The matched product is inactive or unavailable' });
    if (error.message === 'FORBIDDEN') return res.status(403).json({ error: 'Forbidden' });
    return res.status(500).json({ error: 'Barcode lookup failed' });
  }
});

app.post('/api/products', requireAuth, requireBusinessAccess, (req, res) => {
  try {
    const product = createProduct({
      businessId: Number(req.businessId),
      userId: req.user.id,
      payload: req.body || {},
    });

    return res.status(201).json({
      product: {
        ...product,
        price: Number(product.price_cents || 0) / 100,
        cost: Number(product.cost_cents || 0) / 100,
      },
    });
  } catch (error) {
    if (error.message === 'FORBIDDEN') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (error.message === 'INVALID_PRODUCT') {
      return res.status(400).json({ error: 'Product name, stock, and reorder values must be valid' });
    }
    if (error.message === 'INVALID_BARCODE') return res.status(400).json({ error: 'Barcode must be a valid EAN-13, EAN-8, or UPC-A value' });
    if (error.message === 'INVALID_IMAGE_URL') return res.status(400).json({ error: 'Product image URL must be a valid HTTPS URL' });
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'That SKU or barcode already exists in this business' });
    return res.status(500).json({ error: 'Product creation failed' });
  }
});

app.put('/api/products/:productId(\\d+)', requireAuth, requireBusinessAccess, (req, res) => {
  try {
    const product = updateProduct({
      businessId: Number(req.businessId),
      userId: req.user.id,
      productId: Number(req.params.productId),
      payload: req.body || {},
    });
    return res.json({ product });
  } catch (error) {
    if (error.message === 'PRODUCT_NOT_FOUND') return res.status(404).json({ error: 'Product not found' });
    if (error.message === 'INVALID_BARCODE') return res.status(400).json({ error: 'Barcode must be a valid EAN-13, EAN-8, or UPC-A value' });
    if (error.message === 'INVALID_IMAGE_URL') return res.status(400).json({ error: 'Product image URL must be a valid HTTPS URL' });
    if (error.message === 'INVALID_PRODUCT') return res.status(400).json({ error: 'Product fields are invalid' });
    if (error.message === 'FORBIDDEN') return res.status(403).json({ error: 'Forbidden' });
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'That SKU or barcode already exists in this business' });
    return res.status(500).json({ error: 'Product update failed' });
  }
});

app.post('/api/products/:productId(\\d+)/archive', requireAuth, requireBusinessAccess, (req, res) => {
  try {
    const product = updateProduct({
      businessId: Number(req.businessId),
      userId: req.user.id,
      productId: Number(req.params.productId),
      payload: { isActive: false },
    });
    return res.json({ product });
  } catch (error) {
    if (error.message === 'PRODUCT_NOT_FOUND') return res.status(404).json({ error: 'Product not found' });
    if (error.message === 'FORBIDDEN') return res.status(403).json({ error: 'Forbidden' });
    return res.status(500).json({ error: 'Product could not be archived' });
  }
});

app.post('/api/admin/global-catalogue', requireAuth, requireCatalogueAdmin, (req, res) => {
  try {
    const product = saveGlobalCatalogueEntry({ product: req.body || {}, dataSource: req.body?.dataSource });
    return res.status(201).json({ product });
  } catch (error) {
    if (error.message === 'INVALID_CATALOGUE_PRODUCT') return res.status(400).json({ error: 'Product name is required and must be under 180 characters' });
    if (error.message === 'SOURCE_REQUIRED') return res.status(400).json({ error: 'A source note is required' });
    return res.status(500).json({ error: 'Catalogue entry could not be created' });
  }
});

app.put('/api/admin/global-catalogue/:catalogueId', requireAuth, requireCatalogueAdmin, (req, res) => {
  try {
    const product = saveGlobalCatalogueEntry({ id: Number(req.params.catalogueId), product: req.body || {}, dataSource: req.body?.dataSource });
    return res.json({ product });
  } catch (error) {
    if (error.message === 'CATALOGUE_PRODUCT_NOT_FOUND') return res.status(404).json({ error: 'Catalogue entry not found' });
    if (error.message === 'INVALID_CATALOGUE_PRODUCT') return res.status(400).json({ error: 'Product name is required and must be under 180 characters' });
    if (error.message === 'SOURCE_REQUIRED') return res.status(400).json({ error: 'A source note is required' });
    return res.status(500).json({ error: 'Catalogue entry could not be updated' });
  }
});

app.post('/api/admin/global-catalogue/:catalogueId/barcodes', requireAuth, requireCatalogueAdmin, (req, res) => {
  try {
    const barcode = addGlobalBarcode({ catalogueId: Number(req.params.catalogueId), barcode: req.body?.barcode, dataSource: req.body?.dataSource });
    return res.status(201).json({ barcode });
  } catch (error) {
    if (error.message === 'CATALOGUE_PRODUCT_NOT_FOUND') return res.status(404).json({ error: 'Catalogue entry not found' });
    if (error.message === 'INVALID_BARCODE') return res.status(400).json({ error: 'Barcode must be a valid EAN-13, EAN-8, or UPC-A value' });
    if (error.message === 'SOURCE_REQUIRED') return res.status(400).json({ error: 'A source note is required' });
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'This barcode has already been verified for another product' });
    return res.status(500).json({ error: 'Barcode could not be added' });
  }
});

app.post('/api/admin/global-catalogue/barcodes/:barcodeId/verify', requireAuth, requireCatalogueAdmin, (req, res) => {
  try {
    const barcode = verifyGlobalBarcode({ barcodeId: Number(req.params.barcodeId), sourceUrl: req.body?.sourceUrl });
    return res.json({ barcode });
  } catch (error) {
    if (error.message === 'BARCODE_RECORD_NOT_FOUND') return res.status(404).json({ error: 'Barcode record not found' });
    if (error.message === 'INVALID_VERIFICATION_SOURCE') return res.status(400).json({ error: 'Verification evidence must be an HTTPS URL' });
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'This barcode is already verified for another catalogue product' });
    return res.status(500).json({ error: 'Barcode verification could not be saved' });
  }
});

app.get('/api/global-catalogue', requireAuth, requireBusinessAccess, (req, res) => {
  try {
    const products = searchGlobalCatalogue({ businessId: Number(req.businessId), userId: req.user.id, query: req.query.q || '' });
    return res.json({ products });
  } catch {
    return res.status(500).json({ error: 'Shared catalogue search failed' });
  }
});

app.get('/api/admin/catalogue-access', requireAuth, (req, res) => {
  return res.json({ isAdmin: isCatalogueAdmin(req.user.id) });
});

app.get('/api/admin/global-catalogue', requireAuth, requireCatalogueAdmin, (req, res) => {
  try {
    return res.json({ products: listAdminCatalogue({ query: req.query.q || '' }) });
  } catch {
    return res.status(500).json({ error: 'Catalogue review list could not be loaded' });
  }
});

app.post('/api/global-catalogue/:catalogueId/import', requireAuth, requireBusinessAccess, (req, res) => {
  try {
    const product = importGlobalProduct({
      businessId: Number(req.businessId),
      userId: req.user.id,
      catalogueId: Number(req.params.catalogueId),
      pricing: req.body || {},
    });
    return res.status(201).json({ product });
  } catch (error) {
    if (error.message === 'CATALOGUE_PRODUCT_NOT_FOUND') return res.status(404).json({ error: 'Catalogue entry not found' });
    if (error.message === 'INVALID_PRODUCT') return res.status(400).json({ error: 'Price, cost, or stock is invalid' });
    if (error.message === 'DUPLICATE_BARCODE' || error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'This barcode or SKU already exists in your business' });
    if (error.message === 'FORBIDDEN') return res.status(403).json({ error: 'Forbidden' });
    return res.status(500).json({ error: 'Catalogue import failed' });
  }
});

app.post('/api/products/import-csv', requireAuth, requireBusinessAccess, (req, res) => {
  try {
    const summary = importProductsCsv({ businessId: Number(req.businessId), userId: req.user.id, csv: req.body?.csv });
    return res.json({ summary });
  } catch (error) {
    if (error.message === 'INVALID_CSV') return res.status(400).json({ error: 'CSV is invalid, malformed, or too large' });
    return res.status(500).json({ error: 'CSV import failed' });
  }
});

app.get('/api/products/export.csv', requireAuth, requireBusinessAccess, (req, res) => {
  try {
    const csv = exportProductsCsv({ businessId: Number(req.businessId), userId: req.user.id });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="workflowos-products.csv"');
    return res.send(csv);
  } catch {
    return res.status(500).json({ error: 'Product export failed' });
  }
});

app.post('/api/inventory/:productId/adjustments', requireAuth, requireBusinessAccess, (req, res) => {
  try {
    const inventory = adjustInventory({
      businessId: Number(req.businessId),
      userId: req.user.id,
      productId: Number(req.params.productId),
      quantity: Number(req.body?.quantity),
      reorderLevel: req.body?.reorderLevel === undefined ? undefined : Number(req.body.reorderLevel),
      notes: req.body?.notes,
    });
    return res.json({ inventory });
  } catch (error) {
    if (error.message === 'INVALID_PRODUCT') return res.status(404).json({ error: 'Product not found' });
    if (error.message === 'INVALID_ADJUSTMENT') return res.status(400).json({ error: 'A non-zero whole-number stock adjustment is required' });
    if (error.message === 'INSUFFICIENT_STOCK') return res.status(409).json({ error: 'Adjustment would make stock negative' });
    if (error.message === 'FORBIDDEN') return res.status(403).json({ error: 'Forbidden' });
    return res.status(500).json({ error: 'Stock adjustment failed' });
  }
});

app.post('/api/sales', requireAuth, requireBusinessAccess, (req, res) => {
  try {
    const result = createSale({
      businessId: Number(req.businessId),
      userId: req.user.id,
      payload: req.body || {},
      idempotencyKey: req.get('Idempotency-Key') || null,
    });
    return res.status(result.replayed ? 200 : 201).json({ sale: result.sale, replayed: result.replayed });
  } catch (error) {
    if (error.message === 'INVALID_SALE') return res.status(400).json({ error: 'Sale must contain valid product quantities' });
    if (error.message === 'INVALID_PRODUCT') return res.status(400).json({ error: 'A product is unavailable in this business' });
    if (error.message === 'INVALID_CUSTOMER') return res.status(400).json({ error: 'Customer is unavailable in this business' });
    if (error.message === 'INSUFFICIENT_STOCK') return res.status(409).json({ error: 'Not enough stock to complete this sale' });
    if (error.message === 'FORBIDDEN') return res.status(403).json({ error: 'Forbidden' });
    return res.status(500).json({ error: 'Sale could not be recorded' });
  }
});

app.post('/api/sales/:saleId/refund', requireAuth, requireBusinessAccess, (req, res) => {
  try {
    const sale = refundSale({ businessId: Number(req.businessId), saleId: Number(req.params.saleId) });
    return res.json({ sale });
  } catch (error) {
    if (error.message === 'SALE_NOT_FOUND') return res.status(404).json({ error: 'Sale not found' });
    if (error.message === 'SALE_NOT_REFUNDABLE') return res.status(409).json({ error: 'Sale is not eligible for refund' });
    return res.status(500).json({ error: 'Refund could not be recorded' });
  }
});

app.get('/api/customers', requireAuth, requireBusinessAccess, (req, res) => {
  try {
    const customers = getCustomersForBusiness(Number(req.businessId));
    return res.json({ customers });
  } catch (error) {
    return res.status(500).json({ error: 'Could not load customers' });
  }
});

app.post('/api/customers', requireAuth, requireBusinessAccess, (req, res) => {
  try {
    const customer = createCustomer({
      businessId: Number(req.businessId),
      userId: req.user.id,
      payload: req.body || {},
    });

    return res.status(201).json({ customer });
  } catch (error) {
    if (error.message === 'FORBIDDEN') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (error.message === 'INVALID_CUSTOMER') {
      return res.status(400).json({ error: 'Customer name is required' });
    }
    return res.status(500).json({ error: 'Customer creation failed' });
  }
});

app.post('/api/logout', requireAuth, (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (token) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(token);
  }

  return res.json({ ok: true });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

function startServer(port = PORT) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, '0.0.0.0', () => {
      console.log(
        `WorkflowOS ${process.env.APP_ENV || 'DEV'} listening on port ${port}`
      );
      resolve(server);
    });

    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        if (process.env.PORT) {
          reject(error);
          return;
        }

        const nextPort = port + 1;
        console.warn(`Port ${port} is busy. Retrying on ${nextPort}`);
        server.close();
        resolve(startServer(nextPort));
        return;
      }

      reject(error);
    });
  });
}

if (require.main === module) {
  startServer(Number(process.env.PORT || PORT)).catch((error) => {
    console.error('Unable to start WorkflowOS:', error.message);
    process.exit(1);
  });
}

module.exports = app;
module.exports.app = app;
module.exports.startServer = startServer;
