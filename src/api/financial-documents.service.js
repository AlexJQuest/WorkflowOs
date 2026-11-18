const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const db = require('./database');

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MIME_TYPES = new Map([
  ['application/pdf', '.pdf'],
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
]);

async function getOne(sql, params = [], connection = db) {
  const [rows] = await connection.execute(sql, params);
  return rows[0] || null;
}

async function execute(sql, params = [], connection = db) {
  const [result] = await connection.execute(sql, params);
  return result;
}

function getPrivateRoot() {
  return path.resolve(
    process.env.WORKFLOWOS_PRIVATE_STORAGE_DIR || path.join(__dirname, '..', '..', 'private-documents')
  );
}

async function assertPrivateStorageRoot() {
  const root = getPrivateRoot();
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const [realRoot, realPublic] = await Promise.all([
    fs.realpath(root),
    fs.realpath(path.join(__dirname, '..', '..', 'public')),
  ]);
  const relative = path.relative(realPublic, realRoot);
  if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
    throw new Error('PRIVATE_STORAGE_CONFIGURATION_INVALID');
  }
  return realRoot;
}

function sanitizeFilename(value) {
  const basename = path.posix.basename(path.win32.basename(String(value || 'document')));
  const safe = basename
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[^A-Za-z0-9._ -]/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 180);
  return safe || 'document';
}

