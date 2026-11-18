ALTER TABLE invoice_items
  ADD UNIQUE KEY uq_invoice_item_id_business (id, business_id);

ALTER TABLE invoice_payments
  ADD COLUMN receipt_number VARCHAR(60) NULL AFTER idempotency_key,
  ADD UNIQUE KEY uq_invoice_payment_receipt (business_id, receipt_number),
  ADD UNIQUE KEY uq_invoice_payment_id_business (id, business_id);

CREATE TABLE IF NOT EXISTS receipt_sequences (
  business_id INT(11) NOT NULL,
  sequence_year SMALLINT NOT NULL,
  last_number INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (business_id, sequence_year),
  CONSTRAINT fk_receipt_sequence_business
    FOREIGN KEY (business_id) REFERENCES businesses (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS credit_note_sequences (
  business_id INT(11) NOT NULL,
  sequence_year SMALLINT NOT NULL,
  last_number INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (business_id, sequence_year),
  CONSTRAINT fk_credit_note_sequence_business
    FOREIGN KEY (business_id) REFERENCES businesses (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS invoice_credit_notes (
  id INT(11) NOT NULL AUTO_INCREMENT,
  business_id INT(11) NOT NULL,
  invoice_id INT(11) NOT NULL,
  credit_number VARCHAR(60) NOT NULL,
  credit_date DATE NOT NULL,
  reason VARCHAR(1000) NOT NULL,
  subtotal_cents BIGINT NOT NULL DEFAULT 0,
  discount_cents BIGINT NOT NULL DEFAULT 0,
  tax_cents BIGINT NOT NULL DEFAULT 0,
  total_cents BIGINT NOT NULL DEFAULT 0,
  created_by INT(11) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_credit_note_business_number (business_id, credit_number),
  UNIQUE KEY uq_credit_note_id_business (id, business_id),
  KEY idx_credit_note_business_invoice_date (business_id, invoice_id, credit_date),
  CONSTRAINT fk_credit_note_invoice
    FOREIGN KEY (invoice_id, business_id)
    REFERENCES invoices (id, business_id),
  CONSTRAINT fk_credit_note_created_by
    FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT chk_credit_note_amounts
    CHECK (subtotal_cents >= 0 AND discount_cents >= 0 AND tax_cents >= 0 AND total_cents > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS invoice_credit_items (
  id INT(11) NOT NULL AUTO_INCREMENT,
  business_id INT(11) NOT NULL,
  credit_note_id INT(11) NOT NULL,
  invoice_item_id INT(11) NOT NULL,
  item_name VARCHAR(191) NOT NULL,
  description TEXT NULL,
  quantity_millis BIGINT NOT NULL,
  subtotal_cents BIGINT NOT NULL,
  discount_cents BIGINT NOT NULL DEFAULT 0,
  tax_cents BIGINT NOT NULL DEFAULT 0,
  total_cents BIGINT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_invoice_credit_items_business_note (business_id, credit_note_id, id),
  CONSTRAINT fk_invoice_credit_item_note
    FOREIGN KEY (credit_note_id, business_id)
    REFERENCES invoice_credit_notes (id, business_id),
  CONSTRAINT fk_invoice_credit_item_source
    FOREIGN KEY (invoice_item_id, business_id)
    REFERENCES invoice_items (id, business_id),
  CONSTRAINT chk_invoice_credit_item_amounts
    CHECK (quantity_millis > 0 AND subtotal_cents >= 0 AND discount_cents >= 0 AND tax_cents >= 0 AND total_cents > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS invoice_email_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  business_id INT(11) NOT NULL,
  invoice_id INT(11) NOT NULL,
  recipient_email VARCHAR(254) NOT NULL,
  status ENUM('pending', 'accepted', 'failed') NOT NULL,
  provider VARCHAR(40) NOT NULL,
  provider_message_id VARCHAR(191) NULL,
  error_message VARCHAR(500) NULL,
  attempt_number TINYINT UNSIGNED NOT NULL DEFAULT 1,
  created_by INT(11) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_invoice_email_business_invoice (business_id, invoice_id, created_at),
  CONSTRAINT fk_invoice_email_invoice
    FOREIGN KEY (invoice_id, business_id)
    REFERENCES invoices (id, business_id),
  CONSTRAINT fk_invoice_email_user
    FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS supplier_invoices (
  id INT(11) NOT NULL AUTO_INCREMENT,
  business_id INT(11) NOT NULL,
  supplier_id INT(11) NOT NULL,
  expense_id INT(11) NULL,
  supplier_invoice_number VARCHAR(100) NOT NULL,
  supplier_name VARCHAR(191) NOT NULL,
  invoice_date DATE NOT NULL,
  received_date DATE NOT NULL,
  due_date DATE NOT NULL,
  reference VARCHAR(100) NULL,
  description TEXT NULL,
  subtotal_cents BIGINT NOT NULL DEFAULT 0,
  discount_cents BIGINT NOT NULL DEFAULT 0,
  tax_cents BIGINT NOT NULL DEFAULT 0,
  total_cents BIGINT NOT NULL DEFAULT 0,
  currency VARCHAR(8) NOT NULL,
  status ENUM('received', 'partially_paid', 'paid', 'cancelled') NOT NULL DEFAULT 'received',
  notes TEXT NULL,
  created_by INT(11) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_supplier_invoice_number (business_id, supplier_id, supplier_invoice_number),
  UNIQUE KEY uq_supplier_invoice_id_business (id, business_id),
  UNIQUE KEY uq_supplier_invoice_expense (business_id, expense_id),
  KEY idx_supplier_invoice_business_status_due (business_id, status, due_date),
  KEY idx_supplier_invoice_business_supplier_date (business_id, supplier_id, invoice_date),
  CONSTRAINT fk_supplier_invoice_business
    FOREIGN KEY (business_id) REFERENCES businesses (id),
  CONSTRAINT fk_supplier_invoice_supplier
    FOREIGN KEY (supplier_id, business_id)
    REFERENCES expense_suppliers (id, business_id),
  CONSTRAINT fk_supplier_invoice_expense
    FOREIGN KEY (expense_id, business_id)
    REFERENCES expenses (id, business_id),
  CONSTRAINT fk_supplier_invoice_user
    FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT chk_supplier_invoice_amounts
    CHECK (subtotal_cents >= 0 AND discount_cents >= 0 AND tax_cents >= 0 AND total_cents > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS supplier_invoice_items (
  id INT(11) NOT NULL AUTO_INCREMENT,
  business_id INT(11) NOT NULL,
  supplier_invoice_id INT(11) NOT NULL,
  product_id INT(11) NULL,
  item_type ENUM('product', 'service', 'custom') NOT NULL,
  item_name VARCHAR(191) NOT NULL,
  description TEXT NULL,
  quantity_millis BIGINT NOT NULL,
  received_quantity_millis BIGINT NOT NULL DEFAULT 0,
  unit_price_cents BIGINT NOT NULL,
  discount_cents BIGINT NOT NULL DEFAULT 0,
  tax_rate_bps INT UNSIGNED NOT NULL DEFAULT 0,
  tax_inclusive TINYINT(1) NOT NULL DEFAULT 0,
  subtotal_cents BIGINT NOT NULL,
  tax_cents BIGINT NOT NULL,
  total_cents BIGINT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_supplier_invoice_item_id_business (id, business_id),
  KEY idx_supplier_invoice_items_business_invoice (business_id, supplier_invoice_id, id),
  CONSTRAINT fk_supplier_invoice_item_invoice
    FOREIGN KEY (supplier_invoice_id, business_id)
    REFERENCES supplier_invoices (id, business_id),
  CONSTRAINT fk_supplier_invoice_item_product
    FOREIGN KEY (product_id) REFERENCES products (id),
  CONSTRAINT chk_supplier_invoice_item_amounts
    CHECK (quantity_millis > 0 AND received_quantity_millis >= 0 AND received_quantity_millis <= quantity_millis
      AND unit_price_cents >= 0 AND discount_cents >= 0 AND subtotal_cents >= 0 AND tax_cents >= 0 AND total_cents >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS supplier_invoice_payments (
  id INT(11) NOT NULL AUTO_INCREMENT,
  business_id INT(11) NOT NULL,
  supplier_invoice_id INT(11) NOT NULL,
  amount_cents BIGINT NOT NULL,
  payment_date DATE NOT NULL,
  payment_method VARCHAR(40) NOT NULL,
  reference VARCHAR(100) NULL,
  notes TEXT NULL,
  idempotency_key VARCHAR(191) NOT NULL,
  recorded_by INT(11) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_supplier_payment_idempotency (business_id, idempotency_key),
  UNIQUE KEY uq_supplier_payment_id_business (id, business_id),
  KEY idx_supplier_payments_business_invoice_date (business_id, supplier_invoice_id, payment_date),
  CONSTRAINT fk_supplier_payment_invoice
    FOREIGN KEY (supplier_invoice_id, business_id)
    REFERENCES supplier_invoices (id, business_id),
  CONSTRAINT fk_supplier_payment_user
    FOREIGN KEY (recorded_by) REFERENCES users (id),
  CONSTRAINT chk_supplier_payment_amount CHECK (amount_cents > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE expense_payments
  ADD COLUMN source_supplier_payment_id INT(11) NULL,
  ADD UNIQUE KEY uq_expense_payment_supplier_source (business_id, source_supplier_payment_id);

CREATE TABLE IF NOT EXISTS supplier_invoice_audit_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  business_id INT(11) NOT NULL,
  supplier_invoice_id INT(11) NOT NULL,
  user_id INT(11) NOT NULL,
  action VARCHAR(50) NOT NULL,
  details TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_supplier_invoice_audit (business_id, supplier_invoice_id, created_at),
  CONSTRAINT fk_supplier_invoice_audit_invoice
    FOREIGN KEY (supplier_invoice_id, business_id)
    REFERENCES supplier_invoices (id, business_id),
  CONSTRAINT fk_supplier_invoice_audit_user
    FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS financial_documents (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  business_id INT(11) NOT NULL,
  invoice_id INT(11) NULL,
  supplier_invoice_id INT(11) NULL,
  expense_id INT(11) NULL,
  document_type ENUM('supplier_invoice', 'expense_receipt', 'supporting_document') NOT NULL,
  storage_key CHAR(36) NOT NULL,
  sha256 CHAR(64) NOT NULL,
  original_filename VARCHAR(255) NOT NULL,
  mime_type VARCHAR(80) NOT NULL,
  file_size_bytes INT UNSIGNED NOT NULL,
  uploaded_by INT(11) NOT NULL,
  uploaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_by INT(11) NULL,
  deleted_at TIMESTAMP NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_financial_document_storage (storage_key),
  UNIQUE KEY uq_financial_document_hash (business_id, sha256),
  KEY idx_financial_documents_business_type_date (business_id, document_type, uploaded_at),
  KEY idx_financial_documents_supplier_invoice (business_id, supplier_invoice_id),
  KEY idx_financial_documents_expense (business_id, expense_id),
  KEY idx_financial_documents_customer_invoice (business_id, invoice_id),
  CONSTRAINT fk_financial_document_business
    FOREIGN KEY (business_id) REFERENCES businesses (id),
  CONSTRAINT fk_financial_document_invoice
    FOREIGN KEY (invoice_id, business_id)
    REFERENCES invoices (id, business_id),
  CONSTRAINT fk_financial_document_supplier_invoice
    FOREIGN KEY (supplier_invoice_id, business_id)
    REFERENCES supplier_invoices (id, business_id),
  CONSTRAINT fk_financial_document_expense
    FOREIGN KEY (expense_id, business_id)
    REFERENCES expenses (id, business_id),
  CONSTRAINT fk_financial_document_uploader
    FOREIGN KEY (uploaded_by) REFERENCES users (id),
  CONSTRAINT fk_financial_document_deleter
    FOREIGN KEY (deleted_by) REFERENCES users (id),
  CONSTRAINT chk_financial_document_size
    CHECK (file_size_bytes > 0 AND file_size_bytes <= 10485760)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS supplier_stock_receipts (
  id INT(11) NOT NULL AUTO_INCREMENT,
  business_id INT(11) NOT NULL,
  supplier_invoice_id INT(11) NOT NULL,
  idempotency_key VARCHAR(191) NOT NULL,
  received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  received_by INT(11) NOT NULL,
  notes VARCHAR(1000) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_supplier_stock_receipt_idempotency (business_id, idempotency_key),
  UNIQUE KEY uq_supplier_stock_receipt_id_business (id, business_id),
  KEY idx_supplier_stock_receipt_invoice (business_id, supplier_invoice_id, received_at),
  CONSTRAINT fk_supplier_stock_receipt_invoice
    FOREIGN KEY (supplier_invoice_id, business_id)
    REFERENCES supplier_invoices (id, business_id),
  CONSTRAINT fk_supplier_stock_receipt_user
    FOREIGN KEY (received_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS supplier_stock_receipt_items (
  id INT(11) NOT NULL AUTO_INCREMENT,
  business_id INT(11) NOT NULL,
  stock_receipt_id INT(11) NOT NULL,
  supplier_invoice_item_id INT(11) NOT NULL,
  product_id INT(11) NOT NULL,
  quantity INT NOT NULL,
  unit_cost_cents BIGINT NOT NULL,
  inventory_movement_id INT(11) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_supplier_stock_receipt_item (business_id, stock_receipt_id, id),
  CONSTRAINT fk_supplier_stock_receipt_item_receipt
    FOREIGN KEY (stock_receipt_id, business_id)
    REFERENCES supplier_stock_receipts (id, business_id),
  CONSTRAINT fk_supplier_stock_receipt_item_line
    FOREIGN KEY (supplier_invoice_item_id, business_id)
    REFERENCES supplier_invoice_items (id, business_id),
  CONSTRAINT fk_supplier_stock_receipt_item_product
    FOREIGN KEY (product_id) REFERENCES products (id),
  CONSTRAINT fk_supplier_stock_receipt_item_movement
    FOREIGN KEY (inventory_movement_id) REFERENCES inventory_movements (id),
  CONSTRAINT chk_supplier_stock_receipt_item
    CHECK (quantity > 0 AND unit_cost_cents >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS product_cost_history (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  business_id INT(11) NOT NULL,
  product_id INT(11) NOT NULL,
  previous_cost_cents BIGINT NULL,
  new_cost_cents BIGINT NOT NULL,
  source_supplier_invoice_id INT(11) NOT NULL,
  changed_by INT(11) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_product_cost_history (business_id, product_id, created_at),
  CONSTRAINT fk_product_cost_history_product
    FOREIGN KEY (product_id) REFERENCES products (id),
  CONSTRAINT fk_product_cost_history_supplier_invoice
    FOREIGN KEY (source_supplier_invoice_id, business_id)
    REFERENCES supplier_invoices (id, business_id),
  CONSTRAINT fk_product_cost_history_user
    FOREIGN KEY (changed_by) REFERENCES users (id),
  CONSTRAINT chk_product_cost_history_amounts
    CHECK (new_cost_cents >= 0 AND (previous_cost_cents IS NULL OR previous_cost_cents >= 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
