
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
const expenseService = require('./src/api/expenses.service');
const invoiceService = require('./src/api/invoices.service');
const receivablesService = require('./src/api/accounts-receivable.service');
const payablesService = require('./src/api/accounts-payable.service');
const financialDocuments = require('./src/api/financial-documents.service');
const invoiceEmailService = require('./src/api/invoice-email.service');
const extractionService = require('./src/api/document-extraction.service');
const { makeInvoicePdf } = require('./src/api/invoice-pdf.service');
const {
  makeCreditNotePdf,
  makeReceiptPdf,
  makeStatementPdf,
} = require('./src/api/financial-pdf.service');
const reportsService = require('./src/api/reports.service');
const employeesService = require('./src/api/employees.service');
const contactService = require('./src/api/contact.service');
const peopleWorkflows = require('./src/api/people-workflows.service');
const payrollRules = require('./src/api/payroll-rules.service');
const payrollRuns = require('./src/api/payroll-runs.service');
const payrollPayments = require('./src/api/payroll-payments.service');
const payrollAccess = require('./src/api/payroll-access.service');
const { makePayslipPdf } = require('./src/api/payroll-pdf.service');

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

function peopleWorkflowRoute(handler, status = 200) {
  return asyncHandler(async (req, res) => {
    try {
      return res.status(status).json(await handler(req));
    } catch (error) {
      const response = handlePeopleWorkflowError(error, res);
      if (response) return response;
      throw error;
    }
  });
}

function handleExpenseError(error, res) {
  const responses = {
    FORBIDDEN: [403, 'Forbidden'],
    INVALID_EXPENSE: [400, 'Expense details are invalid'],
    INVALID_EXPENSE_FILTER: [400, 'Expense filters are invalid'],
    INVALID_DATE_RANGE: [400, 'Invalid date range'],
    INVALID_CATEGORY: [400, 'Category details are invalid'],
    INVALID_SUPPLIER: [400, 'Supplier details are invalid'],
    INVALID_PAYMENT: [400, 'Payment details are invalid'],
    INVALID_RECURRING_EXPENSE: [400, 'Recurring expense details are invalid'],
    RECURRING_GENERATION_LIMIT: [409, 'Too many recurring expenses are due; generate them in smaller batches'],
    INVALID_BUSINESS: [404, 'Business not found'],
    CATEGORY_EXISTS: [409, 'A category with this name already exists'],
    CATEGORY_NOT_FOUND: [404, 'Expense category not found'],
    EXPENSE_NOT_FOUND: [404, 'Expense not found'],
    EXPENSE_NOT_EDITABLE: [409, 'This expense cannot be edited'],
    EXPENSE_NOT_CANCELLABLE: [409, 'Only unpaid expenses can be cancelled'],
    EXPENSE_LINKED_TO_SUPPLIER_INVOICE: [409, 'Manage this expense through its linked supplier invoice'],
    IDEMPOTENCY_CONFLICT: [409, 'The payment key was already used for a different payment'],
    EXPENSE_NOT_PAYABLE: [409, 'This expense cannot accept payments'],
    PAYMENT_EXCEEDS_BALANCE: [409, 'Payment exceeds the outstanding balance'],
    RECURRING_EXPENSE_NOT_FOUND: [404, 'Recurring expense not found'],
  };
  const response = responses[error.message];
  return response
    ? res.status(response[0]).json({ error: response[1] })
    : null;
}

function handleInvoiceError(error, res) {
  if (error.message.startsWith('EMAIL_PROVIDER_REJECTED:')) {
    return res.status(502).json({ error: 'The email provider did not accept the message' });
  }
  const responses = {
    FORBIDDEN: [403, 'Forbidden'],
    INVALID_BUSINESS: [404, 'Business not found'],
    INVALID_CUSTOMER: [400, 'Select a customer from this business'],
    INVALID_PRODUCT: [400, 'Select an active product from this business'],
    INVALID_INVOICE: [400, 'Invoice details are invalid'],
    INVALID_INVOICE_SETTINGS: [400, 'Invoice numbering settings are invalid'],
    BUSINESS_LOGO_NOT_FOUND: [409, 'The configured business logo is no longer available'],
    INVALID_CREDIT_NOTE: [400, 'Credit note details are invalid'],
    INVALID_CREDIT_ITEM: [400, 'Select an item from the original invoice'],
    INVOICE_NOT_CREDITABLE: [409, 'This invoice cannot be credited'],
    NO_CREDITABLE_BALANCE: [409, 'The invoice has no remaining creditable balance'],
    CREDIT_EXCEEDS_ITEM: [409, 'Credit quantity exceeds the remaining invoice item quantity'],
    CREDIT_EXCEEDS_BALANCE: [409, 'Credit exceeds the remaining receivable balance'],
    SEQUENCE_EXHAUSTED: [409, 'Financial document numbering sequence is exhausted'],
    INVALID_CUSTOMER_EMAIL: [400, 'A valid customer email address is required'],
    INVOICE_NOT_SENDABLE: [409, 'Only issued invoices can be emailed'],
    EMAIL_NOT_CONFIGURED: [503, 'Email delivery is not configured. Set RESEND_API_KEY and EMAIL_FROM.'],
    EMAIL_PROVIDER_REJECTED: [502, 'The email provider did not accept the message'],
    EMAIL_DELIVERY_FAILED: [502, 'The email provider could not accept the message'],
    EMAIL_RETRY_LIMIT: [429, 'Email retry limit reached for this invoice and recipient'],
    RECEIPT_NOT_FOUND: [404, 'Payment receipt not found'],
    INVALID_STATEMENT_RANGE: [400, 'Statement date range is invalid'],
    INVALID_INVOICE_FILTER: [400, 'Invoice filters are invalid'],
    INVALID_PAYMENT: [400, 'Payment details are invalid'],
    INVOICE_NOT_FOUND: [404, 'Invoice not found'],
    INVOICE_NOT_EDITABLE: [409, 'Only draft invoices can be edited'],
    INVOICE_NOT_ISSUABLE: [409, 'Only draft invoices can be issued'],
    INVOICE_NOT_CANCELLABLE: [409, 'This invoice cannot be cancelled'],
    INVOICE_NOT_PAYABLE: [409, 'This invoice cannot accept payments'],
    PAYMENT_EXCEEDS_BALANCE: [409, 'Payment exceeds the outstanding balance'],
    IDEMPOTENCY_CONFLICT: [409, 'The payment key was already used for a different payment'],
    INVOICE_SEQUENCE_EXHAUSTED: [409, 'Invoice numbering sequence is exhausted'],
  };
  const response = responses[error.message];
  return response
    ? res.status(response[0]).json({ error: response[1] })
    : null;
}

function handlePayablesError(error, res) {
  const responses = {
    FORBIDDEN: [403, 'Forbidden'],
    INVALID_SUPPLIER: [400, 'Select an active supplier from this business'],
    INVALID_PRODUCT: [400, 'Select an active product from this business'],
    INVALID_SUPPLIER_INVOICE: [400, 'Supplier invoice details are invalid'],
    INVALID_SUPPLIER_INVOICE_FILTER: [400, 'Supplier invoice filters are invalid'],
    SUPPLIER_INVOICE_DUPLICATE: [409, 'This supplier invoice number already exists for the supplier'],
    MATCHING_EXPENSE_EXISTS: [409, 'An expense already uses this supplier invoice reference; link the existing expense'],
    INVALID_SUPPLIER_PAYMENT: [400, 'Supplier payment details are invalid'],
    SUPPLIER_INVOICE_NOT_FOUND: [404, 'Supplier invoice not found'],
    SUPPLIER_INVOICE_ALREADY_LINKED: [409, 'This supplier invoice is already linked to an expense'],
    SUPPLIER_INVOICE_ALREADY_PAID: [409, 'Linking must happen before supplier payments are recorded'],
    SUPPLIER_INVOICE_NOT_PAYABLE: [409, 'This supplier invoice cannot accept payments'],
    EXPENSE_NOT_FOUND: [404, 'Expense not found'],
    INVALID_EXPENSE: [400, 'Expense details are invalid'],
    EXPENSE_LINK_MISMATCH: [409, 'The expense must match the supplier, invoice total and have no existing payments'],
    PAYMENT_EXCEEDS_BALANCE: [409, 'Payment exceeds the outstanding balance'],
    IDEMPOTENCY_CONFLICT: [409, 'The idempotency key was already used for a different operation'],
    INVALID_STOCK_RECEIPT: [400, 'Stock receipt details are invalid'],
    INVALID_STOCK_RECEIPT_ITEM: [400, 'Only invoice product lines linked to business products can be received into stock'],
    RECEIPT_EXCEEDS_ORDERED: [409, 'Received quantity exceeds the remaining quantity on the supplier invoice'],
    INVALID_STATEMENT_RANGE: [400, 'Statement date range is invalid'],
  };
  const response = responses[error.message];
  return response
    ? res.status(response[0]).json({ error: response[1] })
    : null;
}

