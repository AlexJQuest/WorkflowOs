CREATE TABLE IF NOT EXISTS expense_categories (
  id INT(11) NOT NULL AUTO_INCREMENT,
  business_id INT(11) NOT NULL,
  name VARCHAR(100) NOT NULL,
  is_system TINYINT(1) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_expense_category_business_name (business_id, name),
  UNIQUE KEY uq_expense_category_id_business (id, business_id),
  KEY idx_expense_category_business_active (business_id, is_active),
  CONSTRAINT fk_expense_category_business
    FOREIGN KEY (business_id) REFERENCES businesses (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS expense_suppliers (
  id INT(11) NOT NULL AUTO_INCREMENT,
  business_id INT(11) NOT NULL,
  name VARCHAR(191) NOT NULL,
  email VARCHAR(191) NULL,
  phone VARCHAR(50) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_expense_supplier_id_business (id, business_id),
  KEY idx_expense_supplier_business_name (business_id, name),
  CONSTRAINT fk_expense_supplier_business
    FOREIGN KEY (business_id) REFERENCES businesses (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS recurring_expenses (
  id INT(11) NOT NULL AUTO_INCREMENT,
  business_id INT(11) NOT NULL,
  category_id INT(11) NULL,
  supplier_id INT(11) NULL,
  title VARCHAR(191) NOT NULL,
  description TEXT NULL,
  subtotal_cents BIGINT NOT NULL,
  tax_cents BIGINT NOT NULL DEFAULT 0,
  currency VARCHAR(8) NOT NULL,
  frequency ENUM('weekly', 'monthly', 'quarterly', 'annually') NOT NULL,
  starts_on DATE NOT NULL,
  ends_on DATE NULL,
  next_due_date DATE NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_recurring_expense_id_business (id, business_id),
  KEY idx_recurring_expenses_due (business_id, is_active, next_due_date),
  CONSTRAINT fk_recurring_expense_business
    FOREIGN KEY (business_id) REFERENCES businesses (id),
  CONSTRAINT fk_recurring_expense_category
    FOREIGN KEY (category_id, business_id)
    REFERENCES expense_categories (id, business_id),
  CONSTRAINT fk_recurring_expense_supplier
    FOREIGN KEY (supplier_id, business_id)
    REFERENCES expense_suppliers (id, business_id),
  CONSTRAINT chk_recurring_expense_amounts
    CHECK (subtotal_cents >= 0 AND tax_cents >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS expenses (
  id INT(11) NOT NULL AUTO_INCREMENT,
  business_id INT(11) NOT NULL,
  category_id INT(11) NULL,
  supplier_id INT(11) NULL,
  recurring_expense_id INT(11) NULL,
  recurrence_date DATE NULL,
  title VARCHAR(191) NOT NULL,
  description TEXT NULL,
  reference_number VARCHAR(100) NULL,
  expense_date DATE NOT NULL,
  due_date DATE NULL,
  subtotal_cents BIGINT NOT NULL,
  tax_cents BIGINT NOT NULL DEFAULT 0,
  total_cents BIGINT NOT NULL,
  currency VARCHAR(8) NOT NULL,
  status ENUM('draft', 'unpaid', 'partially_paid', 'paid', 'overdue', 'cancelled') NOT NULL DEFAULT 'unpaid',
  notes TEXT NULL,
  created_by INT(11) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_expense_id_business (id, business_id),
  UNIQUE KEY uq_expense_recurring_occurrence (business_id, recurring_expense_id, recurrence_date),
  KEY idx_expenses_business_date_status (business_id, expense_date, status),
  KEY idx_expenses_business_due_status (business_id, due_date, status),
  KEY idx_expenses_business_category (business_id, category_id),
  KEY idx_expenses_business_supplier (business_id, supplier_id),
  CONSTRAINT fk_expense_business
    FOREIGN KEY (business_id) REFERENCES businesses (id),
  CONSTRAINT fk_expense_category
    FOREIGN KEY (category_id, business_id)
    REFERENCES expense_categories (id, business_id),
  CONSTRAINT fk_expense_supplier
    FOREIGN KEY (supplier_id, business_id)
    REFERENCES expense_suppliers (id, business_id),
  CONSTRAINT fk_expense_recurring
    FOREIGN KEY (recurring_expense_id, business_id)
    REFERENCES recurring_expenses (id, business_id),
  CONSTRAINT fk_expense_created_by
    FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT chk_expense_amounts
    CHECK (subtotal_cents >= 0 AND tax_cents >= 0 AND total_cents = subtotal_cents + tax_cents)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS expense_payments (
  id INT(11) NOT NULL AUTO_INCREMENT,
  business_id INT(11) NOT NULL,
  expense_id INT(11) NOT NULL,
  amount_cents BIGINT NOT NULL,
  payment_date DATE NOT NULL,
  payment_method VARCHAR(40) NOT NULL,
  reference VARCHAR(100) NULL,
  notes TEXT NULL,
  idempotency_key VARCHAR(191) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_expense_payment_idempotency (business_id, idempotency_key),
  KEY idx_expense_payments_expense_date (business_id, expense_id, payment_date),
  CONSTRAINT fk_expense_payment_expense
    FOREIGN KEY (expense_id, business_id)
    REFERENCES expenses (id, business_id),
  CONSTRAINT chk_expense_payment_amount
    CHECK (amount_cents > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO expense_categories (business_id, name, is_system)
SELECT b.id, defaults.name, 1
FROM businesses b
CROSS JOIN (
  SELECT 'Rent' AS name
  UNION ALL SELECT 'Utilities'
  UNION ALL SELECT 'Salaries and wages'
  UNION ALL SELECT 'Stock purchases'
  UNION ALL SELECT 'Transport and fuel'
  UNION ALL SELECT 'Marketing and advertising'
  UNION ALL SELECT 'Internet and telecommunications'
  UNION ALL SELECT 'Equipment'
  UNION ALL SELECT 'Repairs and maintenance'
  UNION ALL SELECT 'Insurance'
  UNION ALL SELECT 'Bank charges'
  UNION ALL SELECT 'Professional services'
  UNION ALL SELECT 'Software and subscriptions'
  UNION ALL SELECT 'Other'
) defaults;
