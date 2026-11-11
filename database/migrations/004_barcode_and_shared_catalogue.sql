PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS global_product_catalogue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_name TEXT NOT NULL,
  brand TEXT,
  packaging_size TEXT,
  category TEXT,
  description TEXT,
  verification_status TEXT NOT NULL DEFAULT 'incomplete' CHECK (verification_status IN ('incomplete', 'verified')),
  data_source TEXT NOT NULL,
  date_added TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  verified_at TEXT
);

ALTER TABLE products ADD COLUMN brand TEXT;
ALTER TABLE products ADD COLUMN barcode TEXT;
ALTER TABLE products ADD COLUMN barcode_status TEXT NOT NULL DEFAULT 'unverified' CHECK (barcode_status IN ('unverified', 'verified'));
ALTER TABLE products ADD COLUMN description TEXT;
ALTER TABLE products ADD COLUMN packaging_size TEXT;
ALTER TABLE products ADD COLUMN global_catalogue_id INTEGER REFERENCES global_product_catalogue(id);

CREATE TABLE IF NOT EXISTS product_barcodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  global_product_id INTEGER NOT NULL,
  barcode TEXT NOT NULL,
  barcode_format TEXT NOT NULL CHECK (barcode_format IN ('EAN-13', 'EAN-8', 'UPC-A')),
  data_source TEXT NOT NULL,
  verification_status TEXT NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('unverified', 'verified')),
  date_added TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  verified_at TEXT,
  FOREIGN KEY (global_product_id) REFERENCES global_product_catalogue(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_product_barcodes_verified_unique
  ON product_barcodes(barcode) WHERE verification_status = 'verified';
CREATE INDEX IF NOT EXISTS idx_product_barcodes_global_product ON product_barcodes(global_product_id);
CREATE INDEX IF NOT EXISTS idx_product_barcodes_lookup ON product_barcodes(barcode, verification_status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_business_barcode_unique
  ON products(business_id, barcode) WHERE barcode IS NOT NULL AND barcode <> '';
CREATE INDEX IF NOT EXISTS idx_products_business_search ON products(business_id, name, sku);
CREATE INDEX IF NOT EXISTS idx_products_global_catalogue ON products(global_catalogue_id);

-- Candidate catalogue records supplied by the founder's requested brand/category list.
-- These are explicitly incomplete: no exact packaging or GTIN mapping was provided/verified.
INSERT INTO global_product_catalogue (product_name, brand, packaging_size, category, description, verification_status, data_source)
SELECT candidate.product_name, candidate.brand, NULL, candidate.category,
       'Candidate only. Exact retail product and packaging must be confirmed before assigning a barcode.',
       'incomplete', 'Founder-requested candidate list; product/GTIN not independently verified'
FROM (
  SELECT 'Bread' AS product_name, 'Albany' AS brand, 'Groceries' AS category UNION ALL
  SELECT 'Bread', 'Sasko', 'Groceries' UNION ALL
  SELECT 'Bread', 'Blue Ribbon', 'Groceries' UNION ALL
  SELECT 'Milk', 'Clover', 'Groceries' UNION ALL
  SELECT 'Milk', 'Parmalat', 'Groceries' UNION ALL
  SELECT 'Canned tomatoes', 'All Gold', 'Groceries' UNION ALL
  SELECT 'Canned beans', 'Koo', 'Groceries' UNION ALL
  SELECT 'Dishwashing liquid', 'Sunlight', 'Household products' UNION ALL
  SELECT 'Washing powder', 'Omo', 'Household products' UNION ALL
  SELECT 'Dishwashing liquid', 'Sunlight', 'Household products' UNION ALL
  SELECT 'Malt coffee', 'Ricoffy', 'Beverages' UNION ALL
  SELECT 'Instant coffee', 'Nescafé', 'Beverages' UNION ALL
  SELECT 'Carbonated soft drink', 'Coca-Cola', 'Beverages' UNION ALL
  SELECT 'Potato crisps', 'Simba', 'Snacks and confectionery' UNION ALL
  SELECT 'Chocolate', 'Cadbury', 'Snacks and confectionery' UNION ALL
  SELECT 'Confectionery', 'Beacon', 'Snacks and confectionery'
) AS candidate
WHERE NOT EXISTS (
  SELECT 1 FROM global_product_catalogue existing
  WHERE existing.product_name = candidate.product_name AND existing.brand = candidate.brand
    AND existing.verification_status = 'incomplete'
);
