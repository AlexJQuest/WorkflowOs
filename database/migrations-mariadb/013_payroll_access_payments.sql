ALTER TABLE employees
  ADD COLUMN portal_user_id INT(11) NULL AFTER email,
  ADD UNIQUE KEY uq_employee_business_portal_user (business_id, portal_user_id),
  ADD CONSTRAINT fk_employee_portal_user
    FOREIGN KEY (portal_user_id) REFERENCES users (id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS employee_portal_invitations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  business_id INT(11) NOT NULL,
  employee_id INT UNSIGNED NOT NULL,
  email VARCHAR(191) NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  created_by INT(11) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_employee_portal_invitation (business_id, employee_id),
  UNIQUE KEY uq_employee_portal_invitation_token (token_hash),
  CONSTRAINT fk_employee_portal_invitation_employee
    FOREIGN KEY (employee_id, business_id) REFERENCES employees (id, business_id),
  CONSTRAINT fk_employee_portal_invitation_creator
    FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payroll_run_payments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  business_id INT(11) NOT NULL,
  payroll_run_id BIGINT UNSIGNED NOT NULL,
  employee_id INT UNSIGNED NOT NULL,
  amount_cents BIGINT UNSIGNED NOT NULL,
  paid_at DATE NOT NULL,
  payment_method ENUM('bank_transfer', 'cash', 'cheque', 'other') NOT NULL,
  payment_reference VARCHAR(100) NULL,
  idempotency_key VARCHAR(100) NOT NULL,
  created_by INT(11) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_payroll_payment_idempotency (business_id, idempotency_key),
  KEY idx_payroll_payment_line (business_id, payroll_run_id, employee_id, paid_at),
  CONSTRAINT fk_payroll_payment_line
    FOREIGN KEY (payroll_run_id, employee_id)
    REFERENCES payroll_run_lines (payroll_run_id, employee_id),
  CONSTRAINT fk_payroll_payment_run
    FOREIGN KEY (payroll_run_id, business_id)
    REFERENCES payroll_runs (id, business_id),
  CONSTRAINT fk_payroll_payment_employee
    FOREIGN KEY (employee_id, business_id)
    REFERENCES employees (id, business_id),
  CONSTRAINT fk_payroll_payment_creator
    FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT chk_payroll_payment_positive CHECK (amount_cents > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
