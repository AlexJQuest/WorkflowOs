PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS product_barcode_duplicate_archive (
  archive_id INTEGER PRIMARY KEY AUTOINCREMENT,
  original_barcode_record_id INTEGER NOT NULL,
  global_product_id INTEGER NOT NULL,
  barcode TEXT NOT NULL,
  barcode_format TEXT NOT NULL,
  data_source TEXT NOT NULL,
  verification_status TEXT NOT NULL,
  date_added TEXT NOT NULL,
  verified_at TEXT,
  archived_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO product_barcode_duplicate_archive (
  original_barcode_record_id, global_product_id, barcode, barcode_format,
  data_source, verification_status, date_added, verified_at
)
SELECT b.id, b.global_product_id, b.barcode, b.barcode_format,
       b.data_source, b.verification_status, b.date_added, b.verified_at
FROM product_barcodes b
WHERE b.id NOT IN (
  SELECT MIN(id) FROM product_barcodes GROUP BY barcode
);

DELETE FROM product_barcodes
WHERE id NOT IN (
  SELECT MIN(id) FROM product_barcodes GROUP BY barcode
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_product_barcodes_unique
  ON product_barcodes(barcode);