function handleEmployeeError(error, res) {
  if (isDuplicateError(error)) {
    return res.status(409).json({ error: 'An employee with this number already exists in this business' });
  }
  const responses = {
    FORBIDDEN: [403, 'Only the business owner can access employee and compensation records'],
    INVALID_EMPLOYEE: [400, 'Employee details are invalid'],
    INVALID_EMPLOYEE_FILTER: [400, 'Employee filters are invalid'],
    INVALID_COMPENSATION: [400, 'Compensation details are invalid'],
    INVALID_BUSINESS: [404, 'Business not found'],
    EMPLOYEE_NOT_FOUND: [404, 'Employee not found'],
    COMPENSATION_PERIOD_OVERLAP: [409, 'Compensation periods cannot overlap or start on the same date'],
  };
  const response = responses[error.message];
  return response ? res.status(response[0]).json({ error: response[1] }) : null;
}

function handlePeopleWorkflowError(error, res) {
  if (isDuplicateError(error)) {
    return res.status(409).json({ error: 'This record or idempotency key already exists' });
  }
  const responses = {
    FORBIDDEN: [403, 'Only the business owner can manage timesheets and leave records'],
    INVALID_EMPLOYEE: [400, 'Employee selection is invalid'],
    EMPLOYEE_NOT_FOUND: [404, 'Employee not found'],
    INVALID_ATTENDANCE: [400, 'Attendance details or date range are invalid'],
    INVALID_ATTENDANCE_FILTER: [400, 'Attendance filters are invalid'],
    INVALID_ATTENDANCE_ADJUSTMENT: [400, 'Attendance adjustment details are invalid'],
    ATTENDANCE_NOT_FOUND: [404, 'Attendance record not found'],
    ATTENDANCE_IMMUTABLE: [409, 'Approved attendance cannot be edited; create a controlled correction'],
    ATTENDANCE_UNCHANGED: [409, 'The adjusted value is unchanged'],
    INVALID_ATTENDANCE_REVIEW: [400, 'Attendance review details are invalid'],
    ATTENDANCE_NOT_REVIEWABLE: [409, 'Only submitted attendance can be reviewed'],
    INVALID_LEAVE_TYPE: [400, 'Leave type details are invalid'],
    LEAVE_TYPE_NOT_FOUND: [404, 'Leave type not found'],
    INVALID_LEAVE_BALANCE: [400, 'Leave balance adjustment details are invalid'],
    INVALID_LEAVE_REQUEST: [400, 'Leave request details are invalid'],
    LEAVE_REQUEST_NOT_FOUND: [404, 'Leave request not found'],
    LEAVE_REQUEST_NOT_REVIEWABLE: [409, 'Only pending leave requests can be reviewed'],
    INVALID_LEAVE_REVIEW: [400, 'Leave review details are invalid'],
    LEAVE_DATES_OVERLAP: [409, 'This employee already has pending or approved leave on those dates'],
    LEAVE_BALANCE_INSUFFICIENT: [409, 'The employee has insufficient leave balance and no authorised override was supplied'],
    INVALID_PAYROLL_RULE_SET: [400, 'The statutory rule set or PAYE bands are invalid'],
    PAYROLL_RULE_DATE_OVERLAP: [409, 'A statutory rule set already covers part of these effective dates'],
    PAYROLL_CURRENCY_NOT_ZAR: [400, 'South African statutory rules require a ZAR business currency'],
    INVALID_PAYROLL_RUN: [400, 'Payroll runs must cover a full calendar month with a valid pay date'],
    INVALID_PAYROLL_RUN_LINES: [400, 'Gross pay inputs must include exactly one valid line for each eligible employee'],
    PAYROLL_RULE_SET_MISSING: [409, 'No complete statutory rule set covers the payroll period'],
    PAYROLL_NET_NEGATIVE: [409, 'Deductions exceed gross pay for at least one employee'],
    PAYROLL_RUN_NOT_FOUND: [404, 'Payroll run not found'],
    INVALID_PAYROLL_RUN_TRANSITION: [400, 'Payroll run transition is invalid'],
    PAYROLL_RUN_NOT_TRANSITIONABLE: [409, 'Payroll run cannot move to that status'],
    EMPLOYEE_EMAIL_REQUIRED: [400, 'Add a valid employee email before inviting them to the portal'],
    EMPLOYEE_PORTAL_ALREADY_LINKED: [409, 'This employee already has portal access or this account is linked elsewhere'],
    INVALID_EMPLOYEE_PORTAL_ACTIVATION: [400, 'The activation token or password is invalid'],
    EMPLOYEE_PORTAL_INVITATION_INVALID: [410, 'This employee portal invitation is invalid or expired'],
    EMPLOYEE_PORTAL_ACCOUNT_EXISTS: [409, 'An account already exists; use its current password to accept the invitation'],
    INVALID_PAYROLL_PAYMENT: [400, 'Payment details are invalid'],
    PAYROLL_RUN_NOT_PAYABLE: [409, 'Payments can only be recorded for finalized payroll runs'],
    PAYROLL_PAYMENT_KEY_CONFLICT: [409, 'This payment request key has already been used for different details'],
    PAYROLL_PAYMENT_EXCEEDS_BALANCE: [409, "The payment exceeds the employee's remaining net pay"],
    PAYROLL_RUN_LINE_NOT_FOUND: [404, 'Payroll employee line not found'],
  };
  const response = responses[error.message];
  return response ? res.status(response[0]).json({ error: response[1] }) : null;
}

function handleContactError(error, res) {
  const responses = {
    CONTACT_SPAM: [400, 'The contact form could not be processed'],
    INVALID_CONTACT_MESSAGE: [400, 'Enter a name, valid email address, subject and message'],
    CONTACT_NOT_CONFIGURED: [503, 'Contact delivery is not configured'],
    CONTACT_RATE_LIMITED: [429, 'Too many messages were submitted. Try again later.'],
    CONTACT_DELIVERY_FAILED: [502, 'The email provider could not accept your message'],
  };
  const response = responses[error.message];
  return response ? res.status(response[0]).json({ error: response[1] }) : null;
}

