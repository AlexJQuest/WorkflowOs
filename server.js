
require('dotenv').config();

const express = require('express');
const path = require('path');
const db = require('./src/api/database');
const {
  createPasswordResetToken,
  completePasswordReset,
  deletePasswordResetToken,
} = require('./src/api/password-reset.service');

const {
  createUser,
  createBusiness,
  verifyPassword,
  getUserByEmail,
  getUserById,
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

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

async function queryOne(sql, params = []) {
  const [rows] = await db.execute(sql, params);
  return rows[0] || null;
}

function isDuplicateError(error) {
  return error?.code === 'ER_DUP_ENTRY' || error?.errno === 1062;
}

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function getToken(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

async function getSessionFromRequest(req) {
  const token = getToken(req);

  if (!token) return null;

  return queryOne(
    `SELECT *
     FROM sessions
     WHERE id = ?
       AND expires_at > UTC_TIMESTAMP()`,
    [token]
  );
}

async function requireAuth(req, res, next) {
  try {
    const session = await getSessionFromRequest(req);

    if (!session) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    req.user = { id: session.user_id };
    req.businessId = session.business_id;

    return next();
  } catch (error) {
    return next(error);
  }
}

async function requireBusinessAccess(req, res, next) {
  try {
    const businessId = Number(
      req.params.businessId || req.body?.businessId || req.businessId
    );

    if (!businessId) {
      return res.status(400).json({ error: 'Missing business context' });
    }

    const match = await getCurrentBusinessForUser(
      req.user.id,
      businessId
    );

    if (!match) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    req.businessId = businessId;

    return next();
  } catch (error) {
    return next(error);
  }
}

async function isCatalogueAdmin(userId) {
  const allowedEmails = String(
    process.env.CATALOGUE_ADMIN_EMAILS || ''
  )
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

  const user = await queryOne(
    'SELECT email FROM users WHERE id = ?',
    [userId]
  );

  return Boolean(
    user && allowedEmails.includes(user.email.toLowerCase())
  );
}

async function requireCatalogueAdmin(req, res, next) {
  try {
    if (!(await isCatalogueAdmin(req.user.id))) {
      return res.status(403).json({
        error: 'Platform catalogue administrator access required',
      });
    }

    return next();
  } catch (error) {
    return next(error);
  }
}

// -----------------------------------------------------------------------------
// Health
// -----------------------------------------------------------------------------

app.get('/api/health', asyncHandler(async (req, res) => {
  await db.execute('SELECT 1');

  return res.json({
    ok: true,
    service: 'workflowos',
    database: 'connected',
  });
}));

// -----------------------------------------------------------------------------
// Registration
// -----------------------------------------------------------------------------

app.post('/api/register', asyncHandler(async (req, res) => {
  const {
    firstName,
    lastName,
    email,
    password,
    businessName,
    businessType,
  } = req.body || {};

  if (
    !firstName ||
    !lastName ||
    !email ||
    !password ||
    !businessName ||
    !businessType
  ) {
    return res.status(400).json({
      error: 'Missing required fields',
    });
  }

  try {
    const user = await createUser({
      firstName,
      lastName,
      email,
      password,
    });

    const business = await createBusiness({
      userId: user.id,
      name: businessName,
      businessType,
      currency: 'ZAR',
      timezone: 'Africa/Johannesburg',
    });

    const { sessionId } = await createSession(
      user.id,
      business.id
    );

    return res.status(201).json({
      user: {
        id: user.id,
        firstName: user.first_name,
        lastName: user.last_name,
        email: user.email,
      },
      business: {
        id: business.id,
        name: business.name,
        businessType: business.business_type,
      },
      sessionToken: sessionId,
    });
  } catch (error) {
    if (error.message === 'USER_EXISTS' || isDuplicateError(error)) {
      return res.status(409).json({
        error: 'User already exists',
      });
    }

    console.error('Registration error:', error);

    return res.status(500).json({
      error: 'Registration failed',
    });
  }
}));

// -----------------------------------------------------------------------------
// Login
// -----------------------------------------------------------------------------

app.post('/api/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({
      error: 'Email and password required',
    });
  }

  const user = await getUserByEmail(email);

  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({
      error: 'Invalid credentials',
    });
  }

  const memberships = await getBusinessMembershipsForUser(user.id);
  const business = memberships[0] || null;

  const { sessionId } = await createSession(
    user.id,
    business ? business.business_id : null
  );

  return res.json({
    user: {
      id: user.id,
      firstName: user.first_name,
      lastName: user.last_name,
      email: user.email,
    },
    business: business
      ? {
          id: business.business_id,
          name: business.business_name,
        }
      : null,
    sessionToken: sessionId,
  });
}));

