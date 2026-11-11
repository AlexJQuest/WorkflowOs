PRAGMA foreign_keys = ON;

ALTER TABLE products ADD COLUMN cost_is_known INTEGER NOT NULL DEFAULT 0 CHECK (cost_is_known IN (0, 1));

CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL,
  customer_id INTEGER,
  transaction_reference TEXT NOT NULL,
  idempotency_key TEXT,
  subtotal_cents INTEGER NOT NULL CHECK (subtotal_cents >= 0),
  discount_cents INTEGER NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  tax_cents INTEGER NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
  payment_method TEXT,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'refunded', 'cancelled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (business_id) REFERENCES businesses(id),
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE TABLE IF NOT EXISTS sale_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  product_name_snapshot TEXT NOT NULL,
  product_category_snapshot TEXT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  unit_cost_cents INTEGER,
  line_total_cents INTEGER NOT NULL CHECK (line_total_cents >= 0),
  FOREIGN KEY (sale_id) REFERENCES sales(id),
  FOREIGN KEY (product_id) REFERENCES products(id),
  CHECK (unit_cost_cents IS NULL OR unit_cost_cents >= 0)
);

CREATE TABLE IF NOT EXISTS inventory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  quantity_on_hand INTEGER NOT NULL DEFAULT 0 CHECK (quantity_on_hand >= 0),
  reorder_level INTEGER NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (business_id, product_id),
  FOREIGN KEY (business_id) REFERENCES businesses(id),
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('opening', 'receipt', 'sale', 'refund', 'adjustment')),
  quantity INTEGER NOT NULL CHECK (quantity <> 0),
  reference_type TEXT,
  reference_id INTEGER,
  notes TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (business_id) REFERENCES businesses(id),
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_business_reference ON sales(business_id, transaction_reference);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_business_idempotency ON sales(business_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sales_business_created_status ON sales(business_id, created_at, status);
CREATE INDEX IF NOT EXISTS idx_sales_business_customer ON sales(business_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_product ON sale_items(product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_business_quantity ON inventory(business_id, quantity_on_hand, reorder_level);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_business_product ON inventory_movements(business_id, product_id, created_at);

INSERT INTO inventory (business_id, product_id, quantity_on_hand, reorder_level)
SELECT business_id, id, 0, 0 FROM products
WHERE NOT EXISTS (SELECT 1 FROM inventory i WHERE i.business_id = products.business_id AND i.product_id = products.id);
