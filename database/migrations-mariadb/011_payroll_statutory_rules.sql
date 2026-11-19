CREATE TABLE IF NOT EXISTS payroll_rule_sets (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  business_id INT(11) NOT NULL,
  label VARCHAR(100) NOT NULL,
  effective_from DATE NOT NULL,
  effective_to DATE NULL,
  annual_rebate_cents BIGINT UNSIGNED NOT NULL DEFAULT 0,
  uif_employee_rate_bps SMALLINT UNSIGNED NOT NULL,
  uif_employer_rate_bps SMALLINT UNSIGNED NOT NULL,
  uif_monthly_cap_cents BIGINT UNSIGNED NOT NULL,
  sdl_rate_bps SMALLINT UNSIGNED NOT NULL,
  sdl_annual_threshold_cents BIGINT UNSIGNED NOT NULL,
  created_by INT(11) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_payroll_rule_set_id_business (id, business_id),
  KEY idx_payroll_rule_set_effective (business_id, effective_from, effective_to),
  CONSTRAINT fk_payroll_rule_set_business
    FOREIGN KEY (business_id) REFERENCES businesses (id),
  CONSTRAINT fk_payroll_rule_set_actor
    FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT chk_payroll_rule_set_dates
    CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT chk_payroll_rule_set_uif_rates
    CHECK (uif_employee_rate_bps <= 10000 AND uif_employer_rate_bps <= 10000),
  CONSTRAINT chk_payroll_rule_set_sdl_rate
    CHECK (sdl_rate_bps <= 10000),
  CONSTRAINT chk_payroll_rule_set_uif_cap
    CHECK (uif_monthly_cap_cents > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payroll_paye_bands (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  business_id INT(11) NOT NULL,
  rule_set_id INT UNSIGNED NOT NULL,
  band_order SMALLINT UNSIGNED NOT NULL,
  lower_cents BIGINT UNSIGNED NOT NULL,
  upper_cents BIGINT UNSIGNED NULL,
  rate_bps SMALLINT UNSIGNED NOT NULL,
  base_tax_cents BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_payroll_paye_band_order (rule_set_id, band_order),
  KEY idx_payroll_paye_band_business (business_id, rule_set_id, band_order),
  CONSTRAINT fk_payroll_paye_band_rule_set
    FOREIGN KEY (rule_set_id, business_id)
    REFERENCES payroll_rule_sets (id, business_id),
  CONSTRAINT chk_payroll_paye_band_range
    CHECK (upper_cents IS NULL OR upper_cents > lower_cents),
  CONSTRAINT chk_payroll_paye_band_rate
    CHECK (rate_bps <= 10000)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payroll_rule_audit_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  business_id INT(11) NOT NULL,
  rule_set_id INT UNSIGNED NOT NULL,
  actor_user_id INT(11) NOT NULL,
  action VARCHAR(50) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_payroll_rule_audit_business (business_id, rule_set_id, created_at),
  CONSTRAINT fk_payroll_rule_audit_rule_set
    FOREIGN KEY (rule_set_id, business_id)
    REFERENCES payroll_rule_sets (id, business_id),
  CONSTRAINT fk_payroll_rule_audit_actor
    FOREIGN KEY (actor_user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