// -----------------------------------------------------------------------------
// Password reset

const passwordResetRequests = new Map();

function allowPasswordResetRequest(key) {
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const current = passwordResetRequests.get(key);
  if (!current || now - current.startedAt > windowMs) {
    passwordResetRequests.set(key, { startedAt: now, count: 1 });
    return true;
  }
  if (current.count >= 5) return false;
  current.count += 1;
  return true;
}

async function sendPasswordResetEmail(email, resetUrl) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM,
      to: [email],
      subject: 'Reset your WorkflowOS password',
      text: `We received a request to reset your WorkflowOS password. Use this link within 30 minutes: ${resetUrl}\n\nIf you did not request this, you can ignore this email.`,
      html: `<p>We received a request to reset your WorkflowOS password.</p><p><a href="${resetUrl}">Reset your password</a></p><p>This link expires in 30 minutes and can only be used once. If you did not request this, you can ignore this email.</p>`,
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Password reset email delivery failed (${response.status}): ${detail.slice(0, 300)}`);
  }
}

app.post('/api/password-reset/request', asyncHandler(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return res.status(400).json({ error: 'Enter a valid email address.' });
  }

  const clientKey = String(req.ip || req.socket?.remoteAddress || 'unknown');
  if (!allowPasswordResetRequest(clientKey)) {
    return res.status(429).json({ error: 'Too many reset requests. Please try again in 15 minutes.' });
  }

  const hasEmailDelivery = Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
  if (process.env.NODE_ENV === 'production' && (
    !hasEmailDelivery ||
    !process.env.APP_BASE_URL ||
    !String(process.env.APP_BASE_URL).startsWith('https://')
  )) {
    return res.status(503).json({ error: 'Password recovery email is not configured yet.' });
  }

  const token = await createPasswordResetToken(email);
  if (token) {
    const baseUrl = String(process.env.APP_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
    const resetUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`;
    if (hasEmailDelivery) {
      try {
        await sendPasswordResetEmail(email, resetUrl);
      } catch (error) {
        await deletePasswordResetToken(token);
        console.error('Password reset email error:', error.message);
        return res.status(502).json({ error: 'We could not send the reset email. Please try again later.' });
      }
    } else if (process.env.NODE_ENV !== 'production') {
      console.info('WorkflowOS development password reset URL:', resetUrl);
      return res.json({
        message: 'Development mode: use the reset link printed in your server terminal.',
        debugResetUrl: resetUrl,
      });
    }
  }

  return res.json({
    message: 'If an account exists for that email, a password reset link has been sent.',
  });
}));

app.post('/api/password-reset/confirm', asyncHandler(async (req, res) => {
  const token = String(req.body?.token || '');
  const password = String(req.body?.password || '');
  if (password.length < 10 || password.length > 128) {
    return res.status(400).json({ error: 'Your password must be between 10 and 128 characters.' });
  }
  const updated = await completePasswordReset(token, password);
  if (!updated) {
    return res.status(400).json({ error: 'This reset link is invalid, expired, or has already been used. Request a new link.' });
  }
  return res.json({ message: 'Password updated. Please sign in with your new password.' });
}));

// Session
// -----------------------------------------------------------------------------

app.get('/api/session', requireAuth, asyncHandler(async (req, res) => {
  const memberships = await getBusinessMembershipsForUser(req.user.id);

  const activeBusiness =
    memberships.find(
      (item) => item.business_id === Number(req.businessId)
    ) ||
    memberships[0] ||
    null;

  const user = await getUserById(req.user.id);

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  return res.json({
    user: {
      id: req.user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
    },
    business: activeBusiness
      ? {
          id: activeBusiness.business_id,
          name: activeBusiness.business_name,
          businessType: activeBusiness.business_type,
          currency: activeBusiness.currency,
          timezone: activeBusiness.timezone,
        }
      : null,
    memberships: memberships.map((row) => ({
      id: row.business_id,
      name: row.business_name,
      role: row.role,
    })),
  });
}));

// -----------------------------------------------------------------------------
// Dashboard
// -----------------------------------------------------------------------------

