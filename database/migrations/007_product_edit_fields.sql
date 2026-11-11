PRAGMA foreign_keys = ON;

ALTER TABLE products ADD COLUMN unit_of_measure TEXT NOT NULL DEFAULT 'unit';
ALTER TABLE products ADD COLUMN image_url TEXT;

CREATE INDEX IF NOT EXISTS idx_products_business_active_name
  ON products(business_id, is_active, name);
