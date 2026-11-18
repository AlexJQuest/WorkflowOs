CREATE TABLE IF NOT EXISTS invoice_settings (
  business_id INT(11) NOT NULL,
  number_prefix VARCHAR(20) NOT NULL DEFAULT 'INV',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (business_id),
  CONSTRAINT fk_invoice_settings_business
    FOREIGN KEY (business_id) REFERENCES businesses (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS invoice_sequences (
  business_id INT(11) NOT NULL,
  sequence_year SMALLINT NOT NULL,
  last_number INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (business_id, sequence_year),
  CONSTRAINT fk_invoice_sequence_business
    FOREIGN KEY (business_id) REFERENCES businesses (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS invoices (
  id INT(11) NOT NULL AUTO_INCREMENT,
  business_id INT(11) NOT NULL,
  customer_id INT(11) NOT NULL,
  invoice_number VARCHAR(60) NULL,
  customer_name VARCHAR(191) NOT NULL,
  customer_email VARCHAR(254) NULL,
  customer_phone VARCHAR(100) NULL,
  customer_billing_address TEXT NULL,
  invoice_date DATE NOT NULL,
  due_date DATE NOT NULL,
  reference_number VARCHAR(100) NULL,
  description TEXT NULL,
  status ENUM('draft', 'issued', 'sent', 'partially_paid', 'paid', 'overdue', 'cancelled', 'credited') NOT NULL DEFAULT 'draft',
  subtotal_cents BIGINT NOT NULL DEFAULT 0,
  discount_cents BIGINT NOT NULL DEFAULT 0,
  tax_cents BIGINT NOT NULL DEFAULT 0,
  total_cents BIGINT NOT NULL DEFAULT 0,
  currency VARCHAR(8) NOT NULL,
  payment_terms VARCHAR(500) NULL,
  notes TEXT NULL,
  terms_and_conditions TEXT NULL,
  created_by INT(11) NOT NULL,
  issued_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_invoice_business_number (business_id, invoice_number),
  UNIQUE KEY uq_invoice_id_business (id, business_id),
  KEY idx_invoice_business_status_date (business_id, status, invoice_date, id),
  KEY idx_invoice_business_customer_date (business_id, customer_id, invoice_date),
  KEY idx_invoice_business_due_date (business_id, due_date, status),
  CONSTRAINT fk_invoice_business
    FOREIGN KEY (business_id) REFERENCES businesses (id),
  CONSTRAINT fk_invoice_customer
    FOREIGN KEY (customer_id) REFERENCES customers (id),
  CONSTRAINT fk_invoice_created_by
    FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT chk_invoice_amounts
    CHECK (
      subtotal_cents >= 0
      AND discount_cents >= 0
      AND tax_cents >= 0
      AND total_cents >= 0
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS invoice_items (
  id INT(11) NOT NULL AUTO_INCREMENT,
  business_id INT(11) NOT NULL,
  invoice_id INT(11) NOT NULL,
  product_id INT(11) NULL,
  item_type ENUM('product', 'service', 'custom') NOT NULL,
  item_name VARCHAR(191) NOT NULL,
  description TEXT NULL,
  quantity_millis BIGINT NOT NULL,
  unit_price_cents BIGINT NOT NULL,
  discount_cents BIGINT NOT NULL DEFAULT 0,
  tax_rate_bps INT UNSIGNED NOT NULL DEFAULT 0,
  tax_inclusive TINYINT(1) NOT NULL DEFAULT 0,
  subtotal_cents BIGINT NOT NULL,
  tax_cents BIGINT NOT NULL,
  total_cents BIGINT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_invoice_items_business_invoice (business_id, invoice_id, id),
  CONSTRAINT fk_invoice_item_invoice
    FOREIGN KEY (invoice_id, business_id)
    REFERENCES invoices (id, business_id),
  CONSTRAINT fk_invoice_item_product
    FOREIGN KEY (product_id) REFERENCES products (id),
  CONSTRAINT chk_invoice_item_amounts
    CHECK (
      quantity_millis > 0
      AND unit_price_cents >= 0
      AND discount_cents >= 0
      AND subtotal_cents >= 0
      AND tax_cents >= 0
      AND total_cents >= 0
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS invoice_payments (
  id INT(11) NOT NULL AUTO_INCREMENT,
  business_id INT(11) NOT NULL,
  invoice_id INT(11) NOT NULL,
  amount_cents BIGINT NOT NULL,
  payment_date DATE NOT NULL,
  payment_method VARCHAR(40) NOT NULL,
  reference VARCHAR(100) NULL,
  notes TEXT NULL,
  idempotency_key VARCHAR(191) NULL,
  recorded_by INT(11) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_invoice_payment_idempotency (business_id, idempotency_key),
  KEY idx_invoice_payments_business_invoice_date (business_id, invoice_id, payment_date),
  CONSTRAINT fk_invoice_payment_invoice
    FOREIGN KEY (invoice_id, business_id)
    REFERENCES invoices (id, business_id),
  CONSTRAINT fk_invoice_payment_user
    FOREIGN KEY (recorded_by) REFERENCES users (id),
  CONSTRAINT chk_invoice_payment_amount
    CHECK (amount_cents > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS invoice_audit_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  business_id INT(11) NOT NULL,
  invoice_id INT(11) NOT NULL,
  user_id INT(11) NOT NULL,
  action VARCHAR(40) NOT NULL,
  details TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_invoice_audit_business_invoice_time (business_id, invoice_id, created_at),
  CONSTRAINT fk_invoice_audit_invoice
    FOREIGN KEY (invoice_id, business_id)
    REFERENCES invoices (id, business_id),
  CONSTRAINT fk_invoice_audit_user
    FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