app.get('/api/dashboard', requireAuth, requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      const data = await getDashboardData(Number(req.businessId), {
        period: req.query.period,
        granularity: req.query.granularity,
        startDate: req.query.startDate,
        endDate: req.query.endDate,
      });

      return res.json(data);
    } catch (error) {
      if (error.message === 'INVALID_DATE_RANGE') {
        return res.status(400).json({
          error: 'Invalid reporting date range',
        });
      }

      throw error;
    }
  })
);

// -----------------------------------------------------------------------------
// Business settings
// -----------------------------------------------------------------------------

app.put('/api/businesses/:businessId/settings',
  requireAuth,
  requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      const settings = await updateBusinessSettings({
        businessId: Number(req.params.businessId),
        userId: req.user.id,
        payload: req.body || {},
      });

      return res.json({ settings });
    } catch (error) {
      if (error.message === 'FORBIDDEN') {
        return res.status(403).json({ error: 'Forbidden' });
      }

      throw error;
    }
  })
);

app.get('/api/businesses/:businessId/settings',
  requireAuth,
  requireBusinessAccess,
  asyncHandler(async (req, res) => {
    const settings = await getSettingsForBusiness(
      Number(req.businessId)
    );

    return res.json({ settings });
  })
);

// -----------------------------------------------------------------------------
// Inventory
// -----------------------------------------------------------------------------

app.get('/api/inventory', requireAuth, requireBusinessAccess,
  asyncHandler(async (req, res) => {
    const inventory = await getInventoryForBusiness(
      Number(req.businessId)
    );

    return res.json({ inventory });
  })
);

app.post('/api/inventory/:productId/adjustments',
  requireAuth,
  requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      const inventory = await adjustInventory({
        businessId: Number(req.businessId),
        userId: req.user.id,
        productId: Number(req.params.productId),
        quantity: Number(req.body?.quantity),
        reorderLevel:
          req.body?.reorderLevel === undefined
            ? undefined
            : Number(req.body.reorderLevel),
        notes: req.body?.notes,
      });

      return res.json({ inventory });
    } catch (error) {
      if (error.message === 'INVALID_PRODUCT') {
        return res.status(404).json({ error: 'Product not found' });
      }

      if (error.message === 'INVALID_ADJUSTMENT') {
        return res.status(400).json({
          error: 'A non-zero whole-number stock adjustment is required',
        });
      }

      if (error.message === 'INSUFFICIENT_STOCK') {
        return res.status(409).json({
          error: 'Adjustment would make stock negative',
        });
      }

      if (error.message === 'FORBIDDEN') {
        return res.status(403).json({ error: 'Forbidden' });
      }

      throw error;
    }
  })
);

// -----------------------------------------------------------------------------
// Products
// -----------------------------------------------------------------------------

app.get('/api/products', requireAuth, requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      const products = await getProductsForBusiness(
        Number(req.businessId)
      );

      return res.json({
        products: products.map((product) => ({
          ...product,
          price: Number(product.price_cents || 0) / 100,
          cost: Number(product.cost_cents || 0) / 100,
        })),
      });
    } catch (error) {
      console.error('Product loading error:', error);

      return res.status(500).json({
        error: 'Could not load products',
      });
    }
  })
);

app.get('/api/products/search', requireAuth, requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      const products = await searchBusinessProducts({
        businessId: Number(req.businessId),
        userId: req.user.id,
        query: req.query.q || '',
      });

      return res.json({ products });
    } catch (error) {
      if (error.message === 'FORBIDDEN') {
        return res.status(403).json({ error: 'Forbidden' });
      }

      throw error;
    }
  })
);

app.get('/api/products/barcode/:barcode',
  requireAuth,
  requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      const product = await lookupVerifiedBarcode({
        businessId: Number(req.businessId),
        userId: req.user.id,
        barcode: req.params.barcode,
      });

      return res.json({ product });
    } catch (error) {
      if (error.message === 'INVALID_BARCODE') {
        return res.status(400).json({
          error: 'Invalid EAN-13, EAN-8, or UPC-A barcode',
        });
      }

      if (error.message === 'BARCODE_NOT_FOUND') {
        return res.status(404).json({
          error: 'No verified business product matches this barcode',
        });
      }

      if (error.message === 'PRODUCT_UNAVAILABLE') {
        return res.status(409).json({
          error: 'The matched product is inactive or unavailable',
        });
      }

      if (error.message === 'FORBIDDEN') {
        return res.status(403).json({ error: 'Forbidden' });
      }

      throw error;
    }
  })
);