function handleDocumentError(error, res) {
  const responses = {
    FORBIDDEN: [403, 'Forbidden'],
    INVALID_DOCUMENT: [400, 'File is invalid or does not match an allowed file type'],
    INVALID_DOCUMENT_FILTER: [400, 'Document search filters are invalid'],
    DOCUMENT_RECORD_NOT_FOUND: [404, 'Related financial record not found'],
    DOCUMENT_RECORD_MISMATCH: [400, 'Document links must refer to the same supplier invoice and expense'],
    DOCUMENT_ALREADY_LINKED: [409, 'This file is already attached to another financial record'],
    DOCUMENT_NOT_FOUND: [404, 'Document not found'],
    PRIVATE_STORAGE_CONFIGURATION_INVALID: [500, 'Private document storage is not configured safely'],
    DOCUMENT_STORAGE_INTEGRITY_ERROR: [500, 'Stored document integrity check failed'],
    EXTRACTION_NOT_CONFIGURED: [503, 'Document extraction is not configured'],
    EXTRACTION_CONFIGURATION_INCOMPLETE: [503, 'Document extraction configuration is incomplete'],
    EXTRACTION_CONFIGURATION_INVALID: [503, 'Document extraction requires a valid HTTPS provider URL'],
    EXTRACTION_CONSENT_REQUIRED: [400, 'Explicit consent is required before external document processing'],
    DOCUMENT_NOT_EXTRACTABLE: [400, 'This document type cannot be sent for extraction'],
    EXTRACTION_PROVIDER_FAILED: [502, 'The document extraction provider did not complete the request'],
    EXTRACTION_RESPONSE_INVALID: [502, 'The extraction provider returned invalid suggestions'],
    INVALID_EXTRACTION_CONFIRMATION: [400, 'Review confirmation must be true or false'],
    EXTRACTION_SUGGESTION_NOT_FOUND: [404, 'Extraction suggestion not found'],
  };
  const response = responses[error.message];
  return response
    ? res.status(response[0]).json({ error: response[1] })
    : null;
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

app.post('/api/contact', asyncHandler(async (req, res) => {
  try {
    const result = await contactService.submitContact(req.body || {}, req.ip);
    return res.status(202).json({ accepted: true, provider: result.provider });
  } catch (error) {
    const response = handleContactError(error, res);
    if (response) return response;
    throw error;
  }
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
          isOwner: Number(activeBusiness.owner_user_id) === Number(req.user.id),
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
        userId: req.user.id,
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
// Expenses
// -----------------------------------------------------------------------------

app.get('/api/invoices/settings', requireAuth, requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      return res.json({
        settings: await invoiceService.getInvoiceSettings(
          Number(req.businessId),
          req.user.id
        ),
      });
    } catch (error) {
      const response = handleInvoiceError(error, res);
      if (response) return response;
      throw error;
    }
  })
);

app.put('/api/invoices/settings', requireAuth, requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      return res.json({
        settings: await invoiceService.updateInvoiceSettings({
          businessId: Number(req.businessId),
          userId: req.user.id,
          numberPrefix: req.body?.numberPrefix,
          payload: req.body || {},
        }),
      });
    } catch (error) {
      const response = handleInvoiceError(error, res);
      if (response) return response;
      throw error;
    }
  })
);

app.get('/api/invoices', requireAuth, requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      return res.json({
        ...await invoiceService.listInvoices({
          businessId: Number(req.businessId),
          userId: req.user.id,
          filters: req.query,
        }),
      });
    } catch (error) {
      const response = handleInvoiceError(error, res);
      if (response) return response;
      throw error;
    }
  })
);

app.post('/api/invoices', requireAuth, requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      const invoice = await invoiceService.createDraft({
        businessId: Number(req.businessId),
        userId: req.user.id,
        payload: req.body || {},
      });
      return res.status(201).json({ invoice });
    } catch (error) {
      const response = handleInvoiceError(error, res);
      if (response) return response;
      throw error;
    }
  })
);

app.get('/api/invoices/:invoiceId(\\d+)', requireAuth, requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      const invoice = await invoiceService.getInvoice({
        businessId: Number(req.businessId),
        userId: req.user.id,
        invoiceId: Number(req.params.invoiceId),
      });
      if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
      return res.json({ invoice });
    } catch (error) {
      const response = handleInvoiceError(error, res);
      if (response) return response;
      throw error;
    }
  })
);

app.get('/api/invoices/:invoiceId(\\d+)/pdf',
  requireAuth,
  requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      const businessId = Number(req.businessId);
      const invoice = await invoiceService.getInvoice({
        businessId,
        userId: req.user.id,
        invoiceId: Number(req.params.invoiceId),
      });
      if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
      const business = await queryOne(
        `SELECT b.name, b.currency, s.contact_email, s.phone, s.address
         FROM businesses b
         LEFT JOIN business_settings s ON s.business_id = b.id
         WHERE b.id = ?`,
        [businessId]
      );
      if (!business) return res.status(404).json({ error: 'Business not found' });
      const settings = await invoiceService.getInvoiceSettings(businessId, req.user.id);
      let logoBuffer = null;
      if (settings.logoDocumentId) {
        const logo = await financialDocuments.readDocument({
          businessId,
          userId: req.user.id,
          documentId: settings.logoDocumentId,
        });
        if (!logo) throw new Error('BUSINESS_LOGO_NOT_FOUND');
        logoBuffer = logo.buffer;
      }
      const pdf = await makeInvoicePdf({
        invoice,
        business: {
          ...business,
          payment_instructions: settings.paymentInstructions,
          bank_account_name: settings.bankAccountName,
          bank_name: settings.bankName,
          bank_account_number: settings.bankAccountNumber,
          bank_branch_code: settings.bankBranchCode,
          bank_account_type: settings.bankAccountType,
          logoBuffer,
        },
      });
      const filename = encodeURIComponent(invoice.invoice_number || `draft-${invoice.id}`);
      res.set({
        'Cache-Control': 'private, no-store',
        'Content-Disposition': `attachment; filename="invoice-${filename}.pdf"`,
        'Content-Type': 'application/pdf',
        'X-Content-Type-Options': 'nosniff',
      });
      return res.status(200).send(pdf);
    } catch (error) {
      const response = handleInvoiceError(error, res);
      if (response) return response;
      throw error;
    }
  })
);

app.put('/api/invoices/:invoiceId(\\d+)', requireAuth, requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      return res.json({
        invoice: await invoiceService.updateDraft({
          businessId: Number(req.businessId),
          userId: req.user.id,
          invoiceId: Number(req.params.invoiceId),
          payload: req.body || {},
        }),
      });
    } catch (error) {
      const response = handleInvoiceError(error, res);
      if (response) return response;
      throw error;
    }
  })
);

app.post('/api/invoices/:invoiceId(\\d+)/issue', requireAuth, requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      return res.json({
        invoice: await invoiceService.issueInvoice({
          businessId: Number(req.businessId),
          userId: req.user.id,
          invoiceId: Number(req.params.invoiceId),
        }),
      });
    } catch (error) {
      const response = handleInvoiceError(error, res);
      if (response) return response;
      throw error;
    }
  })
);

app.post('/api/invoices/:invoiceId(\\d+)/cancel', requireAuth, requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      return res.json({
        invoice: await invoiceService.cancelInvoice({
          businessId: Number(req.businessId),
          userId: req.user.id,
          invoiceId: Number(req.params.invoiceId),
        }),
      });
    } catch (error) {
      const response = handleInvoiceError(error, res);
      if (response) return response;
      throw error;
    }
  })
);

app.get('/api/invoices/:invoiceId(\\d+)/payments',
  requireAuth,
  requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      const invoice = await invoiceService.getInvoice({
        businessId: Number(req.businessId),
        userId: req.user.id,
        invoiceId: Number(req.params.invoiceId),
      });
      if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
      return res.json({ payments: invoice.payments });
    } catch (error) {
      const response = handleInvoiceError(error, res);
      if (response) return response;
      throw error;
    }
  })
);

app.post('/api/invoices/:invoiceId(\\d+)/payments',
  requireAuth,
  requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      const result = await invoiceService.recordPayment({
        businessId: Number(req.businessId),
        userId: req.user.id,
        invoiceId: Number(req.params.invoiceId),
        payload: req.body || {},
        idempotencyKey: req.get('Idempotency-Key'),
      });
      return res.status(result.replayed ? 200 : 201).json(result);
    } catch (error) {
      const response = handleInvoiceError(error, res);
      if (response) return response;
      throw error;
    }
  })
);

app.post('/api/invoices/:invoiceId(\\d+)/email',
  requireAuth,
  requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      const result = await invoiceEmailService.sendInvoiceEmail({
        businessId: Number(req.businessId),
        userId: req.user.id,
        invoiceId: Number(req.params.invoiceId),
      });
      return res.json({ email: result });
    } catch (error) {
      const response = handleInvoiceError(error, res);
      if (response) return response;
      throw error;
    }
  })
);

app.get('/api/invoices/:invoiceId(\\d+)/email-logs',
  requireAuth,
  requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      return res.json({
        emailLogs: await invoiceEmailService.listInvoiceEmailLogs({
          businessId: Number(req.businessId),
          userId: req.user.id,
          invoiceId: Number(req.params.invoiceId),
        }),
      });
    } catch (error) {
      const response = handleInvoiceError(error, res);
      if (response) return response;
      throw error;
    }
  })
);

app.post('/api/invoices/:invoiceId(\\d+)/credit-notes',
  requireAuth,
  requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      const creditNote = await receivablesService.createCreditNote({
        businessId: Number(req.businessId),
        userId: req.user.id,
        invoiceId: Number(req.params.invoiceId),
        payload: req.body || {},
      });
      return res.status(201).json({ creditNote });
    } catch (error) {
      const response = handleInvoiceError(error, res);
      if (response) return response;
      throw error;
    }
  })
);

