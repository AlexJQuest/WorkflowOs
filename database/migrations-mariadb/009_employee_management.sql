CREATE TABLE IF NOT EXISTS employees (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  business_id INT(11) NOT NULL,
  employee_number VARCHAR(40) NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  email VARCHAR(191) NULL,
  phone VARCHAR(50) NULL,
  residential_address TEXT NULL,
  emergency_contact_name VARCHAR(191) NULL,
  emergency_contact_phone VARCHAR(50) NULL,
  job_title VARCHAR(191) NOT NULL,
  department VARCHAR(100) NULL,
  employment_type ENUM('permanent', 'fixed_term', 'casual', 'contractor', 'intern') NOT NULL,
  contract_type VARCHAR(100) NULL,
  employment_status ENUM('active', 'on_leave', 'suspended', 'terminated', 'archived') NOT NULL DEFAULT 'active',
  employment_start_date DATE NOT NULL,
  employment_end_date DATE NULL,
  manager_id INT UNSIGNED NULL,
  work_location VARCHAR(191) NULL,
  created_by INT(11) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_employee_business_number (business_id, employee_number),
  UNIQUE KEY uq_employee_id_business (id, business_id),
  KEY idx_employee_business_status_name (business_id, employment_status, last_name, first_name),
  CONSTRAINT fk_employee_business
    FOREIGN KEY (business_id) REFERENCES businesses (id),
  CONSTRAINT fk_employee_manager
    FOREIGN KEY (manager_id, business_id) REFERENCES employees (id, business_id),
  CONSTRAINT fk_employee_created_by
    FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT chk_employee_dates
    CHECK (employment_end_date IS NULL OR employment_end_date >= employment_start_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS employee_compensation (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  business_id INT(11) NOT NULL,
  employee_id INT UNSIGNED NOT NULL,
  pay_structure ENUM('monthly_salary', 'hourly', 'weekly', 'fortnightly', 'daily') NOT NULL,
  pay_frequency ENUM('weekly', 'fortnightly', 'monthly') NOT NULL,
  base_rate_cents BIGINT UNSIGNED NOT NULL,
  hours_per_week_millis INT UNSIGNED NULL,
  currency VARCHAR(8) NOT NULL,
  effective_from DATE NOT NULL,
  effective_to DATE NULL,
  created_by INT(11) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_employee_compensation_start (business_id, employee_id, effective_from),
  UNIQUE KEY uq_employee_compensation_id_business (id, business_id),
  KEY idx_employee_compensation_current (business_id, employee_id, effective_from, effective_to),
  CONSTRAINT fk_employee_compensation_employee
    FOREIGN KEY (employee_id, business_id) REFERENCES employees (id, business_id),
  CONSTRAINT fk_employee_compensation_business
    FOREIGN KEY (business_id) REFERENCES businesses (id),
  CONSTRAINT fk_employee_compensation_created_by
    FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT chk_employee_compensation_rate CHECK (base_rate_cents > 0),
  CONSTRAINT chk_employee_compensation_dates
    CHECK (effective_to IS NULL OR effective_to >= effective_from)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS employee_audit_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  business_id INT(11) NOT NULL,
  employee_id INT UNSIGNED NOT NULL,
  actor_user_id INT(11) NOT NULL,
  action VARCHAR(50) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_employee_audit_business_employee (business_id, employee_id, created_at),
  CONSTRAINT fk_employee_audit_employee
    FOREIGN KEY (employee_id, business_id) REFERENCES employees (id, business_id),
  CONSTRAINT fk_employee_audit_business
    FOREIGN KEY (business_id) REFERENCES businesses (id),
  CONSTRAINT fk_employee_audit_actor
    FOREIGN KEY (actor_user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