app.get('/api/products/:productId(\\d+)',
  requireAuth,
  requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      const product = await getProductForBusiness({
        businessId: Number(req.businessId),
        userId: req.user.id,
        productId: Number(req.params.productId),
      });

      return res.json({ product });
    } catch (error) {
      if (error.message === 'PRODUCT_NOT_FOUND') {
        return res.status(404).json({ error: 'Product not found' });
      }

      if (error.message === 'FORBIDDEN') {
        return res.status(403).json({ error: 'Forbidden' });
      }

      throw error;
    }
  })
);

app.post('/api/products', requireAuth, requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      const product = await createProduct({
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
        return res.status(400).json({
          error: 'Product name, stock, and reorder values must be valid',
        });
      }

      if (error.message === 'INVALID_BARCODE') {
        return res.status(400).json({
          error: 'Barcode must be a valid EAN-13, EAN-8, or UPC-A value',
        });
      }

      if (error.message === 'INVALID_IMAGE_URL') {
        return res.status(400).json({
          error: 'Product image URL must be a valid HTTPS URL',
        });
      }

      if (isDuplicateError(error)) {
        return res.status(409).json({
          error: 'That SKU or barcode already exists in this business',
        });
      }

      throw error;
    }
  })
);

app.put('/api/products/:productId(\\d+)',
  requireAuth,
  requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      const product = await updateProduct({
        businessId: Number(req.businessId),
        userId: req.user.id,
        productId: Number(req.params.productId),
        payload: req.body || {},
      });

      return res.json({ product });
    } catch (error) {
      if (error.message === 'PRODUCT_NOT_FOUND') {
        return res.status(404).json({ error: 'Product not found' });
      }

      if (error.message === 'INVALID_BARCODE') {
        return res.status(400).json({
          error: 'Barcode must be a valid EAN-13, EAN-8, or UPC-A value',
        });
      }

      if (error.message === 'INVALID_IMAGE_URL') {
        return res.status(400).json({
          error: 'Product image URL must be a valid HTTPS URL',
        });
      }

      if (error.message === 'INVALID_PRODUCT') {
        return res.status(400).json({ error: 'Product fields are invalid' });
      }

      if (error.message === 'FORBIDDEN') {
        return res.status(403).json({ error: 'Forbidden' });
      }

      if (isDuplicateError(error)) {
        return res.status(409).json({
          error: 'That SKU or barcode already exists in this business',
        });
      }

      throw error;
    }
  })
);

app.post('/api/products/:productId(\\d+)/archive',
  requireAuth,
  requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      const product = await updateProduct({
        businessId: Number(req.businessId),
        userId: req.user.id,
        productId: Number(req.params.productId),
        payload: { isActive: false },
      });

      return res.json({ product });
    } catch (error) {
      if (error.message === 'PRODUCT_NOT_FOUND') {
        return res.status(404).json({ error: 'Product not found' });
      }

      if (error.message === 'FORBIDDEN') {
        return res.status(403).json({ error: 'Forbidden' });
      }

      throw error;
    }
  })
);

// -----------------------------------------------------------------------------
// Global catalogue
// -----------------------------------------------------------------------------

app.get('/api/global-catalogue',
  requireAuth,
  requireBusinessAccess,
  asyncHandler(async (req, res) => {
    const products = await searchGlobalCatalogue({
      businessId: Number(req.businessId),
      userId: req.user.id,
      query: req.query.q || '',
    });

    return res.json({ products });
  })
);

app.post('/api/global-catalogue/:catalogueId/import',
  requireAuth,
  requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      const product = await importGlobalProduct({
        businessId: Number(req.businessId),
        userId: req.user.id,
        catalogueId: Number(req.params.catalogueId),
        pricing: req.body || {},
      });

      return res.status(201).json({ product });
    } catch (error) {
      if (error.message === 'CATALOGUE_PRODUCT_NOT_FOUND') {
        return res.status(404).json({ error: 'Catalogue entry not found' });
      }

      if (error.message === 'INVALID_PRODUCT') {
        return res.status(400).json({
          error: 'Price, cost, or stock is invalid',
        });
      }

      if (
        error.message === 'DUPLICATE_BARCODE' ||
        isDuplicateError(error)
      ) {
        return res.status(409).json({
          error: 'This barcode or SKU already exists in your business',
        });
      }

      if (error.message === 'FORBIDDEN') {
        return res.status(403).json({ error: 'Forbidden' });
      }

      throw error;
    }
  })
);

