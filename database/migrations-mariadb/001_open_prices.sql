-- WorkflowOS Open Prices integration tables.
-- Source: Open Prices / Open Food Facts. Database available under ODbL 1.0.
-- This migration does not modify existing catalogue, barcode, or business POS tables.

CREATE TABLE IF NOT EXISTS open_prices_locations (
  source_location_id BIGINT NOT NULL,
  name VARCHAR(255) NULL,
  country VARCHAR(191) NULL,
  country_code VARCHAR(8) NULL,
  city VARCHAR(191) NULL,
  address TEXT NULL,
  raw_data LONGTEXT NOT NULL,
  imported_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (source_location_id),
  KEY idx_open_prices_locations_country (country_code),
  KEY idx_open_prices_locations_city (city)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS open_prices_observations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  source_price_id BIGINT NOT NULL,
  product_code VARCHAR(191) NULL,
  global_product_id INT(11) NULL,
  price DECIMAL(15,4) NOT NULL,
  currency VARCHAR(8) NOT NULL,
  price_date DATE NOT NULL,
  price_per VARCHAR(50) NULL,
  price_is_discounted TINYINT(1) NOT NULL DEFAULT 0,
  price_without_discount DECIMAL(15,4) NULL,
  source_location_id BIGINT NULL,
  source_proof_id BIGINT NULL,
  source_type VARCHAR(40) NULL,
  product_name VARCHAR(500) NULL,
  raw_data LONGTEXT NOT NULL,
  imported_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_open_prices_source_price (source_price_id),
  KEY idx_open_prices_product_code (product_code),
  KEY idx_open_prices_global_product (global_product_id),
  KEY idx_open_prices_date_currency (price_date, currency),
  KEY idx_open_prices_location (source_location_id),
  CONSTRAINT fk_open_prices_global_product
    FOREIGN KEY (global_product_id)
    REFERENCES global_product_catalogue (id)
    ON UPDATE CASCADE
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