app.get('/api/credit-notes/:creditNoteId(\\d+)',
  requireAuth,
  requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      const creditNote = await receivablesService.getCreditNote({
        businessId: Number(req.businessId),
        userId: req.user.id,
        creditId: Number(req.params.creditNoteId),
      });
      if (!creditNote) return res.status(404).json({ error: 'Credit note not found' });
      return res.json({ creditNote });
    } catch (error) {
      const response = handleInvoiceError(error, res);
      if (response) return response;
      throw error;
    }
  })
);

app.get('/api/credit-notes/:creditNoteId(\\d+)/pdf',
  requireAuth,
  requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      const creditNote = await receivablesService.getCreditNote({
        businessId: Number(req.businessId),
        userId: req.user.id,
        creditId: Number(req.params.creditNoteId),
      });
      if (!creditNote) return res.status(404).json({ error: 'Credit note not found' });
      const pdf = await makeCreditNotePdf({ creditNote });
      res.set({
        'Cache-Control': 'private, no-store',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(creditNote.credit_number)}.pdf"`,
        'Content-Type': 'application/pdf',
        'X-Content-Type-Options': 'nosniff',
      });
      return res.send(pdf);
    } catch (error) {
      const response = handleInvoiceError(error, res);
      if (response) return response;
      throw error;
    }
  })
);

app.get('/api/invoice-payments/:paymentId(\\d+)/receipt.pdf',
  requireAuth,
  requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      const receipt = await receivablesService.getReceipt({
        businessId: Number(req.businessId),
        userId: req.user.id,
        paymentId: Number(req.params.paymentId),
      });
      if (!receipt) return res.status(404).json({ error: 'Payment receipt not found' });
      const pdf = await makeReceiptPdf({ receipt });
      res.set({
        'Cache-Control': 'private, no-store',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(receipt.receipt_number)}.pdf"`,
        'Content-Type': 'application/pdf',
        'X-Content-Type-Options': 'nosniff',
      });
      return res.send(pdf);
    } catch (error) {
      const response = handleInvoiceError(error, res);
      if (response) return response;
      throw error;
    }
  })
);

app.post('/api/invoice-payments/:paymentId(\\d+)/receipt-email',
  requireAuth,
  requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      return res.json({
        email: await invoiceEmailService.sendReceiptEmail({
          businessId: Number(req.businessId),
          userId: req.user.id,
          paymentId: Number(req.params.paymentId),
        }),
      });
    } catch (error) {
      const response = handleInvoiceError(error, res);
      if (response) return response;
      throw error;
    }
  })
);

app.get('/api/customers/:customerId(\\d+)/financial',
  requireAuth,
  requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      const financials = await receivablesService.getCustomerFinancials({
        businessId: Number(req.businessId),
        userId: req.user.id,
        customerId: Number(req.params.customerId),
      });
      if (!financials) return res.status(404).json({ error: 'Customer not found' });
      return res.json(financials);
    } catch (error) {
      const response = handleInvoiceError(error, res);
      if (response) return response;
      throw error;
    }
  })
);

app.get('/api/customers/:customerId(\\d+)/statement.csv',
  requireAuth,
  requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      const statement = await receivablesService.getCustomerStatement({
        businessId: Number(req.businessId),
        userId: req.user.id,
        customerId: Number(req.params.customerId),
        startDate: req.query.startDate,
        endDate: req.query.endDate,
      });
      if (!statement) return res.status(404).json({ error: 'Customer not found' });
      const business = await queryOne('SELECT currency FROM businesses WHERE id = ?', [req.businessId]);
      res.set({
        'Cache-Control': 'private, no-store',
        'Content-Disposition': `attachment; filename="customer-${statement.customer.id}-statement.csv"`,
        'Content-Type': 'text/csv; charset=utf-8',
      });
      return res.send(`\uFEFF${receivablesService.customerStatementCsv(statement, business.currency)}`);
    } catch (error) {
      const response = handleInvoiceError(error, res);
      if (response) return response;
      throw error;
    }
  })
);

app.get('/api/customers/:customerId(\\d+)/statement.pdf',
  requireAuth,
  requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      const statement = await receivablesService.getCustomerStatement({
        businessId: Number(req.businessId),
        userId: req.user.id,
        customerId: Number(req.params.customerId),
        startDate: req.query.startDate,
        endDate: req.query.endDate,
      });
      if (!statement) return res.status(404).json({ error: 'Customer not found' });
      const business = await queryOne(
        `SELECT b.name, b.currency, s.contact_email, s.phone, s.address
         FROM businesses b LEFT JOIN business_settings s ON s.business_id = b.id
         WHERE b.id = ?`,
        [req.businessId]
      );
      const pdf = await makeStatementPdf({ statement, business });
      res.set({
        'Cache-Control': 'private, no-store',
        'Content-Disposition': `attachment; filename="customer-${statement.customer.id}-statement.pdf"`,
        'Content-Type': 'application/pdf',
        'X-Content-Type-Options': 'nosniff',
      });
      return res.send(pdf);
    } catch (error) {
      const response = handleInvoiceError(error, res);
      if (response) return response;
      throw error;
    }
  })
);

app.get('/api/supplier-invoices/summary',
  requireAuth,
  requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      return res.json({
        summary: await payablesService.getPayablesSummary(
          Number(req.businessId),
          req.user.id
        ),
      });
    } catch (error) {
      const response = handlePayablesError(error, res);
      if (response) return response;
      throw error;
    }
  })
);

app.get('/api/supplier-invoices',
  requireAuth,
  requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      return res.json(await payablesService.listSupplierInvoices({
        businessId: Number(req.businessId),
        userId: req.user.id,
        filters: req.query,
      }));
    } catch (error) {
      const response = handlePayablesError(error, res);
      if (response) return response;
      throw error;
    }
  })
);

app.post('/api/supplier-invoices',
  requireAuth,
  requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      const supplierInvoice = await payablesService.createSupplierInvoice({
        businessId: Number(req.businessId),
        userId: req.user.id,
        payload: req.body || {},
      });
      return res.status(201).json({ supplierInvoice });
    } catch (error) {
      const response = handlePayablesError(error, res);
      if (response) return response;
      throw error;
    }
  })
);

app.get('/api/supplier-invoices/:supplierInvoiceId(\\d+)',
  requireAuth,
  requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      const supplierInvoice = await payablesService.getSupplierInvoice({
        businessId: Number(req.businessId),
        userId: req.user.id,
        supplierInvoiceId: Number(req.params.supplierInvoiceId),
      });
      if (!supplierInvoice) return res.status(404).json({ error: 'Supplier invoice not found' });
      return res.json({ supplierInvoice });
    } catch (error) {
      const response = handlePayablesError(error, res) || handleDocumentError(error, res);
      if (response) return response;
      throw error;
    }
  })
);

app.post('/api/supplier-invoices/:supplierInvoiceId(\\d+)/expense',
  requireAuth,
  requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      const result = await payablesService.linkSupplierInvoiceExpense({
        businessId: Number(req.businessId),
        userId: req.user.id,
        supplierInvoiceId: Number(req.params.supplierInvoiceId),
        payload: req.body || {},
      });
      return res.json(result);
    } catch (error) {
      const response = handlePayablesError(error, res);
      if (response) return response;
      throw error;
    }
  })
);

app.post('/api/supplier-invoices/:supplierInvoiceId(\\d+)/payments',
  requireAuth,
  requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      const result = await payablesService.recordSupplierPayment({
        businessId: Number(req.businessId),
        userId: req.user.id,
        supplierInvoiceId: Number(req.params.supplierInvoiceId),
        payload: req.body || {},
        idempotencyKey: req.get('Idempotency-Key'),
      });
      return res.status(result.replayed ? 200 : 201).json(result);
    } catch (error) {
      const response = handlePayablesError(error, res);
      if (response) return response;
      throw error;
    }
  })
);

app.post('/api/supplier-invoices/:supplierInvoiceId(\\d+)/stock-receipts',
  requireAuth,
  requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      const result = await payablesService.receiveSupplierStock({
        businessId: Number(req.businessId),
        userId: req.user.id,
        supplierInvoiceId: Number(req.params.supplierInvoiceId),
        payload: req.body || {},
        idempotencyKey: req.get('Idempotency-Key'),
      });
      return res.status(result.replayed ? 200 : 201).json(result);
    } catch (error) {
      const response = handlePayablesError(error, res);
      if (response) return response;
      throw error;
    }
  })
);