// -----------------------------------------------------------------------------
// Catalogue administration
// -----------------------------------------------------------------------------

app.get('/api/admin/catalogue-access',
  requireAuth,
  asyncHandler(async (req, res) => {
    return res.json({
      isAdmin: await isCatalogueAdmin(req.user.id),
    });
  })
);

app.get('/api/admin/global-catalogue',
  requireAuth,
  requireCatalogueAdmin,
  asyncHandler(async (req, res) => {
    const products = await listAdminCatalogue({
      query: req.query.q || '',
    });

    return res.json({ products });
  })
);

app.post('/api/admin/global-catalogue',
  requireAuth,
  requireCatalogueAdmin,
  asyncHandler(async (req, res) => {
    try {
      const product = await saveGlobalCatalogueEntry({
        product: req.body || {},
        dataSource: req.body?.dataSource,
      });

      return res.status(201).json({ product });
    } catch (error) {
      if (error.message === 'INVALID_CATALOGUE_PRODUCT') {
        return res.status(400).json({
          error: 'Product name is required and must be under 180 characters',
        });
      }

      if (error.message === 'SOURCE_REQUIRED') {
        return res.status(400).json({
          error: 'A source note is required',
        });
      }

      throw error;
    }
  })
);

app.put('/api/admin/global-catalogue/:catalogueId',
  requireAuth,
  requireCatalogueAdmin,
  asyncHandler(async (req, res) => {
    try {
      const product = await saveGlobalCatalogueEntry({
        id: Number(req.params.catalogueId),
        product: req.body || {},
        dataSource: req.body?.dataSource,
      });

      return res.json({ product });
    } catch (error) {
      if (error.message === 'CATALOGUE_PRODUCT_NOT_FOUND') {
        return res.status(404).json({ error: 'Catalogue entry not found' });
      }

      if (error.message === 'INVALID_CATALOGUE_PRODUCT') {
        return res.status(400).json({
          error: 'Product name is required and must be under 180 characters',
        });
      }

      if (error.message === 'SOURCE_REQUIRED') {
        return res.status(400).json({
          error: 'A source note is required',
        });
      }

      throw error;
    }
  })
);

app.post('/api/admin/global-catalogue/:catalogueId/barcodes',
  requireAuth,
  requireCatalogueAdmin,
  asyncHandler(async (req, res) => {
    try {
      const barcode = await addGlobalBarcode({
        catalogueId: Number(req.params.catalogueId),
        barcode: req.body?.barcode,
        dataSource: req.body?.dataSource,
      });

      return res.status(201).json({ barcode });
    } catch (error) {
      if (error.message === 'CATALOGUE_PRODUCT_NOT_FOUND') {
        return res.status(404).json({ error: 'Catalogue entry not found' });
      }

      if (error.message === 'INVALID_BARCODE') {
        return res.status(400).json({
          error: 'Barcode must be a valid EAN-13, EAN-8, or UPC-A value',
        });
      }

      if (error.message === 'SOURCE_REQUIRED') {
        return res.status(400).json({ error: 'A source note is required' });
      }

      if (isDuplicateError(error)) {
        return res.status(409).json({
          error: 'This barcode has already been verified for another product',
        });
      }

      throw error;
    }
  })
);

app.post('/api/admin/global-catalogue/barcodes/:barcodeId/verify',
  requireAuth,
  requireCatalogueAdmin,
  asyncHandler(async (req, res) => {
    try {
      const barcode = await verifyGlobalBarcode({
        barcodeId: Number(req.params.barcodeId),
        sourceUrl: req.body?.sourceUrl,
      });

      return res.json({ barcode });
    } catch (error) {
      if (error.message === 'BARCODE_RECORD_NOT_FOUND') {
        return res.status(404).json({ error: 'Barcode record not found' });
      }

      if (error.message === 'INVALID_VERIFICATION_SOURCE') {
        return res.status(400).json({
          error: 'Verification evidence must be an HTTPS URL',
        });
      }

      if (isDuplicateError(error)) {
        return res.status(409).json({
          error: 'This barcode is already verified for another catalogue product',
        });
      }

      throw error;
    }
  })
);

// -----------------------------------------------------------------------------
// CSV import and export
// -----------------------------------------------------------------------------

