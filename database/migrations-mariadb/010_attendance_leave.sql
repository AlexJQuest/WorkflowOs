CREATE TABLE IF NOT EXISTS attendance_records (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  business_id INT(11) NOT NULL,
  employee_id INT UNSIGNED NOT NULL,
  work_date DATE NOT NULL,
  clock_in_at DATETIME NULL,
  clock_out_at DATETIME NULL,
  ordinary_minutes INT UNSIGNED NOT NULL DEFAULT 0,
  overtime_minutes INT UNSIGNED NOT NULL DEFAULT 0,
  sunday_minutes INT UNSIGNED NOT NULL DEFAULT 0,
  public_holiday_minutes INT UNSIGNED NOT NULL DEFAULT 0,
  break_minutes INT UNSIGNED NOT NULL DEFAULT 0,
  absence_minutes INT UNSIGNED NOT NULL DEFAULT 0,
  status ENUM('draft', 'submitted', 'approved', 'rejected') NOT NULL DEFAULT 'draft',
  idempotency_key VARCHAR(191) NOT NULL,
  notes VARCHAR(1000) NULL,
  submitted_by INT(11) NOT NULL,
  reviewed_by INT(11) NULL,
  review_comment VARCHAR(1000) NULL,
  reviewed_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_attendance_idempotency (business_id, employee_id, idempotency_key),
  UNIQUE KEY uq_attendance_id_business (id, business_id),
  KEY idx_attendance_business_employee_date (business_id, employee_id, work_date, status),
  CONSTRAINT fk_attendance_employee
    FOREIGN KEY (employee_id, business_id) REFERENCES employees (id, business_id),
  CONSTRAINT fk_attendance_business
    FOREIGN KEY (business_id) REFERENCES businesses (id),
  CONSTRAINT fk_attendance_submitted_by
    FOREIGN KEY (submitted_by) REFERENCES users (id),
  CONSTRAINT fk_attendance_reviewed_by
    FOREIGN KEY (reviewed_by) REFERENCES users (id),
  CONSTRAINT chk_attendance_clock_order
    CHECK (clock_in_at IS NULL OR clock_out_at IS NULL OR clock_out_at >= clock_in_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS attendance_adjustments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  business_id INT(11) NOT NULL,
  attendance_id BIGINT UNSIGNED NOT NULL,
  actor_user_id INT(11) NOT NULL,
  field_name ENUM('ordinary_minutes', 'overtime_minutes', 'sunday_minutes', 'public_holiday_minutes', 'break_minutes', 'absence_minutes') NOT NULL,
  previous_minutes INT UNSIGNED NOT NULL,
  adjusted_minutes INT UNSIGNED NOT NULL,
  reason VARCHAR(1000) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_attendance_adjustment_record (business_id, attendance_id, created_at),
  CONSTRAINT fk_attendance_adjustment_record
    FOREIGN KEY (attendance_id, business_id) REFERENCES attendance_records (id, business_id),
  CONSTRAINT fk_attendance_adjustment_actor
    FOREIGN KEY (actor_user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS leave_types (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  business_id INT(11) NOT NULL,
  code VARCHAR(40) NOT NULL,
  name VARCHAR(100) NOT NULL,
  unit ENUM('days', 'hours') NOT NULL DEFAULT 'days',
  requires_balance TINYINT(1) NOT NULL DEFAULT 1,
  is_paid TINYINT(1) NOT NULL DEFAULT 0,
  allow_balance_override TINYINT(1) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_by INT(11) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_leave_type_code (business_id, code),
  UNIQUE KEY uq_leave_type_id_business (id, business_id),
  CONSTRAINT fk_leave_type_business
    FOREIGN KEY (business_id) REFERENCES businesses (id),
  CONSTRAINT fk_leave_type_created_by
    FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS leave_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  business_id INT(11) NOT NULL,
  employee_id INT UNSIGNED NOT NULL,
  leave_type_id INT UNSIGNED NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  requested_units_millis INT UNSIGNED NOT NULL,
  status ENUM('pending', 'approved', 'rejected', 'cancelled') NOT NULL DEFAULT 'pending',
  employee_comment VARCHAR(1000) NULL,
  reviewer_comment VARCHAR(1000) NULL,
  override_reason VARCHAR(1000) NULL,
  created_by INT(11) NOT NULL,
  reviewed_by INT(11) NULL,
  reviewed_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_leave_request_id_business (id, business_id),
  KEY idx_leave_request_business_status_dates (business_id, status, start_date, end_date),
  KEY idx_leave_request_employee_type (business_id, employee_id, leave_type_id, status),
  CONSTRAINT fk_leave_request_employee
    FOREIGN KEY (employee_id, business_id) REFERENCES employees (id, business_id),
  CONSTRAINT fk_leave_request_type
    FOREIGN KEY (leave_type_id, business_id) REFERENCES leave_types (id, business_id),
  CONSTRAINT fk_leave_request_business
    FOREIGN KEY (business_id) REFERENCES businesses (id),
  CONSTRAINT fk_leave_request_created_by
    FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT fk_leave_request_reviewed_by
    FOREIGN KEY (reviewed_by) REFERENCES users (id),
  CONSTRAINT chk_leave_request_units CHECK (requested_units_millis > 0),
  CONSTRAINT chk_leave_request_dates CHECK (end_date >= start_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS leave_balance_entries (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  business_id INT(11) NOT NULL,
  employee_id INT UNSIGNED NOT NULL,
  leave_type_id INT UNSIGNED NOT NULL,
  source_type ENUM('opening_balance', 'accrual', 'taken', 'adjustment', 'reversal') NOT NULL,
  source_id BIGINT UNSIGNED NULL,
  idempotency_key VARCHAR(191) NOT NULL,
  units_millis BIGINT NOT NULL,
  notes VARCHAR(1000) NULL,
  created_by INT(11) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_leave_balance_idempotency (business_id, idempotency_key),
  KEY idx_leave_balance_employee_type (business_id, employee_id, leave_type_id, created_at),
  CONSTRAINT fk_leave_balance_employee
    FOREIGN KEY (employee_id, business_id) REFERENCES employees (id, business_id),
  CONSTRAINT fk_leave_balance_type
    FOREIGN KEY (leave_type_id, business_id) REFERENCES leave_types (id, business_id),
  CONSTRAINT fk_leave_balance_business
    FOREIGN KEY (business_id) REFERENCES businesses (id),
  CONSTRAINT fk_leave_balance_created_by
    FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS leave_audit_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  business_id INT(11) NOT NULL,
  leave_request_id BIGINT UNSIGNED NULL,
  employee_id INT UNSIGNED NOT NULL,
  actor_user_id INT(11) NOT NULL,
  action VARCHAR(50) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_leave_audit_business_employee (business_id, employee_id, created_at),
  CONSTRAINT fk_leave_audit_employee
    FOREIGN KEY (employee_id, business_id) REFERENCES employees (id, business_id),
  CONSTRAINT fk_leave_audit_request
    FOREIGN KEY (leave_request_id, business_id) REFERENCES leave_requests (id, business_id),
  CONSTRAINT fk_leave_audit_actor
    FOREIGN KEY (actor_user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