function hasExpectedSignature(buffer, mimeType) {
  if (mimeType === 'application/pdf') return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  if (mimeType === 'image/jpeg') {
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (mimeType === 'image/png') {
    return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
  if (mimeType === 'image/webp') {
    return buffer.length >= 12 &&
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  }
  return false;
}

async function assertMembership(businessId, userId, connection = db) {
  const member = await getOne(
    'SELECT id FROM business_memberships WHERE business_id = ? AND user_id = ?',
    [businessId, userId],
    connection
  );
  if (!member) throw new Error('FORBIDDEN');
}

async function validateDocumentLinks({
  businessId,
  supplierInvoiceId,
  expenseId,
  invoiceId,
  documentType,
  connection,
}) {
  const links = [
    ['supplierInvoiceId', supplierInvoiceId,
      'SELECT id, expense_id FROM supplier_invoices WHERE id = ? AND business_id = ?'],
    ['expenseId', expenseId,
      'SELECT id FROM expenses WHERE id = ? AND business_id = ?'],
    ['invoiceId', invoiceId,
      'SELECT id FROM invoices WHERE id = ? AND business_id = ?'],
  ];
  const found = {};
  for (const [name, id, sql] of links) {
    if (!id) continue;
    const row = await getOne(sql, [id, businessId], connection);
    if (!row) throw new Error('DOCUMENT_RECORD_NOT_FOUND');
    found[name] = row;
  }
  if (documentType === 'supplier_invoice' && !supplierInvoiceId) {
    throw new Error('INVALID_DOCUMENT');
  }
  if (documentType === 'expense_receipt' && !expenseId) {
    throw new Error('INVALID_DOCUMENT');
  }
  if (documentType === 'business_logo' && (supplierInvoiceId || expenseId || invoiceId)) {
    throw new Error('INVALID_DOCUMENT');
  }
  if (supplierInvoiceId && expenseId &&
      Number(found.supplierInvoiceId.expense_id) !== Number(expenseId)) {
    throw new Error('DOCUMENT_RECORD_MISMATCH');
  }
}

async function listDocuments({
  businessId,
  supplierInvoiceId,
  expenseId,
  invoiceId,
  documentType,
  search,
  startDate,
  endDate,
  includeDeleted = false,
}) {
  const validTypes = ['supplier_invoice', 'expense_receipt', 'supporting_document', 'business_logo'];
  const validDate = (value) => {
    if (value === undefined || value === null || value === '') return true;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  };
  const entityIds = [supplierInvoiceId, expenseId, invoiceId];
  if (entityIds.some((id) => id !== undefined &&
      (!Number.isSafeInteger(Number(id)) || Number(id) <= 0)) ||
      (documentType && !validTypes.includes(documentType)) ||
      !validDate(startDate) || !validDate(endDate) ||
      (startDate && endDate && startDate > endDate) ||
      (search !== undefined && (typeof search !== 'string' || search.length > 100))) {
    throw new Error('INVALID_DOCUMENT_FILTER');
  }
  const conditions = ['d.business_id = ?'];
  const params = [businessId];
  if (!includeDeleted) conditions.push('d.deleted_at IS NULL');
  if (supplierInvoiceId) {
    conditions.push('d.supplier_invoice_id = ?');
    params.push(supplierInvoiceId);
  }
  if (expenseId) {
    conditions.push('d.expense_id = ?');
    params.push(expenseId);
  }
  if (invoiceId) {
    conditions.push('d.invoice_id = ?');
    params.push(invoiceId);
  }
  if (documentType) {
    conditions.push('d.document_type = ?');
    params.push(documentType);
  }
  if (search) {
    conditions.push('(d.original_filename LIKE ? OR si.supplier_name LIKE ? OR e.title LIKE ? OR i.invoice_number LIKE ?)');
    const like = `%${String(search).trim().slice(0, 100)}%`;
    params.push(like, like, like, like);
  }
  if (startDate) {
    conditions.push('d.uploaded_at >= ?');
    params.push(startDate);
  }
  if (endDate) {
    conditions.push('d.uploaded_at < DATE_ADD(?, INTERVAL 1 DAY)');
    params.push(endDate);
  }
  return db.execute(
    `SELECT d.id, d.document_type, d.supplier_invoice_id, d.expense_id, d.invoice_id,
       d.original_filename, d.mime_type, d.file_size_bytes, d.uploaded_by, d.uploaded_at,
       si.supplier_invoice_number, si.supplier_name,
       e.title AS expense_title, i.invoice_number,
       u.first_name AS uploader_first_name, u.last_name AS uploader_last_name
     FROM financial_documents d
     LEFT JOIN supplier_invoices si
       ON si.id = d.supplier_invoice_id AND si.business_id = d.business_id
     LEFT JOIN expenses e ON e.id = d.expense_id AND e.business_id = d.business_id
     LEFT JOIN invoices i ON i.id = d.invoice_id AND i.business_id = d.business_id
     LEFT JOIN users u ON u.id = d.uploaded_by
     WHERE ${conditions.join(' AND ')}
     ORDER BY d.uploaded_at DESC, d.id DESC
     LIMIT 500`,
    params
  ).then(([rows]) => rows.map((row) => ({
    ...row,
    file_size_bytes: Number(row.file_size_bytes),
  })));
}

async function getDocumentRecord({ businessId, userId, documentId, includeDeleted = false }) {
  await assertMembership(businessId, userId);
  const deletedClause = includeDeleted ? '' : 'AND deleted_at IS NULL';
  return getOne(
    `SELECT id, business_id, storage_key, sha256, original_filename, mime_type,
       file_size_bytes, document_type, supplier_invoice_id, expense_id, invoice_id
     FROM financial_documents
     WHERE id = ? AND business_id = ? ${deletedClause}`,
    [documentId, businessId]
  );
}

async function uploadDocument({
  businessId,
  userId,
  buffer,
  originalFilename,
  mimeType,
  documentType,
  supplierInvoiceId = null,
  expenseId = null,
  invoiceId = null,
}) {
  await assertMembership(businessId, userId);
  if (!Buffer.isBuffer(buffer) || buffer.length < 1 || buffer.length > MAX_FILE_SIZE ||
      !MIME_TYPES.has(mimeType) || !hasExpectedSignature(buffer, mimeType)) {
    throw new Error('INVALID_DOCUMENT');
  }
  if (!['supplier_invoice', 'expense_receipt', 'supporting_document', 'business_logo'].includes(documentType)) {
    throw new Error('INVALID_DOCUMENT');
  }
  if (documentType === 'business_logo' &&
      !['image/jpeg', 'image/png'].includes(mimeType)) {
    throw new Error('INVALID_DOCUMENT');
  }
  const idValues = [supplierInvoiceId, expenseId, invoiceId].map((value) =>
    value === null || value === undefined || value === '' ? null : Number(value)
  );
  [supplierInvoiceId, expenseId, invoiceId] = idValues;
  if ([supplierInvoiceId, expenseId, invoiceId].some((value) =>
    value !== null && (!Number.isSafeInteger(value) || value <= 0))) {
    throw new Error('INVALID_DOCUMENT');
  }

  const connection = await db.getConnection();
  let storagePath;
  try {
    await connection.beginTransaction();
    await assertMembership(businessId, userId, connection);
    await validateDocumentLinks({
      businessId,
      supplierInvoiceId,
      expenseId,
      invoiceId,
      documentType,
      connection,
    });
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    const duplicate = await getOne(
      `SELECT id, supplier_invoice_id, expense_id, invoice_id
       FROM financial_documents
       WHERE business_id = ? AND sha256 = ? AND deleted_at IS NULL
       FOR UPDATE`,
      [businessId, sha256],
      connection
    );
    if (duplicate) {
      if (Number(duplicate.supplier_invoice_id || 0) !== Number(supplierInvoiceId || 0) ||
          Number(duplicate.expense_id || 0) !== Number(expenseId || 0) ||
          Number(duplicate.invoice_id || 0) !== Number(invoiceId || 0)) {
        throw new Error('DOCUMENT_ALREADY_LINKED');
      }
      await connection.commit();
      return { id: Number(duplicate.id), duplicate: true };
    }

    const root = await assertPrivateStorageRoot();
    const storageKey = crypto.randomUUID();
    storagePath = path.join(root, storageKey);
    await fs.writeFile(storagePath, buffer, { flag: 'wx', mode: 0o600 });
    const result = await execute(
      `INSERT INTO financial_documents
       (business_id, invoice_id, supplier_invoice_id, expense_id, document_type,
        storage_key, sha256, original_filename, mime_type, file_size_bytes, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        businessId,
        invoiceId,
        supplierInvoiceId,
        expenseId,
        documentType,
        storageKey,
        sha256,
        sanitizeFilename(originalFilename),
        mimeType,
        buffer.length,
        userId,
      ],
      connection
    );
    if (supplierInvoiceId) {
      await execute(
        `INSERT INTO supplier_invoice_audit_events
         (business_id, supplier_invoice_id, user_id, action, details)
         VALUES (?, ?, ?, 'document_uploaded', ?)`,
        [businessId, supplierInvoiceId, userId,
          JSON.stringify({ documentId: Number(result.insertId), documentType, sizeBytes: buffer.length })],
        connection
      );
    }
    if (invoiceId) {
      await execute(
        `INSERT INTO invoice_audit_events
         (business_id, invoice_id, user_id, action, details)
         VALUES (?, ?, ?, 'document_uploaded', ?)`,
        [businessId, invoiceId, userId,
          JSON.stringify({ documentId: Number(result.insertId), documentType, sizeBytes: buffer.length })],
        connection
      );
    }
    await execute(
      `INSERT INTO financial_audit_events
       (business_id, user_id, event_type, record_type, record_id, details)
       VALUES (?, ?, 'document_uploaded', 'document', ?, ?)`,
      [
        businessId,
        userId,
        result.insertId,
        JSON.stringify({ documentType, supplierInvoiceId, expenseId, invoiceId, sizeBytes: buffer.length }),
      ],
      connection
    );
    await connection.commit();
    return { id: Number(result.insertId), duplicate: false };
  } catch (error) {
    try {
      await connection.rollback();
    } catch (rollbackError) {
      console.error('Financial document transaction rollback failed:', rollbackError.message);
    }
    if (storagePath) {
      try {
        await fs.unlink(storagePath);
      } catch (cleanupError) {
        if (cleanupError.code !== 'ENOENT') {
          console.error('Could not remove unreferenced financial document:', cleanupError.message);
        }
      }
    }
    throw error;
  } finally {
    connection.release();
  }
}

async function readDocument({ businessId, userId, documentId }) {
  const document = await getDocumentRecord({ businessId, userId, documentId });
  if (!document) return null;
  const root = await assertPrivateStorageRoot();
  const filePath = path.join(root, document.storage_key);
  const buffer = await fs.readFile(filePath);
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  if (buffer.length !== Number(document.file_size_bytes) || sha256 !== document.sha256) {
    throw new Error('DOCUMENT_STORAGE_INTEGRITY_ERROR');
  }
  return { document, buffer };
}

async function removeDocument({ businessId, userId, documentId }) {
  await assertMembership(businessId, userId);
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const document = await getOne(
      `SELECT id, supplier_invoice_id, expense_id, invoice_id
       FROM financial_documents
       WHERE id = ? AND business_id = ? AND deleted_at IS NULL
       FOR UPDATE`,
      [documentId, businessId],
      connection
    );
    if (!document) throw new Error('DOCUMENT_NOT_FOUND');
    await execute(
      `UPDATE financial_documents
       SET deleted_by = ?, deleted_at = CURRENT_TIMESTAMP
       WHERE id = ? AND business_id = ?`,
      [userId, documentId, businessId],
      connection
    );
    await execute(
      `UPDATE invoice_settings SET logo_document_id = NULL
       WHERE business_id = ? AND logo_document_id = ?`,
      [businessId, documentId],
      connection
    );
    if (document.supplier_invoice_id) {
      await execute(
        `INSERT INTO supplier_invoice_audit_events
         (business_id, supplier_invoice_id, user_id, action, details)
         VALUES (?, ?, ?, 'document_removed', ?)`,
        [businessId, document.supplier_invoice_id, userId,
          JSON.stringify({ documentId: Number(documentId) })],
        connection
      );
    }
    if (document.invoice_id) {
      await execute(
        `INSERT INTO invoice_audit_events
         (business_id, invoice_id, user_id, action, details)
         VALUES (?, ?, ?, 'document_removed', ?)`,
        [businessId, document.invoice_id, userId,
          JSON.stringify({ documentId: Number(documentId) })],
        connection
      );
    }
    await execute(
      `INSERT INTO financial_audit_events
       (business_id, user_id, event_type, record_type, record_id, details)
       VALUES (?, ?, 'document_removed', 'document', ?, ?)`,
      [businessId, userId, documentId, JSON.stringify({
        supplierInvoiceId: document.supplier_invoice_id,
        expenseId: document.expense_id,
        invoiceId: document.invoice_id,
      })],
      connection
    );
    await connection.commit();
    return { id: Number(documentId), deleted: true };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  assertPrivateStorageRoot,
  getDocumentRecord,
  listDocuments,
  readDocument,
  removeDocument,
  sanitizeFilename,
  uploadDocument,
};