app.post('/api/products/import-csv',
  requireAuth,
  requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      const summary = await importProductsCsv({
        businessId: Number(req.businessId),
        userId: req.user.id,
        csv: req.body?.csv,
      });

      return res.json({ summary });
    } catch (error) {
      if (error.message === 'INVALID_CSV') {
        return res.status(400).json({
          error: 'CSV is invalid, malformed, or too large',
        });
      }

      throw error;
    }
  })
);

app.get('/api/products/export.csv',
  requireAuth,
  requireBusinessAccess,
  asyncHandler(async (req, res) => {
    const csv = await exportProductsCsv({
      businessId: Number(req.businessId),
      userId: req.user.id,
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="workflowos-products.csv"'
    );

    return res.send(csv);
  })
);

// -----------------------------------------------------------------------------
// Sales
// -----------------------------------------------------------------------------

app.post('/api/sales', requireAuth, requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      const result = await createSale({
        businessId: Number(req.businessId),
        userId: req.user.id,
        payload: req.body || {},
        idempotencyKey: req.get('Idempotency-Key') || null,
      });

      return res
        .status(result.replayed ? 200 : 201)
        .json({
          sale: result.sale,
          replayed: result.replayed,
        });
    } catch (error) {
      if (error.message === 'INVALID_SALE') {
        return res.status(400).json({
          error: 'Sale must contain valid product quantities',
        });
      }

      if (error.message === 'INVALID_PRODUCT') {
        return res.status(400).json({
          error: 'A product is unavailable in this business',
        });
      }

      if (error.message === 'INVALID_CUSTOMER') {
        return res.status(400).json({
          error: 'Customer is unavailable in this business',
        });
      }

      if (error.message === 'INSUFFICIENT_STOCK') {
        return res.status(409).json({
          error: 'Not enough stock to complete this sale',
        });
      }

      if (error.message === 'FORBIDDEN') {
        return res.status(403).json({ error: 'Forbidden' });
      }

      throw error;
    }
  })
);

app.post('/api/sales/:saleId/refund',
  requireAuth,
  requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      const sale = await refundSale({
        businessId: Number(req.businessId),
        saleId: Number(req.params.saleId),
      });

      return res.json({ sale });
    } catch (error) {
      if (error.message === 'SALE_NOT_FOUND') {
        return res.status(404).json({ error: 'Sale not found' });
      }

      if (error.message === 'SALE_NOT_REFUNDABLE') {
        return res.status(409).json({
          error: 'Sale is not eligible for refund',
        });
      }

      throw error;
    }
  })
);

// -----------------------------------------------------------------------------
// Customers
// -----------------------------------------------------------------------------

app.get('/api/customers', requireAuth, requireBusinessAccess,
  asyncHandler(async (req, res) => {
    const customers = await getCustomersForBusiness(
      Number(req.businessId)
    );

    return res.json({ customers });
  })
);

app.post('/api/customers', requireAuth, requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      const customer = await createCustomer({
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
        return res.status(400).json({
          error: 'Customer name is required',
        });
      }

      throw error;
    }
  })
);

// -----------------------------------------------------------------------------
// Logout
// -----------------------------------------------------------------------------

app.post('/api/logout', requireAuth,
  asyncHandler(async (req, res) => {
    const token = getToken(req);

    if (token) {
      await db.execute(
        'DELETE FROM sessions WHERE id = ?',
        [token]
      );
    }

    return res.json({ ok: true });
  })
);

// -----------------------------------------------------------------------------
// Frontend fallback
// -----------------------------------------------------------------------------

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// -----------------------------------------------------------------------------
// Error handler
// -----------------------------------------------------------------------------

app.use((error, req, res, next) => {
  console.error('API error:', error);

  if (res.headersSent) {
    return next(error);
  }

  return res.status(500).json({
    error: 'An unexpected server error occurred',
  });
});

// -----------------------------------------------------------------------------
// Server startup
// -----------------------------------------------------------------------------

function startServer(port = PORT) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      const actualPort = server.address().port;

      console.log(
        `WorkflowOS listening on http://localhost:${actualPort}`
      );

      resolve(server);
    });

    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        const nextPort = Number(port) + 1;

        console.warn(
          `Port ${port} is busy. Retrying on ${nextPort}`
        );

        server.close();
        resolve(startServer(nextPort));
        return;
      }

      reject(error);
    });
  });
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error('Unable to start WorkflowOS:', error);
    process.exit(1);
  });
}

module.exports = app;
module.exports.app = app;
module.exports.startServer = startServer;