app.get('/api/suppliers/:supplierId(\\d+)/statement.csv',
  requireAuth,
  requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      const statement = await payablesService.getSupplierStatement({
        businessId: Number(req.businessId),
        userId: req.user.id,
        supplierId: Number(req.params.supplierId),
        startDate: req.query.startDate,
        endDate: req.query.endDate,
      });
      if (!statement) return res.status(404).json({ error: 'Supplier not found' });
      const business = await queryOne('SELECT currency FROM businesses WHERE id = ?', [req.businessId]);
      res.set({
        'Cache-Control': 'private, no-store',
        'Content-Disposition': `attachment; filename="supplier-${statement.supplier.id}-statement.csv"`,
        'Content-Type': 'text/csv; charset=utf-8',
      });
      return res.send(`\uFEFF${payablesService.supplierStatementCsv(statement, business.currency)}`);
    } catch (error) {
      const response = handlePayablesError(error, res);
      if (response) return response;
      throw error;
    }
  })
);

app.get('/api/suppliers/:supplierId(\\d+)/statement.pdf',
  requireAuth,
  requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      const statement = await payablesService.getSupplierStatement({
        businessId: Number(req.businessId),
        userId: req.user.id,
        supplierId: Number(req.params.supplierId),
        startDate: req.query.startDate,
        endDate: req.query.endDate,
      });
      if (!statement) return res.status(404).json({ error: 'Supplier not found' });
      const business = await queryOne(
        `SELECT b.name, b.currency, s.contact_email, s.phone, s.address
         FROM businesses b LEFT JOIN business_settings s ON s.business_id = b.id
         WHERE b.id = ?`,
        [req.businessId]
      );
      const pdf = await makeStatementPdf({
        statement,
        business,
        accountLabel: 'SUPPLIER STATEMENT',
        counterparty: statement.supplier,
      });
      res.set({
        'Cache-Control': 'private, no-store',
        'Content-Disposition': `attachment; filename="supplier-${statement.supplier.id}-statement.pdf"`,
        'Content-Type': 'application/pdf',
        'X-Content-Type-Options': 'nosniff',
      });
      return res.send(pdf);
    } catch (error) {
      const response = handlePayablesError(error, res);
      if (response) return response;
      throw error;
    }
  })
);

app.get('/api/financial-summary',
  requireAuth,
  requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      const businessId = Number(req.businessId);
      const [receivables, payables] = await Promise.all([
        receivablesService.getReceivablesSummary(businessId, req.user.id),
        payablesService.getPayablesSummary(businessId, req.user.id),
      ]);
      return res.json({ receivables, payables });
    } catch (error) {
      const response = handlePayablesError(error, res) || handleInvoiceError(error, res);
      if (response) return response;
      throw error;
    }
  })
);

const financialDocumentBody = express.raw({
  type: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
  limit: '10mb',
});

function getUploadFilename(req) {
  try {
    return decodeURIComponent(req.get('X-File-Name') || 'document');
  } catch {
    throw new Error('INVALID_DOCUMENT');
  }
}

app.get('/api/documents',
  requireAuth,
  requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      const documents = await financialDocuments.listDocuments({
        businessId: Number(req.businessId),
        supplierInvoiceId: req.query.supplierInvoiceId ? Number(req.query.supplierInvoiceId) : undefined,
        expenseId: req.query.expenseId ? Number(req.query.expenseId) : undefined,
        invoiceId: req.query.invoiceId ? Number(req.query.invoiceId) : undefined,
        documentType: req.query.documentType,
        search: req.query.search,
        startDate: req.query.startDate,
        endDate: req.query.endDate,
      });
      return res.json({ documents });
    } catch (error) {
      const response = handleDocumentError(error, res);
      if (response) return response;
      throw error;
    }
  })
);

app.post('/api/invoices/:invoiceId(\\d+)/documents',
  requireAuth,
  requireBusinessAccess,
  financialDocumentBody,
  asyncHandler(async (req, res) => {
    try {
      const result = await financialDocuments.uploadDocument({
        businessId: Number(req.businessId),
        userId: req.user.id,
        invoiceId: Number(req.params.invoiceId),
        documentType: 'supporting_document',
        originalFilename: getUploadFilename(req),
        mimeType: String(req.get('Content-Type') || '').split(';')[0].trim().toLowerCase(),
        buffer: req.body,
      });
      return res.status(result.duplicate ? 200 : 201).json({ document: result });
    } catch (error) {
      const response = handleDocumentError(error, res) || handleInvoiceError(error, res);
      if (response) return response;
      throw error;
    }
  })
);

app.post('/api/supplier-invoices/:supplierInvoiceId(\\d+)/documents',
  requireAuth,
  requireBusinessAccess,
  financialDocumentBody,
  asyncHandler(async (req, res) => {
    try {
      const result = await financialDocuments.uploadDocument({
        businessId: Number(req.businessId),
        userId: req.user.id,
        supplierInvoiceId: Number(req.params.supplierInvoiceId),
        expenseId: req.query.expenseId ? Number(req.query.expenseId) : null,
        documentType: 'supplier_invoice',
        originalFilename: getUploadFilename(req),
        mimeType: String(req.get('Content-Type') || '').split(';')[0].trim().toLowerCase(),
        buffer: req.body,
      });
      return res.status(result.duplicate ? 200 : 201).json({ document: result });
    } catch (error) {
      const response = handleDocumentError(error, res) || handlePayablesError(error, res);
      if (response) return response;
      throw error;
    }
  })
);

app.post('/api/expenses/:expenseId(\\d+)/documents',
  requireAuth,
  requireBusinessAccess,
  financialDocumentBody,
  asyncHandler(async (req, res) => {
    try {
      const linkedInvoice = await queryOne(
        `SELECT id FROM supplier_invoices
         WHERE business_id = ? AND expense_id = ?`,
        [req.businessId, req.params.expenseId]
      );
      const result = await financialDocuments.uploadDocument({
        businessId: Number(req.businessId),
        userId: req.user.id,
        supplierInvoiceId: linkedInvoice?.id || null,
        expenseId: Number(req.params.expenseId),
        documentType: 'expense_receipt',
        originalFilename: getUploadFilename(req),
        mimeType: String(req.get('Content-Type') || '').split(';')[0].trim().toLowerCase(),
        buffer: req.body,
      });
      return res.status(result.duplicate ? 200 : 201).json({ document: result });
    } catch (error) {
      const response = handleDocumentError(error, res);
      if (response) return response;
      throw error;
    }
  })
);

app.post('/api/business/invoice-logo',
  requireAuth,
  requireBusinessAccess,
  financialDocumentBody,
  asyncHandler(async (req, res) => {
    try {
      const result = await financialDocuments.uploadDocument({
        businessId: Number(req.businessId),
        userId: req.user.id,
        documentType: 'business_logo',
        originalFilename: getUploadFilename(req),
        mimeType: String(req.get('Content-Type') || '').split(';')[0].trim().toLowerCase(),
        buffer: req.body,
      });
      return res.status(result.duplicate ? 200 : 201).json({ document: result });
    } catch (error) {
      const response = handleDocumentError(error, res);
      if (response) return response;
      throw error;
    }
  })
);

app.get('/api/documents/:documentId(\\d+)/preview',
  requireAuth,
  requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      const result = await financialDocuments.readDocument({
        businessId: Number(req.businessId),
        userId: req.user.id,
        documentId: Number(req.params.documentId),
      });
      if (!result) return res.status(404).json({ error: 'Document not found' });
      res.set({
        'Cache-Control': 'private, no-store',
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(result.document.original_filename)}`,
        'Content-Type': result.document.mime_type,
        'Content-Security-Policy': "sandbox; default-src 'none';",
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'SAMEORIGIN',
      });
      return res.send(result.buffer);
    } catch (error) {
      const response = handleDocumentError(error, res);
      if (response) return response;
      throw error;
    }
  })
);

app.get('/api/documents/:documentId(\\d+)',
  requireAuth,
  requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      const result = await financialDocuments.readDocument({
        businessId: Number(req.businessId),
        userId: req.user.id,
        documentId: Number(req.params.documentId),
      });
      if (!result) return res.status(404).json({ error: 'Document not found' });
      res.set({
        'Cache-Control': 'private, no-store',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(result.document.original_filename)}`,
        'Content-Type': 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
      });
      return res.send(result.buffer);
    } catch (error) {
      const response = handleDocumentError(error, res);
      if (response) return response;
      throw error;
    }
  })
);

