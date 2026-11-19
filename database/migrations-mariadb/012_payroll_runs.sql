CREATE TABLE IF NOT EXISTS payroll_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  business_id INT(11) NOT NULL,
  rule_set_id INT UNSIGNED NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  pay_date DATE NOT NULL,
  status ENUM('draft', 'approved', 'finalized', 'cancelled') NOT NULL DEFAULT 'draft',
  currency CHAR(3) NOT NULL DEFAULT 'ZAR',
  total_gross_cents BIGINT UNSIGNED NOT NULL DEFAULT 0,
  total_paye_cents BIGINT UNSIGNED NOT NULL DEFAULT 0,
  total_uif_employee_cents BIGINT UNSIGNED NOT NULL DEFAULT 0,
  total_uif_employer_cents BIGINT UNSIGNED NOT NULL DEFAULT 0,
  total_sdl_cents BIGINT UNSIGNED NOT NULL DEFAULT 0,
  total_other_deductions_cents BIGINT UNSIGNED NOT NULL DEFAULT 0,
  total_net_cents BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_by INT(11) NOT NULL,
  approved_by INT(11) NULL,
  finalized_by INT(11) NULL,
  approved_at DATETIME NULL,
  finalized_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_payroll_run_period (business_id, period_start),
  UNIQUE KEY uq_payroll_run_id_business (id, business_id),
  KEY idx_payroll_run_status_date (business_id, status, period_start),
  CONSTRAINT fk_payroll_run_business
    FOREIGN KEY (business_id) REFERENCES businesses (id),
  CONSTRAINT fk_payroll_run_rule_set
    FOREIGN KEY (rule_set_id, business_id)
    REFERENCES payroll_rule_sets (id, business_id),
  CONSTRAINT fk_payroll_run_created_by
    FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT fk_payroll_run_approved_by
    FOREIGN KEY (approved_by) REFERENCES users (id),
  CONSTRAINT fk_payroll_run_finalized_by
    FOREIGN KEY (finalized_by) REFERENCES users (id),
  CONSTRAINT chk_payroll_run_dates
    CHECK (period_end >= period_start AND pay_date >= period_end)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payroll_run_lines (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  business_id INT(11) NOT NULL,
  payroll_run_id BIGINT UNSIGNED NOT NULL,
  employee_id INT UNSIGNED NOT NULL,
  pay_structure VARCHAR(30) NULL,
  base_rate_cents BIGINT UNSIGNED NULL,
  gross_cents BIGINT UNSIGNED NOT NULL,
  annualized_taxable_cents BIGINT UNSIGNED NOT NULL,
  paye_cents BIGINT UNSIGNED NOT NULL,
  uif_employee_cents BIGINT UNSIGNED NOT NULL,
  uif_employer_cents BIGINT UNSIGNED NOT NULL,
  sdl_cents BIGINT UNSIGNED NOT NULL,
  other_deductions_cents BIGINT UNSIGNED NOT NULL DEFAULT 0,
  net_cents BIGINT UNSIGNED NOT NULL,
  calculation_snapshot LONGTEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_payroll_run_employee (payroll_run_id, employee_id),
  KEY idx_payroll_run_line_business_employee (business_id, employee_id, payroll_run_id),
  CONSTRAINT fk_payroll_run_line_run
    FOREIGN KEY (payroll_run_id, business_id) REFERENCES payroll_runs (id, business_id),
  CONSTRAINT fk_payroll_run_line_employee
    FOREIGN KEY (employee_id, business_id) REFERENCES employees (id, business_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payroll_run_audit_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  business_id INT(11) NOT NULL,
  payroll_run_id BIGINT UNSIGNED NOT NULL,
  actor_user_id INT(11) NOT NULL,
  action VARCHAR(50) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_payroll_run_audit_business (business_id, payroll_run_id, created_at),
  CONSTRAINT fk_payroll_run_audit_run
    FOREIGN KEY (payroll_run_id, business_id) REFERENCES payroll_runs (id, business_id),
  CONSTRAINT fk_payroll_run_audit_actor
    FOREIGN KEY (actor_user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
