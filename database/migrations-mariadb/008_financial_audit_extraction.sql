CREATE TABLE IF NOT EXISTS financial_audit_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  business_id INT(11) NOT NULL,
  user_id INT(11) NOT NULL,
  event_type VARCHAR(60) NOT NULL,
  record_type VARCHAR(40) NOT NULL,
  record_id BIGINT UNSIGNED NOT NULL,
  details TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_financial_audit_business_time (business_id, created_at, id),
  KEY idx_financial_audit_record (business_id, record_type, record_id, created_at),
  CONSTRAINT fk_financial_audit_business
    FOREIGN KEY (business_id) REFERENCES businesses (id),
  CONSTRAINT fk_financial_audit_user
    FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS document_extraction_suggestions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  business_id INT(11) NOT NULL,
  document_id BIGINT UNSIGNED NOT NULL,
  provider VARCHAR(80) NOT NULL,
  status ENUM('suggested', 'confirmed', 'rejected', 'failed') NOT NULL,
  suggested_fields JSON NULL,
  error_message VARCHAR(500) NULL,
  created_by INT(11) NOT NULL,
  confirmed_by INT(11) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  confirmed_at TIMESTAMP NULL,
  PRIMARY KEY (id),
  KEY idx_document_extraction_business_document (business_id, document_id, created_at),
  CONSTRAINT fk_document_extraction_document
    FOREIGN KEY (document_id, business_id)
    REFERENCES financial_documents (id, business_id),
  CONSTRAINT fk_document_extraction_creator
    FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT fk_document_extraction_confirmer
    FOREIGN KEY (confirmed_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