app.delete('/api/documents/:documentId(\\d+)',
  requireAuth,
  requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      return res.json(await financialDocuments.removeDocument({
        businessId: Number(req.businessId),
        userId: req.user.id,
        documentId: Number(req.params.documentId),
      }));
    } catch (error) {
      const response = handleDocumentError(error, res);
      if (response) return response;
      throw error;
    }
  })
);

app.get('/api/documents/extraction-status',
  requireAuth,
  requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      return res.json({
        extraction: extractionService.getProviderStatus(),
        requiresExplicitConsent: true,
        requiresHumanReview: true,
      });
    } catch (error) {
      const response = handleDocumentError(error, res);
      if (response) return response;
      throw error;
    }
  })
);

app.post('/api/documents/:documentId(\\d+)/extract',
  requireAuth,
  requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      return res.json({
        extraction: await extractionService.extractSuggestions({
          businessId: Number(req.businessId),
          userId: req.user.id,
          documentId: Number(req.params.documentId),
          consentToExternalProcessing: req.body?.consentToExternalProcessing,
        }),
      });
    } catch (error) {
      const response = handleDocumentError(error, res);
      if (response) return response;
      throw error;
    }
  })
);

app.post('/api/documents/:documentId(\\d+)/extractions/:suggestionId(\\d+)/confirm',
  requireAuth,
  requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      return res.json({
        extraction: await extractionService.confirmSuggestions({
          businessId: Number(req.businessId),
          userId: req.user.id,
          documentId: Number(req.params.documentId),
          suggestionId: Number(req.params.suggestionId),
          confirmed: req.body?.confirmed,
        }),
      });
    } catch (error) {
      const response = handleDocumentError(error, res);
      if (response) return response;
      throw error;
    }
  })
);

app.get('/api/employees', requireAuth, requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      return res.json(await employeesService.listEmployees({
        businessId: Number(req.businessId),
        userId: req.user.id,
        search: req.query.search,
        status: req.query.status,
        page: req.query.page,
        pageSize: req.query.pageSize,
      }));
    } catch (error) {
      const response = handleEmployeeError(error, res);
      if (response) return response;
      throw error;
    }
  })
);

app.post('/api/employees', requireAuth, requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      const employee = await employeesService.createEmployee({
        businessId: Number(req.businessId),
        userId: req.user.id,
        payload: req.body || {},
      });
      return res.status(201).json({ employee });
    } catch (error) {
      const response = handleEmployeeError(error, res);
      if (response) return response;
      throw error;
    }
  })
);

app.get('/api/employees/:employeeId(\\d+)', requireAuth, requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      const employee = await employeesService.getEmployee({
        businessId: Number(req.businessId),
        userId: req.user.id,
        employeeId: Number(req.params.employeeId),
      });
      if (!employee) return res.status(404).json({ error: 'Employee not found' });
      return res.json({ employee });
    } catch (error) {
      const response = handleEmployeeError(error, res);
      if (response) return response;
      throw error;
    }
  })
);

app.put('/api/employees/:employeeId(\\d+)', requireAuth, requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      const employee = await employeesService.updateEmployee({
        businessId: Number(req.businessId),
        userId: req.user.id,
        employeeId: Number(req.params.employeeId),
        payload: req.body || {},
      });
      return res.json({ employee });
    } catch (error) {
      const response = handleEmployeeError(error, res);
      if (response) return response;
      throw error;
    }
  })
);

app.post('/api/employees/:employeeId(\\d+)/compensation', requireAuth, requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      const employee = await employeesService.addCompensation({
        businessId: Number(req.businessId),
        userId: req.user.id,
        employeeId: Number(req.params.employeeId),
        payload: req.body || {},
      });
      return res.json({ employee });
    } catch (error) {
      const response = handleEmployeeError(error, res);
      if (response) return response;
      throw error;
    }
  })
);

app.post('/api/employees/:employeeId(\\d+)/portal-invitation', requireAuth, requireBusinessAccess,
  peopleWorkflowRoute(async (req) => ({
    invitation: await payrollAccess.createEmployeePortalInvitation({
      businessId: Number(req.businessId),
      userId: req.user.id,
      employeeId: Number(req.params.employeeId),
    }),
  }), 201)
);

app.delete('/api/employees/:employeeId(\\d+)/portal-access', requireAuth, requireBusinessAccess,
  peopleWorkflowRoute(async (req) => payrollAccess.revokeEmployeePortalAccess({
    businessId: Number(req.businessId),
    userId: req.user.id,
    employeeId: Number(req.params.employeeId),
  }))
);

app.post('/api/employee-portal/activate',
  peopleWorkflowRoute(async (req) => payrollAccess.activateEmployeePortal({
    token: req.body?.token,
    password: req.body?.password,
  }), 201)
);

app.get('/api/employee-portal/payslips', requireAuth,
  peopleWorkflowRoute(async (req) => ({
    payslips: await payrollAccess.listEmployeePayslips({ userId: req.user.id }),
  }))
);

app.get('/api/employee-portal/payslips/:runId(\\d+).pdf', requireAuth,
  asyncHandler(async (req, res) => {
    try {
      const payslip = await payrollAccess.getEmployeePayslip({
        userId: req.user.id,
        runId: Number(req.params.runId),
      });
      if (!payslip) return res.status(404).json({ error: 'Payslip not found' });
      const pdf = await makePayslipPdf({ payslip });
      return res.status(200)
        .type('application/pdf')
        .set('Cache-Control', 'private, no-store')
        .set('X-Content-Type-Options', 'nosniff')
        .set('Content-Disposition', `attachment; filename="payslip-${payslip.payroll_run_id}.pdf"`)
        .send(pdf);
    } catch (error) {
      const response = handlePeopleWorkflowError(error, res);
      if (response) return response;
      throw error;
    }
  })
);

app.get('/api/attendance', requireAuth, requireBusinessAccess,
  peopleWorkflowRoute((req) => peopleWorkflows.listAttendance({
    businessId: Number(req.businessId),
    userId: req.user.id,
    startDate: req.query.startDate,
    endDate: req.query.endDate,
    status: req.query.status,
    page: req.query.page,
    pageSize: req.query.pageSize,
  }))
);

app.post('/api/attendance', requireAuth, requireBusinessAccess,
  peopleWorkflowRoute(async (req) => ({
    attendance: await peopleWorkflows.createAttendance({
      businessId: Number(req.businessId),
      userId: req.user.id,
      payload: req.body || {},
    }),
  }), 201)
);

app.post('/api/attendance/:attendanceId(\\d+)/adjustments', requireAuth, requireBusinessAccess,
  peopleWorkflowRoute(async (req) => ({
    attendance: await peopleWorkflows.adjustAttendance({
      businessId: Number(req.businessId),
      userId: req.user.id,
      attendanceId: Number(req.params.attendanceId),
      payload: req.body || {},
    }),
  }))
);

app.post('/api/attendance/:attendanceId(\\d+)/review', requireAuth, requireBusinessAccess,
  peopleWorkflowRoute(async (req) => ({
    attendance: await peopleWorkflows.reviewAttendance({
      businessId: Number(req.businessId),
      userId: req.user.id,
      attendanceId: Number(req.params.attendanceId),
      payload: req.body || {},
    }),
  }))
);

app.get('/api/leave-types', requireAuth, requireBusinessAccess,
  peopleWorkflowRoute(async (req) => ({
    leaveTypes: await peopleWorkflows.listLeaveTypes({
      businessId: Number(req.businessId),
      userId: req.user.id,
    }),
  }))
);

app.post('/api/leave-types', requireAuth, requireBusinessAccess,
  peopleWorkflowRoute(async (req) => ({
    leaveType: await peopleWorkflows.createLeaveType({
      businessId: Number(req.businessId),
      userId: req.user.id,
      payload: req.body || {},
    }),
  }), 201)
);

