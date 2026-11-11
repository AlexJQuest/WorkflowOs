-- WorkflowOS SQLite to MariaDB export
-- Source: test-product-edit-1794389550699.db
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE `business_memberships` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT NOT NULL,
  `business_id` BIGINT NOT NULL,
  `role` LONGTEXT NOT NULL DEFAULT 'admin',
  `created_at` VARCHAR(40) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `sqlite_autoindex_business_memberships_1` (`user_id`, `business_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `business_settings` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `business_id` BIGINT NOT NULL,
  `operating_hours` LONGTEXT,
  `contact_email` LONGTEXT,
  `phone` LONGTEXT,
  `address` LONGTEXT,
  `created_at` VARCHAR(40) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` VARCHAR(40) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `sqlite_autoindex_business_settings_1` (`business_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `businesses` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `owner_user_id` BIGINT NOT NULL,
  `name` LONGTEXT NOT NULL,
  `business_type` LONGTEXT NOT NULL,
  `currency` LONGTEXT NOT NULL DEFAULT 'ZAR',
  `timezone` LONGTEXT NOT NULL DEFAULT 'Africa/Johannesburg',
  `created_at` VARCHAR(40) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` VARCHAR(40) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `customers` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `business_id` BIGINT NOT NULL,
  `name` LONGTEXT NOT NULL,
  `email` VARCHAR(254),
  `phone` LONGTEXT,
  `loyalty_points` BIGINT NOT NULL DEFAULT 0,
  `created_at` VARCHAR(40) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` VARCHAR(40) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `sqlite_autoindex_customers_1` (`business_id`, `email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `global_product_catalogue` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `product_name` LONGTEXT NOT NULL,
  `brand` LONGTEXT,
  `packaging_size` LONGTEXT,
  `category` LONGTEXT,
  `description` LONGTEXT,
  `verification_status` LONGTEXT NOT NULL DEFAULT 'incomplete',
  `data_source` LONGTEXT NOT NULL,
  `date_added` LONGTEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `verified_at` VARCHAR(40),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `inventory` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `business_id` BIGINT NOT NULL,
  `product_id` BIGINT NOT NULL,
  `quantity_on_hand` BIGINT NOT NULL DEFAULT 0,
  `reorder_level` BIGINT NOT NULL DEFAULT 0,
  `updated_at` VARCHAR(40) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `sqlite_autoindex_inventory_1` (`business_id`, `product_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `inventory_movements` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `business_id` BIGINT NOT NULL,
  `product_id` BIGINT NOT NULL,
  `movement_type` LONGTEXT NOT NULL,
  `quantity` BIGINT NOT NULL,
  `reference_type` LONGTEXT,
  `reference_id` BIGINT,
  `notes` LONGTEXT,
  `created_at` VARCHAR(191) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `product_barcode_duplicate_archive` (
  `archive_id` INT NOT NULL AUTO_INCREMENT,
  `original_barcode_record_id` BIGINT NOT NULL,
  `global_product_id` BIGINT NOT NULL,
  `barcode` LONGTEXT NOT NULL,
  `barcode_format` LONGTEXT NOT NULL,
  `data_source` LONGTEXT NOT NULL,
  `verification_status` LONGTEXT NOT NULL,
  `date_added` LONGTEXT NOT NULL,
  `verified_at` VARCHAR(40),
  `archived_at` VARCHAR(40) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`archive_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `product_barcodes` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `global_product_id` BIGINT NOT NULL,
  `barcode` VARCHAR(191) NOT NULL,
  `barcode_format` LONGTEXT NOT NULL,
  `data_source` LONGTEXT NOT NULL,
  `verification_status` VARCHAR(191) NOT NULL DEFAULT 'unverified',
  `date_added` LONGTEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `verified_at` VARCHAR(40),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `products` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `business_id` BIGINT NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `sku` VARCHAR(191),
  `category` LONGTEXT,
  `price_cents` BIGINT NOT NULL DEFAULT 0,
  `cost_cents` BIGINT NOT NULL DEFAULT 0,
  `is_active` BIGINT NOT NULL DEFAULT 1,
  `created_at` VARCHAR(40) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` VARCHAR(40) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `cost_is_known` BIGINT NOT NULL DEFAULT 0,
  `brand` LONGTEXT,
  `barcode` VARCHAR(191),
  `barcode_status` LONGTEXT NOT NULL DEFAULT 'unverified',
  `description` LONGTEXT,
  `packaging_size` LONGTEXT,
  `global_catalogue_id` BIGINT,
  `unit_of_measure` LONGTEXT NOT NULL DEFAULT 'unit',
  `image_url` LONGTEXT,
  PRIMARY KEY (`id`),
  UNIQUE KEY `sqlite_autoindex_products_1` (`business_id`, `sku`),
  `barcode_unique` VARCHAR(191) GENERATED ALWAYS AS (CASE WHEN `barcode` IS NOT NULL AND `barcode` <> '' THEN `barcode` ELSE NULL END) STORED
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `sale_items` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `sale_id` BIGINT NOT NULL,
  `product_id` BIGINT NOT NULL,
  `product_name_snapshot` LONGTEXT NOT NULL,
  `product_category_snapshot` LONGTEXT,
  `quantity` BIGINT NOT NULL,
  `unit_price_cents` BIGINT NOT NULL,
  `unit_cost_cents` BIGINT,
  `line_total_cents` BIGINT NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `sales` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `business_id` BIGINT NOT NULL,
  `customer_id` BIGINT,
  `transaction_reference` VARCHAR(191) NOT NULL,
  `idempotency_key` VARCHAR(191),
  `subtotal_cents` BIGINT NOT NULL,
  `discount_cents` BIGINT NOT NULL DEFAULT 0,
  `tax_cents` BIGINT NOT NULL DEFAULT 0,
  `total_cents` BIGINT NOT NULL,
  `payment_method` LONGTEXT,
  `status` VARCHAR(191) NOT NULL DEFAULT 'completed',
  `created_at` VARCHAR(191) NOT NULL,
  `updated_at` VARCHAR(40) NOT NULL,
  PRIMARY KEY (`id`),
  `idempotency_key_unique` VARCHAR(191) GENERATED ALWAYS AS (`idempotency_key`) STORED
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `schema_migrations` (
  `version` VARCHAR(191),
  `checksum` LONGTEXT NOT NULL,
  `applied_at` VARCHAR(40) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `sessions` (
  `id` VARCHAR(255),
  `user_id` BIGINT NOT NULL,
  `business_id` BIGINT,
  `created_at` VARCHAR(40) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at` VARCHAR(40) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `users` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `email` VARCHAR(254) NOT NULL,
  `password_hash` LONGTEXT NOT NULL,
  `first_name` LONGTEXT,
  `last_name` LONGTEXT,
  `created_at` VARCHAR(40) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` VARCHAR(40) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `sqlite_autoindex_users_1` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Data: business_memberships
INSERT INTO `business_memberships` (`id`, `user_id`, `business_id`, `role`, `created_at`) VALUES (1, 1, 1, 'admin', '2026-11-11 09:14:30');
INSERT INTO `business_memberships` (`id`, `user_id`, `business_id`, `role`, `created_at`) VALUES (2, 2, 2, 'admin', '2026-11-11 09:14:30');

-- Data: business_settings
INSERT INTO `business_settings` (`id`, `business_id`, `operating_hours`, `contact_email`, `phone`, `address`, `created_at`, `updated_at`) VALUES (1, 1, '09:00-17:00', NULL, NULL, NULL, '2026-11-11 09:14:30', '2026-11-11 09:14:30');
INSERT INTO `business_settings` (`id`, `business_id`, `operating_hours`, `contact_email`, `phone`, `address`, `created_at`, `updated_at`) VALUES (2, 2, '09:00-17:00', NULL, NULL, NULL, '2026-11-11 09:14:30', '2026-11-11 09:14:30');

-- Data: businesses
INSERT INTO `businesses` (`id`, `owner_user_id`, `name`, `business_type`, `currency`, `timezone`, `created_at`, `updated_at`) VALUES (1, 1, 'Edit One', 'retail', 'ZAR', 'Africa/Johannesburg', '2026-11-11 09:14:30', '2026-11-11 09:14:30');
INSERT INTO `businesses` (`id`, `owner_user_id`, `name`, `business_type`, `currency`, `timezone`, `created_at`, `updated_at`) VALUES (2, 2, 'Edit Two', 'retail', 'ZAR', 'Africa/Johannesburg', '2026-11-11 09:14:30', '2026-11-11 09:14:30');

-- Data: customers

-- Data: global_product_catalogue
INSERT INTO `global_product_catalogue` (`id`, `product_name`, `brand`, `packaging_size`, `category`, `description`, `verification_status`, `data_source`, `date_added`, `verified_at`) VALUES (1, 'Bread', 'Albany', NULL, 'Groceries', 'Candidate only. Exact retail product and packaging must be confirmed before assigning a barcode.', 'incomplete', 'Founder-requested candidate list; product/GTIN not independently verified', '2026-11-11 09:14:30', NULL);
INSERT INTO `global_product_catalogue` (`id`, `product_name`, `brand`, `packaging_size`, `category`, `description`, `verification_status`, `data_source`, `date_added`, `verified_at`) VALUES (2, 'Bread', 'Sasko', NULL, 'Groceries', 'Candidate only. Exact retail product and packaging must be confirmed before assigning a barcode.', 'incomplete', 'Founder-requested candidate list; product/GTIN not independently verified', '2026-11-11 09:14:30', NULL);
INSERT INTO `global_product_catalogue` (`id`, `product_name`, `brand`, `packaging_size`, `category`, `description`, `verification_status`, `data_source`, `date_added`, `verified_at`) VALUES (3, 'Bread', 'Blue Ribbon', NULL, 'Groceries', 'Candidate only. Exact retail product and packaging must be confirmed before assigning a barcode.', 'incomplete', 'Founder-requested candidate list; product/GTIN not independently verified', '2026-11-11 09:14:30', NULL);
INSERT INTO `global_product_catalogue` (`id`, `product_name`, `brand`, `packaging_size`, `category`, `description`, `verification_status`, `data_source`, `date_added`, `verified_at`) VALUES (4, 'Milk', 'Clover', NULL, 'Groceries', 'Candidate only. Exact retail product and packaging must be confirmed before assigning a barcode.', 'incomplete', 'Founder-requested candidate list; product/GTIN not independently verified', '2026-11-11 09:14:30', NULL);
INSERT INTO `global_product_catalogue` (`id`, `product_name`, `brand`, `packaging_size`, `category`, `description`, `verification_status`, `data_source`, `date_added`, `verified_at`) VALUES (5, 'Milk', 'Parmalat', NULL, 'Groceries', 'Candidate only. Exact retail product and packaging must be confirmed before assigning a barcode.', 'incomplete', 'Founder-requested candidate list; product/GTIN not independently verified', '2026-11-11 09:14:30', NULL);
INSERT INTO `global_product_catalogue` (`id`, `product_name`, `brand`, `packaging_size`, `category`, `description`, `verification_status`, `data_source`, `date_added`, `verified_at`) VALUES (6, 'Canned tomatoes', 'All Gold', NULL, 'Groceries', 'Candidate only. Exact retail product and packaging must be confirmed before assigning a barcode.', 'incomplete', 'Founder-requested candidate list; product/GTIN not independently verified', '2026-11-11 09:14:30', NULL);
INSERT INTO `global_product_catalogue` (`id`, `product_name`, `brand`, `packaging_size`, `category`, `description`, `verification_status`, `data_source`, `date_added`, `verified_at`) VALUES (7, 'Canned beans', 'Koo', NULL, 'Groceries', 'Candidate only. Exact retail product and packaging must be confirmed before assigning a barcode.', 'incomplete', 'Founder-requested candidate list; product/GTIN not independently verified', '2026-11-11 09:14:30', NULL);
INSERT INTO `global_product_catalogue` (`id`, `product_name`, `brand`, `packaging_size`, `category`, `description`, `verification_status`, `data_source`, `date_added`, `verified_at`) VALUES (8, 'Dishwashing liquid', 'Sunlight', NULL, 'Household products', 'Candidate only. Exact retail product and packaging must be confirmed before assigning a barcode.', 'incomplete', 'Founder-requested candidate list; product/GTIN not independently verified', '2026-11-11 09:14:30', NULL);
INSERT INTO `global_product_catalogue` (`id`, `product_name`, `brand`, `packaging_size`, `category`, `description`, `verification_status`, `data_source`, `date_added`, `verified_at`) VALUES (9, 'Washing powder', 'Omo', NULL, 'Household products', 'Candidate only. Exact retail product and packaging must be confirmed before assigning a barcode.', 'incomplete', 'Founder-requested candidate list; product/GTIN not independently verified', '2026-11-11 09:14:30', NULL);
INSERT INTO `global_product_catalogue` (`id`, `product_name`, `brand`, `packaging_size`, `category`, `description`, `verification_status`, `data_source`, `date_added`, `verified_at`) VALUES (10, 'Dishwashing liquid', 'Sunlight', NULL, 'Household products', 'Candidate only. Exact retail product and packaging must be confirmed before assigning a barcode.', 'incomplete', 'Founder-requested candidate list; product/GTIN not independently verified', '2026-11-11 09:14:30', NULL);
INSERT INTO `global_product_catalogue` (`id`, `product_name`, `brand`, `packaging_size`, `category`, `description`, `verification_status`, `data_source`, `date_added`, `verified_at`) VALUES (11, 'Malt coffee', 'Ricoffy', NULL, 'Beverages', 'Candidate only. Exact retail product and packaging must be confirmed before assigning a barcode.', 'incomplete', 'Founder-requested candidate list; product/GTIN not independently verified', '2026-11-11 09:14:30', NULL);
INSERT INTO `global_product_catalogue` (`id`, `product_name`, `brand`, `packaging_size`, `category`, `description`, `verification_status`, `data_source`, `date_added`, `verified_at`) VALUES (12, 'Instant coffee', 'Nescafé', NULL, 'Beverages', 'Candidate only. Exact retail product and packaging must be confirmed before assigning a barcode.', 'incomplete', 'Founder-requested candidate list; product/GTIN not independently verified', '2026-11-11 09:14:30', NULL);
INSERT INTO `global_product_catalogue` (`id`, `product_name`, `brand`, `packaging_size`, `category`, `description`, `verification_status`, `data_source`, `date_added`, `verified_at`) VALUES (13, 'Carbonated soft drink', 'Coca-Cola', NULL, 'Beverages', 'Candidate only. Exact retail product and packaging must be confirmed before assigning a barcode.', 'incomplete', 'Founder-requested candidate list; product/GTIN not independently verified', '2026-11-11 09:14:30', NULL);
INSERT INTO `global_product_catalogue` (`id`, `product_name`, `brand`, `packaging_size`, `category`, `description`, `verification_status`, `data_source`, `date_added`, `verified_at`) VALUES (14, 'Potato crisps', 'Simba', NULL, 'Snacks and confectionery', 'Candidate only. Exact retail product and packaging must be confirmed before assigning a barcode.', 'incomplete', 'Founder-requested candidate list; product/GTIN not independently verified', '2026-11-11 09:14:30', NULL);
INSERT INTO `global_product_catalogue` (`id`, `product_name`, `brand`, `packaging_size`, `category`, `description`, `verification_status`, `data_source`, `date_added`, `verified_at`) VALUES (15, 'Chocolate', 'Cadbury', NULL, 'Snacks and confectionery', 'Candidate only. Exact retail product and packaging must be confirmed before assigning a barcode.', 'incomplete', 'Founder-requested candidate list; product/GTIN not independently verified', '2026-11-11 09:14:30', NULL);
INSERT INTO `global_product_catalogue` (`id`, `product_name`, `brand`, `packaging_size`, `category`, `description`, `verification_status`, `data_source`, `date_added`, `verified_at`) VALUES (16, 'Confectionery', 'Beacon', NULL, 'Snacks and confectionery', 'Candidate only. Exact retail product and packaging must be confirmed before assigning a barcode.', 'incomplete', 'Founder-requested candidate list; product/GTIN not independently verified', '2026-11-11 09:14:30', NULL);
INSERT INTO `global_product_catalogue` (`id`, `product_name`, `brand`, `packaging_size`, `category`, `description`, `verification_status`, `data_source`, `date_added`, `verified_at`) VALUES (17, 'Eggs', NULL, NULL, 'Groceries', 'Incomplete category candidate. Confirm exact product and packaging before attaching a GTIN.', 'incomplete', 'Founder-requested South African retail category; exact product/GTIN not independently verified', '2026-11-11 09:14:30', NULL);
INSERT INTO `global_product_catalogue` (`id`, `product_name`, `brand`, `packaging_size`, `category`, `description`, `verification_status`, `data_source`, `date_added`, `verified_at`) VALUES (18, 'Butter', NULL, NULL, 'Groceries', 'Incomplete category candidate. Confirm exact product and packaging before attaching a GTIN.', 'incomplete', 'Founder-requested South African retail category; exact product/GTIN not independently verified', '2026-11-11 09:14:30', NULL);
INSERT INTO `global_product_catalogue` (`id`, `product_name`, `brand`, `packaging_size`, `category`, `description`, `verification_status`, `data_source`, `date_added`, `verified_at`) VALUES (19, 'Margarine', NULL, NULL, 'Groceries', 'Incomplete category candidate. Confirm exact product and packaging before attaching a GTIN.', 'incomplete', 'Founder-requested South African retail category; exact product/GTIN not independently verified', '2026-11-11 09:14:30', NULL);
INSERT INTO `global_product_catalogue` (`id`, `product_name`, `brand`, `packaging_size`, `category`, `description`, `verification_status`, `data_source`, `date_added`, `verified_at`) VALUES (20, 'Cheese', NULL, NULL, 'Groceries', 'Incomplete category candidate. Confirm exact product and packaging before attaching a GTIN.', 'incomplete', 'Founder-requested South African retail category; exact product/GTIN not independently verified', '2026-11-11 09:14:30', NULL);
INSERT INTO `global_product_catalogue` (`id`, `product_name`, `brand`, `packaging_size`, `category`, `description`, `verification_status`, `data_source`, `date_added`, `verified_at`) VALUES (21, 'Rice', NULL, NULL, 'Groceries', 'Incomplete category candidate. Confirm exact product and packaging before attaching a GTIN.', 'incomplete', 'Founder-requested South African retail category; exact product/GTIN not independently verified', '2026-11-11 09:14:30', NULL);
INSERT INTO `global_product_catalogue` (`id`, `product_name`, `brand`, `packaging_size`, `category`, `description`, `verification_status`, `data_source`, `date_added`, `verified_at`) VALUES (22, 'Sugar', NULL, NULL, 'Groceries', 'Incomplete category candidate. Confirm exact product and packaging before attaching a GTIN.', 'incomplete', 'Founder-requested South African retail category; exact product/GTIN not independently verified', '2026-11-11 09:14:30', NULL);
INSERT INTO `global_product_catalogue` (`id`, `product_name`, `brand`, `packaging_size`, `category`, `description`, `verification_status`, `data_source`, `date_added`, `verified_at`) VALUES (23, 'Flour', NULL, NULL, 'Groceries', 'Incomplete category candidate. Confirm exact product and packaging before attaching a GTIN.', 'incomplete', 'Founder-requested South African retail category; exact product/GTIN not independently verified', '2026-11-11 09:14:30', NULL);
INSERT INTO `global_product_catalogue` (`id`, `product_name`, `brand`, `packaging_size`, `category`, `description`, `verification_status`, `data_source`, `date_added`, `verified_at`) VALUES (24, 'Cooking oil', NULL, NULL, 'Groceries', 'Incomplete category candidate. Confirm exact product and packaging before attaching a GTIN.', 'incomplete', 'Founder-requested South African retail category; exact product/GTIN not independently verified', '2026-11-11 09:14:30', NULL);
INSERT INTO `global_product_catalogue` (`id`, `product_name`, `brand`, `packaging_size`, `category`, `description`, `verification_status`, `data_source`, `date_added`, `verified_at`) VALUES (25, 'Pasta', NULL, NULL, 'Groceries', 'Incomplete category candidate. Confirm exact product and packaging before attaching a GTIN.', 'incomplete', 'Founder-requested South African retail category; exact product/GTIN not independently verified', '2026-11-11 09:14:30', NULL);
INSERT INTO `global_product_catalogue` (`id`, `product_name`, `brand`, `packaging_size`, `category`, `description`, `verification_status`, `data_source`, `date_added`, `verified_at`) VALUES (26, 'Canned foods', NULL, NULL, 'Groceries', 'Incomplete category candidate. Confirm exact product and packaging before attaching a GTIN.', 'incomplete', 'Founder-requested South African retail category; exact product/GTIN not independently verified', '2026-11-11 09:14:30', NULL);
INSERT INTO `global_product_catalogue` (`id`, `product_name`, `brand`, `packaging_size`, `category`, `description`, `verification_status`, `data_source`, `date_added`, `verified_at`) VALUES (27, 'Cereal', NULL, NULL, 'Groceries', 'Incomplete category candidate. Confirm exact product and packaging before attaching a GTIN.', 'incomplete', 'Founder-requested South African retail category; exact product/GTIN not independently verified', '2026-11-11 09:14:30', NULL);
INSERT INTO `global_product_catalogue` (`id`, `product_name`, `brand`, `packaging_size`, `category`, `description`, `verification_status`, `data_source`, `date_added`, `verified_at`) VALUES (28, 'Tea', NULL, NULL, 'Groceries', 'Incomplete category candidate. Confirm exact product and packaging before attaching a GTIN.', 'incomplete', 'Founder-requested South African retail category; exact product/GTIN not independently verified', '2026-11-11 09:14:30', NULL);
INSERT INTO `global_product_catalogue` (`id`, `product_name`, `brand`, `packaging_size`, `category`, `description`, `verification_status`, `data_source`, `date_added`, `verified_at`) VALUES (29, 'Bottled water', NULL, NULL, 'Beverages', 'Incomplete category candidate. Confirm exact product and packaging before attaching a GTIN.', 'incomplete', 'Founder-requested South African retail category; exact product/GTIN not independently verified', '2026-11-11 09:14:30', NULL);
INSERT INTO `global_product_catalogue` (`id`, `product_name`, `brand`, `packaging_size`, `category`, `description`, `verification_status`, `data_source`, `date_added`, `verified_at`) VALUES (30, 'Fruit juice', NULL, NULL, 'Beverages', 'Incomplete category candidate. Confirm exact product and packaging before attaching a GTIN.', 'incomplete', 'Founder-requested South African retail category; exact product/GTIN not independently verified', '2026-11-11 09:14:30', NULL);
INSERT INTO `global_product_catalogue` (`id`, `product_name`, `brand`, `packaging_size`, `category`, `description`, `verification_status`, `data_source`, `date_added`, `verified_at`) VALUES (31, 'Energy drink', NULL, NULL, 'Beverages', 'Incomplete category candidate. Confirm exact product and packaging before attaching a GTIN.', 'incomplete', 'Founder-requested South African retail category; exact product/GTIN not independently verified', '2026-11-11 09:14:30', NULL);
INSERT INTO `global_product_catalogue` (`id`, `product_name`, `brand`, `packaging_size`, `category`, `description`, `verification_status`, `data_source`, `date_added`, `verified_at`) VALUES (32, 'Carbonated soft drink', 'Pepsi', NULL, 'Beverages', 'Incomplete category candidate. Confirm exact product and packaging before attaching a GTIN.', 'incomplete', 'Founder-requested South African retail category; exact product/GTIN not independently verified', '2026-11-11 09:14:30', NULL);
INSERT INTO `global_product_catalogue` (`id`, `product_name`, `brand`, `packaging_size`, `category`, `description`, `verification_status`, `data_source`, `date_added`, `verified_at`) VALUES (33, 'Carbonated soft drink', 'Sprite', NULL, 'Beverages', 'Incomplete category candidate. Confirm exact product and packaging before attaching a GTIN.', 'incomplete', 'Founder-requested South African retail category; exact product/GTIN not independently verified', '2026-11-11 09:14:30', NULL);
INSERT INTO `global_product_catalogue` (`id`, `product_name`, `brand`, `packaging_size`, `category`, `description`, `verification_status`, `data_source`, `date_added`, `verified_at`) VALUES (34, 'Carbonated soft drink', 'Fanta', NULL, 'Beverages', 'Incomplete category candidate. Confirm exact product and packaging before attaching a GTIN.', 'incomplete', 'Founder-requested South African retail category; exact product/GTIN not independently verified', '2026-11-11 09:14:30', NULL);
INSERT INTO `global_product_catalogue` (`id`, `product_name`, `brand`, `packaging_size`, `category`, `description`, `verification_status`, `data_source`, `date_added`, `verified_at`) VALUES (35, 'Corn snack', 'NikNaks', NULL, 'Snacks and confectionery', 'Incomplete category candidate. Confirm exact product and packaging before attaching a GTIN.', 'incomplete', 'Founder-requested South African retail category; exact product/GTIN not independently verified', '2026-11-11 09:14:30', NULL);
INSERT INTO `global_product_catalogue` (`id`, `product_name`, `brand`, `packaging_size`, `category`, `description`, `verification_status`, `data_source`, `date_added`, `verified_at`) VALUES (36, 'Tortilla chips', 'Doritos', NULL, 'Snacks and confectionery', 'Incomplete category candidate. Confirm exact product and packaging before attaching a GTIN.', 'incomplete', 'Founder-requested South African retail category; exact product/GTIN not independently verified', '2026-11-11 09:14:30', NULL);
INSERT INTO `global_product_catalogue` (`id`, `product_name`, `brand`, `packaging_size`, `category`, `description`, `verification_status`, `data_source`, `date_added`, `verified_at`) VALUES (37, 'Biscuits', NULL, NULL, 'Snacks and confectionery', 'Incomplete category candidate. Confirm exact product and packaging before attaching a GTIN.', 'incomplete', 'Founder-requested South African retail category; exact product/GTIN not independently verified', '2026-11-11 09:14:30', NULL);
INSERT INTO `global_product_catalogue` (`id`, `product_name`, `brand`, `packaging_size`, `category`, `description`, `verification_status`, `data_source`, `date_added`, `verified_at`) VALUES (38, 'Packaged snacks', NULL, NULL, 'Snacks and confectionery', 'Incomplete category candidate. Confirm exact product and packaging before attaching a GTIN.', 'incomplete', 'Founder-requested South African retail category; exact product/GTIN not independently verified', '2026-11-11 09:14:30', NULL);
INSERT INTO `global_product_catalogue` (`id`, `product_name`, `brand`, `packaging_size`, `category`, `description`, `verification_status`, `data_source`, `date_added`, `verified_at`) VALUES (39, 'Laundry detergent', 'Ariel', NULL, 'Household products', 'Incomplete category candidate. Confirm exact product and packaging before attaching a GTIN.', 'incomplete', 'Founder-requested South African retail category; exact product/GTIN not independently verified', '2026-11-11 09:14:30', NULL);
INSERT INTO `global_product_catalogue` (`id`, `product_name`, `brand`, `packaging_size`, `category`, `description`, `verification_status`, `data_source`, `date_added`, `verified_at`) VALUES (40, 'All-purpose cleaner', 'Handy Andy', NULL, 'Household products', 'Incomplete category candidate. Confirm exact product and packaging before attaching a GTIN.', 'incomplete', 'Founder-requested South African retail category; exact product/GTIN not independently verified', '2026-11-11 09:14:30', NULL);
INSERT INTO `global_product_catalogue` (`id`, `product_name`, `brand`, `packaging_size`, `category`, `description`, `verification_status`, `data_source`, `date_added`, `verified_at`) VALUES (41, 'Bleach', NULL, NULL, 'Household products', 'Incomplete category candidate. Confirm exact product and packaging before attaching a GTIN.', 'incomplete', 'Founder-requested South African retail category; exact product/GTIN not independently verified', '2026-11-11 09:14:30', NULL);
INSERT INTO `global_product_catalogue` (`id`, `product_name`, `brand`, `packaging_size`, `category`, `description`, `verification_status`, `data_source`, `date_added`, `verified_at`) VALUES (42, 'Toilet paper', NULL, NULL, 'Household products', 'Incomplete category candidate. Confirm exact product and packaging before attaching a GTIN.', 'incomplete', 'Founder-requested South African retail category; exact product/GTIN not independently verified', '2026-11-11 09:14:30', NULL);
INSERT INTO `global_product_catalogue` (`id`, `product_name`, `brand`, `packaging_size`, `category`, `description`, `verification_status`, `data_source`, `date_added`, `verified_at`) VALUES (43, 'Refuse bags', NULL, NULL, 'Household products', 'Incomplete category candidate. Confirm exact product and packaging before attaching a GTIN.', 'incomplete', 'Founder-requested South African retail category; exact product/GTIN not independently verified', '2026-11-11 09:14:30', NULL);
INSERT INTO `global_product_catalogue` (`id`, `product_name`, `brand`, `packaging_size`, `category`, `description`, `verification_status`, `data_source`, `date_added`, `verified_at`) VALUES (44, 'Cleaning products', NULL, NULL, 'Household products', 'Incomplete category candidate. Confirm exact product and packaging before attaching a GTIN.', 'incomplete', 'Founder-requested South African retail category; exact product/GTIN not independently verified', '2026-11-11 09:14:30', NULL);
INSERT INTO `global_product_catalogue` (`id`, `product_name`, `brand`, `packaging_size`, `category`, `description`, `verification_status`, `data_source`, `date_added`, `verified_at`) VALUES (45, 'Toothpaste', 'Colgate', NULL, 'Personal care', 'Incomplete category candidate. Confirm exact product and packaging before attaching a GTIN.', 'incomplete', 'Founder-requested South African retail category; exact product/GTIN not independently verified', '2026-11-11 09:14:30', NULL);
INSERT INTO `global_product_catalogue` (`id`, `product_name`, `brand`, `packaging_size`, `category`, `description`, `verification_status`, `data_source`, `date_added`, `verified_at`) VALUES (46, 'Toothbrush', NULL, NULL, 'Personal care', 'Incomplete category candidate. Confirm exact product and packaging before attaching a GTIN.', 'incomplete', 'Founder-requested South African retail category; exact product/GTIN not independently verified', '2026-11-11 09:14:30', NULL);
INSERT INTO `global_product_catalogue` (`id`, `product_name`, `brand`, `packaging_size`, `category`, `description`, `verification_status`, `data_source`, `date_added`, `verified_at`) VALUES (47, 'Soap', NULL, NULL, 'Personal care', 'Incomplete category candidate. Confirm exact product and packaging before attaching a GTIN.', 'incomplete', 'Founder-requested South African retail category; exact product/GTIN not independently verified', '2026-11-11 09:14:30', NULL);
INSERT INTO `global_product_catalogue` (`id`, `product_name`, `brand`, `packaging_size`, `category`, `description`, `verification_status`, `data_source`, `date_added`, `verified_at`) VALUES (48, 'Shampoo', NULL, NULL, 'Personal care', 'Incomplete category candidate. Confirm exact product and packaging before attaching a GTIN.', 'incomplete', 'Founder-requested South African retail category; exact product/GTIN not independently verified', '2026-11-11 09:14:30', NULL);
INSERT INTO `global_product_catalogue` (`id`, `product_name`, `brand`, `packaging_size`, `category`, `description`, `verification_status`, `data_source`, `date_added`, `verified_at`) VALUES (49, 'Conditioner', NULL, NULL, 'Personal care', 'Incomplete category candidate. Confirm exact product and packaging before attaching a GTIN.', 'incomplete', 'Founder-requested South African retail category; exact product/GTIN not independently verified', '2026-11-11 09:14:30', NULL);
INSERT INTO `global_product_catalogue` (`id`, `product_name`, `brand`, `packaging_size`, `category`, `description`, `verification_status`, `data_source`, `date_added`, `verified_at`) VALUES (50, 'Deodorant', NULL, NULL, 'Personal care', 'Incomplete category candidate. Confirm exact product and packaging before attaching a GTIN.', 'incomplete', 'Founder-requested South African retail category; exact product/GTIN not independently verified', '2026-11-11 09:14:30', NULL);
INSERT INTO `global_product_catalogue` (`id`, `product_name`, `brand`, `packaging_size`, `category`, `description`, `verification_status`, `data_source`, `date_added`, `verified_at`) VALUES (51, 'Body lotion', NULL, NULL, 'Personal care', 'Incomplete category candidate. Confirm exact product and packaging before attaching a GTIN.', 'incomplete', 'Founder-requested South African retail category; exact product/GTIN not independently verified', '2026-11-11 09:14:30', NULL);
INSERT INTO `global_product_catalogue` (`id`, `product_name`, `brand`, `packaging_size`, `category`, `description`, `verification_status`, `data_source`, `date_added`, `verified_at`) VALUES (52, 'Sanitary products', NULL, NULL, 'Personal care', 'Incomplete category candidate. Confirm exact product and packaging before attaching a GTIN.', 'incomplete', 'Founder-requested South African retail category; exact product/GTIN not independently verified', '2026-11-11 09:14:30', NULL);

-- Data: inventory
INSERT INTO `inventory` (`id`, `business_id`, `product_id`, `quantity_on_hand`, `reorder_level`, `updated_at`) VALUES (1, 1, 1, 13, 4, '2026-11-11T09:14:30.781Z');

-- Data: inventory_movements
INSERT INTO `inventory_movements` (`id`, `business_id`, `product_id`, `movement_type`, `quantity`, `reference_type`, `reference_id`, `notes`, `created_at`) VALUES (1, 1, 1, 'opening', 10, 'product', 1, 'Opening stock', '2026-11-11T09:14:30.746Z');
INSERT INTO `inventory_movements` (`id`, `business_id`, `product_id`, `movement_type`, `quantity`, `reference_type`, `reference_id`, `notes`, `created_at`) VALUES (2, 1, 1, 'sale', -2, 'sale', 1, 'Stock sold', '2026-11-11T09:14:30.752Z');
INSERT INTO `inventory_movements` (`id`, `business_id`, `product_id`, `movement_type`, `quantity`, `reference_type`, `reference_id`, `notes`, `created_at`) VALUES (3, 1, 1, 'receipt', 5, 'product_edit', 1, 'Product edit stock change', '2026-11-11T09:14:30.762Z');

-- Data: product_barcode_duplicate_archive

-- Data: product_barcodes

-- Data: products
INSERT INTO `products` (`id`, `business_id`, `name`, `sku`, `category`, `price_cents`, `cost_cents`, `is_active`, `created_at`, `updated_at`, `cost_is_known`, `brand`, `barcode`, `barcode_status`, `description`, `packaging_size`, `global_catalogue_id`, `unit_of_measure`, `image_url`) VALUES (1, 1, 'Archived but editable', 'NEW-1', 'New category', 1250, 525, 0, '2026-11-11 09:14:30', '2026-11-11T09:14:30.781Z', 1, 'Brand B', '87654325', 'unverified', 'Updated description', '500 g', NULL, 'pack', 'https://example.test/new.png');

-- Data: sale_items
INSERT INTO `sale_items` (`id`, `sale_id`, `product_id`, `product_name_snapshot`, `product_category_snapshot`, `quantity`, `unit_price_cents`, `unit_cost_cents`, `line_total_cents`) VALUES (1, 1, 1, 'Old name', 'Old category', 2, 1000, 400, 2000);

-- Data: sales
INSERT INTO `sales` (`id`, `business_id`, `customer_id`, `transaction_reference`, `idempotency_key`, `subtotal_cents`, `discount_cents`, `tax_cents`, `total_cents`, `payment_method`, `status`, `created_at`, `updated_at`) VALUES (1, 1, NULL, 'WOS-ccce5d37-428f-471f-8fea-c27551226445', 'product-edit-history-1', 2000, 0, 0, 2000, 'cash', 'completed', '2026-11-11T09:14:30.752Z', '2026-11-11T09:14:30.752Z');

-- Data: schema_migrations
INSERT INTO `schema_migrations` (`version`, `checksum`, `applied_at`) VALUES ('001_initial_schema.sql', '6213386200bd32f308e35fb0add6db8301962e8121a694aab7f11eb5ffb5c5da', '2026-11-11 09:14:30');
INSERT INTO `schema_migrations` (`version`, `checksum`, `applied_at`) VALUES ('002_products_and_customers.sql', '3f7f073e38d0338d5b9fa7e48050269d47b03e063ad960c4ed121d43b0b1db86', '2026-11-11 09:14:30');
INSERT INTO `schema_migrations` (`version`, `checksum`, `applied_at`) VALUES ('003_sales_and_inventory.sql', 'd1713ac7d2bd7b655961248400282acd67f677168f5efeb03e57d163a3e75aad', '2026-11-11 09:14:30');
INSERT INTO `schema_migrations` (`version`, `checksum`, `applied_at`) VALUES ('004_barcode_and_shared_catalogue.sql', 'f7fe713ac8b8947accb20350e1b2792828c95749804d0caf371e91793c31093c', '2026-11-11 09:14:30');
INSERT INTO `schema_migrations` (`version`, `checksum`, `applied_at`) VALUES ('005_unique_barcode_claims.sql', '55af1b33ca6037e5a0c95e2cb15aced2d2f0e5ff700cd0e521c40180688c3f6f', '2026-11-11 09:14:30');
INSERT INTO `schema_migrations` (`version`, `checksum`, `applied_at`) VALUES ('006_sa_retail_candidate_catalogue.sql', '5e80a136e16deefd1b58e371061b897658a0afab2ebea2efc4a99b0a11097238', '2026-11-11 09:14:30');
INSERT INTO `schema_migrations` (`version`, `checksum`, `applied_at`) VALUES ('007_product_edit_fields.sql', 'e6b9c78d6f03e23fcb0b606ce92d6776c8a9ea49d93c936cbb977b8788608d50', '2026-11-11 09:14:30');

-- Data: sessions
INSERT INTO `sessions` (`id`, `user_id`, `business_id`, `created_at`, `expires_at`) VALUES ('333a1324-7ef7-4e55-bdeb-ffd4765e5ef2', 1, 1, '2026-11-11 09:14:30', '2026-11-11T21:14:30.668Z');
INSERT INTO `sessions` (`id`, `user_id`, `business_id`, `created_at`, `expires_at`) VALUES ('a12b3350-9210-4178-94e6-d76ae8e1630a', 2, 2, '2026-11-11 09:14:30', '2026-11-11T21:14:30.741Z');

-- Data: users
INSERT INTO `users` (`id`, `email`, `password_hash`, `first_name`, `last_name`, `created_at`, `updated_at`) VALUES (1, 'edit-one@example.com', '$2a$10$L9Ih5xuZKjSsXEU1mv.9hOjIpUVpCzLgaI4j9OUySLHoc8n5EKVIy', 'Product', 'Owner', '2026-11-11 09:14:30', '2026-11-11 09:14:30');
INSERT INTO `users` (`id`, `email`, `password_hash`, `first_name`, `last_name`, `created_at`, `updated_at`) VALUES (2, 'edit-two@example.com', '$2a$10$fmLxX55HM6F2lAGg/u8q/.SVbRIPSli.tz7uk7mTpg5JR5K4Bwqcy', 'Product', 'Owner', '2026-11-11 09:14:30', '2026-11-11 09:14:30');

CREATE INDEX `idx_business_memberships_business_id` ON `business_memberships` (`business_id`);
CREATE INDEX `idx_business_memberships_user_id` ON `business_memberships` (`user_id`);
CREATE INDEX `idx_customers_business_id` ON `customers` (`business_id`);
CREATE INDEX `idx_inventory_business_quantity` ON `inventory` (`business_id`, `quantity_on_hand`, `reorder_level`);
CREATE INDEX `idx_inventory_movements_business_product` ON `inventory_movements` (`business_id`, `product_id`, `created_at`);
CREATE UNIQUE INDEX `idx_product_barcodes_unique` ON `product_barcodes` (`barcode`);
CREATE INDEX `idx_product_barcodes_lookup` ON `product_barcodes` (`barcode`, `verification_status`);
CREATE INDEX `idx_product_barcodes_global_product` ON `product_barcodes` (`global_product_id`);
CREATE INDEX `idx_products_business_active_name` ON `products` (`business_id`, `is_active`, `name`);
CREATE INDEX `idx_products_global_catalogue` ON `products` (`global_catalogue_id`);
CREATE INDEX `idx_products_business_search` ON `products` (`business_id`, `name`, `sku`);
CREATE UNIQUE INDEX `idx_products_business_barcode_unique` ON `products` (`business_id`, `barcode_unique`);
CREATE INDEX `idx_products_business_id` ON `products` (`business_id`);
CREATE INDEX `idx_sale_items_product` ON `sale_items` (`product_id`);
CREATE INDEX `idx_sale_items_sale` ON `sale_items` (`sale_id`);
CREATE INDEX `idx_sales_business_customer` ON `sales` (`business_id`, `customer_id`);
CREATE INDEX `idx_sales_business_created_status` ON `sales` (`business_id`, `created_at`, `status`);
CREATE UNIQUE INDEX `idx_sales_business_idempotency` ON `sales` (`business_id`, `idempotency_key_unique`);
CREATE UNIQUE INDEX `idx_sales_business_reference` ON `sales` (`business_id`, `transaction_reference`);
CREATE INDEX `idx_sessions_user_id` ON `sessions` (`user_id`);
ALTER TABLE `business_memberships` ADD CONSTRAINT `fk_business_memberships_0` FOREIGN KEY (`business_id`) REFERENCES `businesses` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE `business_memberships` ADD CONSTRAINT `fk_business_memberships_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE `business_settings` ADD CONSTRAINT `fk_business_settings_0` FOREIGN KEY (`business_id`) REFERENCES `businesses` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE `businesses` ADD CONSTRAINT `fk_businesses_0` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE `customers` ADD CONSTRAINT `fk_customers_0` FOREIGN KEY (`business_id`) REFERENCES `businesses` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE `inventory` ADD CONSTRAINT `fk_inventory_0` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE `inventory` ADD CONSTRAINT `fk_inventory_1` FOREIGN KEY (`business_id`) REFERENCES `businesses` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE `inventory_movements` ADD CONSTRAINT `fk_inventory_movements_0` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE `inventory_movements` ADD CONSTRAINT `fk_inventory_movements_1` FOREIGN KEY (`business_id`) REFERENCES `businesses` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE `product_barcodes` ADD CONSTRAINT `fk_product_barcodes_0` FOREIGN KEY (`global_product_id`) REFERENCES `global_product_catalogue` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE `products` ADD CONSTRAINT `fk_products_0` FOREIGN KEY (`business_id`) REFERENCES `businesses` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE `products` ADD CONSTRAINT `fk_products_1` FOREIGN KEY (`global_catalogue_id`) REFERENCES `global_product_catalogue` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE `sale_items` ADD CONSTRAINT `fk_sale_items_0` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE `sale_items` ADD CONSTRAINT `fk_sale_items_1` FOREIGN KEY (`sale_id`) REFERENCES `sales` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE `sales` ADD CONSTRAINT `fk_sales_0` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE `sales` ADD CONSTRAINT `fk_sales_1` FOREIGN KEY (`business_id`) REFERENCES `businesses` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE `sessions` ADD CONSTRAINT `fk_sessions_0` FOREIGN KEY (`business_id`) REFERENCES `businesses` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE `sessions` ADD CONSTRAINT `fk_sessions_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT;

SET FOREIGN_KEY_CHECKS = 1;