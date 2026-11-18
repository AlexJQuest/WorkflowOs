ALTER TABLE financial_documents
  ADD UNIQUE KEY uq_financial_document_id_business (id, business_id);

ALTER TABLE financial_documents
  MODIFY COLUMN document_type ENUM(
    'supplier_invoice',
    'expense_receipt',
    'supporting_document',
    'business_logo'
  ) NOT NULL;

ALTER TABLE invoice_settings
  ADD COLUMN logo_document_id BIGINT UNSIGNED NULL,
  ADD COLUMN bank_account_name VARCHAR(191) NULL,
  ADD COLUMN bank_name VARCHAR(191) NULL,
  ADD COLUMN bank_account_number VARCHAR(100) NULL,
  ADD COLUMN bank_branch_code VARCHAR(40) NULL,
  ADD COLUMN bank_account_type VARCHAR(80) NULL,
  ADD COLUMN payment_instructions VARCHAR(1000) NULL,
  ADD UNIQUE KEY uq_invoice_settings_logo_document (logo_document_id),
  ADD CONSTRAINT fk_invoice_settings_logo_document
    FOREIGN KEY (logo_document_id, business_id)
    REFERENCES financial_documents (id, business_id);

ALTER TABLE supplier_stock_receipts
  ADD COLUMN payload_hash CHAR(64) NULL AFTER idempotency_key;