app.put('/api/leave-types/:leaveTypeId(\\d+)/status', requireAuth, requireBusinessAccess,
  peopleWorkflowRoute(async (req) => ({
    leaveType: await peopleWorkflows.setLeaveTypeActive({
      businessId: Number(req.businessId),
      userId: req.user.id,
      leaveTypeId: Number(req.params.leaveTypeId),
      isActive: req.body?.isActive,
    }),
  }))
);

app.get('/api/employees/:employeeId(\\d+)/leave-balances', requireAuth, requireBusinessAccess,
  peopleWorkflowRoute(async (req) => ({
    balances: await peopleWorkflows.getLeaveBalances({
      businessId: Number(req.businessId),
      userId: req.user.id,
      employeeId: Number(req.params.employeeId),
    }),
  }))
);

app.post('/api/leave-balances', requireAuth, requireBusinessAccess,
  peopleWorkflowRoute(async (req) => ({
    balance: await peopleWorkflows.addLeaveBalance({
      businessId: Number(req.businessId),
      userId: req.user.id,
      payload: req.body || {},
    }),
  }), 201)
);

app.get('/api/leave-requests', requireAuth, requireBusinessAccess,
  peopleWorkflowRoute(async (req) => ({
    leaveRequests: await peopleWorkflows.listLeaveRequests({
      businessId: Number(req.businessId),
      userId: req.user.id,
      status: req.query.status,
    }),
  }))
);

app.post('/api/leave-requests', requireAuth, requireBusinessAccess,
  peopleWorkflowRoute(async (req) => ({
    leaveRequest: await peopleWorkflows.createLeaveRequest({
      businessId: Number(req.businessId),
      userId: req.user.id,
      payload: req.body || {},
    }),
  }), 201)
);

app.post('/api/leave-requests/:leaveRequestId(\\d+)/review', requireAuth, requireBusinessAccess,
  peopleWorkflowRoute(async (req) => ({
    leaveRequest: await peopleWorkflows.reviewLeaveRequest({
      businessId: Number(req.businessId),
      userId: req.user.id,
      leaveRequestId: Number(req.params.leaveRequestId),
      payload: req.body || {},
    }),
  }))
);

app.get('/api/payroll/rules', requireAuth, requireBusinessAccess,
  peopleWorkflowRoute(async (req) => ({
    ruleSets: await payrollRules.listRuleSets({
      businessId: Number(req.businessId),
      userId: req.user.id,
    }),
  }))
);

app.post('/api/payroll/rules', requireAuth, requireBusinessAccess,
  peopleWorkflowRoute(async (req) => ({
    ruleSet: await payrollRules.createRuleSet({
      businessId: Number(req.businessId),
      userId: req.user.id,
      payload: req.body || {},
    }),
  }), 201)
);

app.get('/api/payroll/runs', requireAuth, requireBusinessAccess,
  peopleWorkflowRoute(async (req) => ({
    runs: await payrollRuns.listRuns({
      businessId: Number(req.businessId),
      userId: req.user.id,
    }),
  }))
);

app.get('/api/payroll/runs/:runId(\\d+)', requireAuth, requireBusinessAccess,
  peopleWorkflowRoute(async (req) => {
    const run = await payrollRuns.getRun({
      businessId: Number(req.businessId),
      userId: req.user.id,
      runId: Number(req.params.runId),
    });
    if (!run) throw new Error('PAYROLL_RUN_NOT_FOUND');
    return { run };
  })
);

app.post('/api/payroll/runs', requireAuth, requireBusinessAccess,
  peopleWorkflowRoute(async (req) => ({
    run: await payrollRuns.createRun({
      businessId: Number(req.businessId),
      userId: req.user.id,
      payload: req.body || {},
    }),
  }), 201)
);

app.post('/api/payroll/runs/:runId(\\d+)/transition', requireAuth, requireBusinessAccess,
  peopleWorkflowRoute(async (req) => ({
    run: await payrollRuns.transitionRun({
      businessId: Number(req.businessId),
      userId: req.user.id,
      runId: Number(req.params.runId),
      decision: req.body?.decision,
    }),
  }))
);

app.post('/api/payroll/runs/:runId(\\d+)/payments', requireAuth, requireBusinessAccess,
  peopleWorkflowRoute(async (req) => payrollPayments.recordPayment({
    businessId: Number(req.businessId),
    userId: req.user.id,
    runId: Number(req.params.runId),
    payload: req.body || {},
  }), 201)
);

app.get('/api/payroll/runs/:runId(\\d+)/payments', requireAuth, requireBusinessAccess,
  peopleWorkflowRoute(async (req) => ({
    payments: await payrollPayments.listRunPayments({
      businessId: Number(req.businessId),
      userId: req.user.id,
      runId: Number(req.params.runId),
    }),
  }))
);

app.get('/api/payroll/runs/:runId(\\d+)/employees/:employeeId(\\d+)/payslip.pdf',
  requireAuth, requireBusinessAccess, asyncHandler(async (req, res) => {
    try {
      const payslip = await payrollAccess.getOwnerPayslip({
        businessId: Number(req.businessId),
        userId: req.user.id,
        runId: Number(req.params.runId),
        employeeId: Number(req.params.employeeId),
      });
      if (!payslip) return res.status(404).json({ error: 'Payslip not found' });
      const pdf = await makePayslipPdf({ payslip });
      return res.status(200)
        .type('application/pdf')
        .set('Cache-Control', 'private, no-store')
        .set('X-Content-Type-Options', 'nosniff')
        .set('Content-Disposition', `attachment; filename="payslip-${payslip.payroll_run_id}-${payslip.employee_id}.pdf"`)
        .send(pdf);
    } catch (error) {
      const response = handlePeopleWorkflowError(error, res);
      if (response) return response;
      throw error;
    }
  })
);

app.get('/api/expenses/categories', requireAuth, requireBusinessAccess,
  asyncHandler(async (req, res) => {
    return res.json({
      categories: await expenseService.getExpenseCategories(Number(req.businessId)),
    });
  })
);

app.post('/api/expenses/categories', requireAuth, requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      const category = await expenseService.createExpenseCategory({
        businessId: Number(req.businessId),
        userId: req.user.id,
        name: req.body?.name,
      });
      return res.status(201).json({ category });
    } catch (error) {
      const response = handleExpenseError(error, res);
      if (response) return response;
      throw error;
    }
  })
);

app.put('/api/expenses/categories/:categoryId(\\d+)',
  requireAuth,
  requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      const category = await expenseService.updateExpenseCategory({
        businessId: Number(req.businessId),
        userId: req.user.id,
        categoryId: Number(req.params.categoryId),
        name: req.body?.name,
        isActive: req.body?.isActive,
      });
      return res.json({ category });
    } catch (error) {
      const response = handleExpenseError(error, res);
      if (response) return response;
      throw error;
    }
  })
);

app.get('/api/expenses/suppliers', requireAuth, requireBusinessAccess,
  asyncHandler(async (req, res) => {
    return res.json({
      suppliers: await expenseService.getExpenseSuppliers(Number(req.businessId)),
    });
  })
);

app.post('/api/expenses/suppliers', requireAuth, requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      const supplier = await expenseService.createExpenseSupplier({
        businessId: Number(req.businessId),
        userId: req.user.id,
        payload: req.body || {},
      });
      return res.status(201).json({ supplier });
    } catch (error) {
      const response = handleExpenseError(error, res);
      if (response) return response;
      throw error;
    }
  })
);

app.get('/api/expenses/summary', requireAuth, requireBusinessAccess,
  asyncHandler(async (req, res) => {
    return res.json({
      summary: await expenseService.getExpenseSummary(Number(req.businessId)),
    });
  })
);

app.get('/api/expenses/recurring', requireAuth, requireBusinessAccess,
  asyncHandler(async (req, res) => {
    return res.json({
      recurringExpenses: await expenseService.getRecurringExpenses(
        Number(req.businessId)
      ),
    });
  })
);

app.post('/api/expenses/recurring', requireAuth, requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      const recurringExpense = await expenseService.createRecurringExpense({
        businessId: Number(req.businessId),
        userId: req.user.id,
        payload: req.body || {},
      });
      return res.status(201).json({ recurringExpense });
    } catch (error) {
      const response = handleExpenseError(error, res);
      if (response) return response;
      throw error;
    }
  })
);

app.put('/api/expenses/recurring/:recurringId(\\d+)',
  requireAuth,
  requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      const recurringExpense = await expenseService.updateRecurringExpense({
        businessId: Number(req.businessId),
        userId: req.user.id,
        recurringId: Number(req.params.recurringId),
        payload: req.body || {},
      });
      return res.json({ recurringExpense });
    } catch (error) {
      const response = handleExpenseError(error, res);
      if (response) return response;
      throw error;
    }
  })
);

app.post('/api/expenses/recurring/generate',
  requireAuth,
  requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      const result = await expenseService.generateDueRecurringExpenses({
        businessId: Number(req.businessId),
        userId: req.user.id,
      });
      return res.json(result);
    } catch (error) {
      const response = handleExpenseError(error, res);
      if (response) return response;
      throw error;
    }
  })
);

app.get('/api/expenses', requireAuth, requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      return res.json(await expenseService.listExpenses(
        Number(req.businessId),
        req.query
      ));
    } catch (error) {
      const response = handleExpenseError(error, res);
      if (response) return response;
      throw error;
    }
  })
);

app.post('/api/expenses', requireAuth, requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      const expense = await expenseService.createExpense({
        businessId: Number(req.businessId),
        userId: req.user.id,
        payload: req.body || {},
      });
      return res.status(201).json({ expense });
    } catch (error) {
      const response = handleExpenseError(error, res);
      if (response) return response;
      throw error;
    }
  })
);

app.get('/api/expenses/:expenseId(\\d+)', requireAuth, requireBusinessAccess,
  asyncHandler(async (req, res) => {
    const expense = await expenseService.getExpenseDetails(
      Number(req.businessId),
      Number(req.params.expenseId)
    );
    if (!expense) return res.status(404).json({ error: 'Expense not found' });
    return res.json({ expense });
  })
);

app.put('/api/expenses/:expenseId(\\d+)', requireAuth, requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      const expense = await expenseService.updateExpense({
        businessId: Number(req.businessId),
        userId: req.user.id,
        expenseId: Number(req.params.expenseId),
        payload: req.body || {},
      });
      return res.json({ expense });
    } catch (error) {
      const response = handleExpenseError(error, res);
      if (response) return response;
      throw error;
    }
  })
);

app.delete('/api/expenses/:expenseId(\\d+)', requireAuth, requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      const expense = await expenseService.cancelExpense({
        businessId: Number(req.businessId),
        userId: req.user.id,
        expenseId: Number(req.params.expenseId),
      });
      return res.json({ expense });
    } catch (error) {
      const response = handleExpenseError(error, res);
      if (response) return response;
      throw error;
    }
  })
);

app.get('/api/expenses/:expenseId(\\d+)/payments',
  requireAuth,
  requireBusinessAccess,
  asyncHandler(async (req, res) => {
    const payments = await expenseService.getExpensePayments(
      Number(req.businessId),
      Number(req.params.expenseId)
    );
    if (!payments) return res.status(404).json({ error: 'Expense not found' });
    return res.json({ payments });
  })
);

app.post('/api/expenses/:expenseId(\\d+)/payments',
  requireAuth,
  requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      const result = await expenseService.recordExpensePayment({
        businessId: Number(req.businessId),
        userId: req.user.id,
        expenseId: Number(req.params.expenseId),
        payload: req.body || {},
        idempotencyKey: req.get('Idempotency-Key'),
      });
      return res.status(result.replayed ? 200 : 201).json(result);
    } catch (error) {
      const response = handleExpenseError(error, res);
      if (response) return response;
      throw error;
    }
  })
);

// -----------------------------------------------------------------------------
// Reports
// -----------------------------------------------------------------------------

function getReportFilters(query) {
  return {
    period: query.period,
    startDate: query.startDate,
    endDate: query.endDate,
    customerId: query.customerId,
    supplierId: query.supplierId,
    status: query.status,
  };
}

function handleReportError(error, res) {
  if (error.message === 'INVALID_DATE_RANGE') {
    return res.status(400).json({ error: 'Invalid reporting date range' });
  }
  if (error.message === 'INVALID_REPORT_TYPE') {
    return res.status(400).json({ error: 'Invalid report type' });
  }
  if (error.message.startsWith('INVALID_RECEIVABLE') ||
      error.message.startsWith('INVALID_PAYABLE')) {
    return res.status(400).json({ error: 'Invalid financial report filter' });
  }
  if (error.message === 'FORBIDDEN') {
    return res.status(403).json({ error: 'Only the business owner can view payroll reports' });
  }
  if (error.message === 'INVALID_BUSINESS') {
    return res.status(404).json({ error: 'Business not found' });
  }
  return null;
}

app.get('/api/reports/overview', requireAuth, requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      return res.json(await reportsService.getReportsOverview(
        Number(req.businessId),
        getReportFilters(req.query)
      ));
    } catch (error) {
      const response = handleReportError(error, res);
      if (response) return response;
      throw error;
    }
  })
);

app.get('/api/reports/sales', requireAuth, requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      return res.json(await reportsService.getSalesReport(
        Number(req.businessId),
        getReportFilters(req.query)
      ));
    } catch (error) {
      const response = handleReportError(error, res);
      if (response) return response;
      throw error;
    }
  })
);

app.get('/api/reports/expenses', requireAuth, requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      return res.json(await reportsService.getExpensesReport(
        Number(req.businessId),
        getReportFilters(req.query)
      ));
    } catch (error) {
      const response = handleReportError(error, res);
      if (response) return response;
      throw error;
    }
  })
);

app.get('/api/reports/inventory', requireAuth, requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      return res.json(await reportsService.getInventoryReport(
        Number(req.businessId),
        getReportFilters(req.query)
      ));
    } catch (error) {
      const response = handleReportError(error, res);
      if (response) return response;
      throw error;
    }
  })
);

app.get('/api/reports/customers', requireAuth, requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      return res.json(await reportsService.getCustomersReport(
        Number(req.businessId),
        getReportFilters(req.query)
      ));
    } catch (error) {
      const response = handleReportError(error, res);
      if (response) return response;
      throw error;
    }
  })
);

app.get('/api/reports/receivables', requireAuth, requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      return res.json(await reportsService.getReceivablesReport(
        Number(req.businessId),
        getReportFilters(req.query)
      ));
    } catch (error) {
      const response = handleReportError(error, res);
      if (response) return response;
      throw error;
    }
  })
);

app.get('/api/reports/payables', requireAuth, requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      return res.json(await reportsService.getPayablesReport(
        Number(req.businessId),
        getReportFilters(req.query)
      ));
    } catch (error) {
      const response = handleReportError(error, res);
      if (response) return response;
      throw error;
    }
  })
);

app.get('/api/reports/payroll', requireAuth, requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      return res.json(await reportsService.getPayrollReport(
        Number(req.businessId),
        req.user.id,
        getReportFilters(req.query)
      ));
    } catch (error) {
      const response = handleReportError(error, res);
      if (response) return response;
      throw error;
    }
  })
);

app.get('/api/reports/activity', requireAuth, requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      return res.json(await reportsService.getActivityReport(
        Number(req.businessId),
        getReportFilters(req.query)
      ));
    } catch (error) {
      const response = handleReportError(error, res);
      if (response) return response;
      throw error;
    }
  })
);

app.get('/api/reports/:type(sales|expenses|inventory|customers|profit-loss|activity|receivables|payables|payroll).csv',
  requireAuth,
  requireBusinessAccess,
  asyncHandler(async (req, res) => {
    try {
      const csv = await reportsService.exportReportCsv(
        Number(req.businessId),
        req.params.type,
        getReportFilters(req.query),
        req.user.id
      );
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="workflowos-${req.params.type}-report.csv"`
      );
      return res.send(`\uFEFF${csv}`);
    } catch (error) {
      const response = handleReportError(error, res);
      if (response) return response;
      throw error;
    }
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

app.use('/api', (req, res) => res.status(404).json({ error: 'API endpoint not found' }));

app.get('/employee-portal', (req, res) => {
  res.set('Cache-Control', 'no-store')
    .set('Referrer-Policy', 'no-referrer')
    .sendFile(path.join(__dirname, 'public', 'employee-portal.html'));
});

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

  if (error.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Uploaded document exceeds the 10 MB limit' });
  }
  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Request body is invalid' });
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
