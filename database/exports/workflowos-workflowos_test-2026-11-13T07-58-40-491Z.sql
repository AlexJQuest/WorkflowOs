-- WorkflowOS TEST database export
-- Database: workflowos_test
-- Exported: 2026-11-13T07:58:33.215Z
-- Contains table definitions, table data, views and triggers.
-- Review this file before importing. DROP statements are destructive.

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS `businesses`;
DROP TABLE IF EXISTS `business_memberships`;
DROP TABLE IF EXISTS `business_settings`;
DROP TABLE IF EXISTS `customers`;
DROP TABLE IF EXISTS `global_product_catalogue`;
DROP TABLE IF EXISTS `inventory`;
DROP TABLE IF EXISTS `inventory_movements`;
DROP TABLE IF EXISTS `products`;
DROP TABLE IF EXISTS `product_barcodes`;
DROP TABLE IF EXISTS `product_barcode_duplicate_archive`;
DROP TABLE IF EXISTS `sales`;
DROP TABLE IF EXISTS `sale_items`;
DROP TABLE IF EXISTS `schema_migrations`;
DROP TABLE IF EXISTS `sessions`;
DROP TABLE IF EXISTS `users`;


-- Structure: businesses
CREATE TABLE `businesses` (
  `id` int(11) NOT NULL,
  `owner_user_id` bigint(20) NOT NULL,
  `name` longtext NOT NULL,
  `business_type` longtext NOT NULL,
  `currency` longtext NOT NULL DEFAULT 'ZAR',
  `timezone` longtext NOT NULL DEFAULT 'Africa/Johannesburg',
  `created_at` varchar(40) NOT NULL DEFAULT current_timestamp(),
  `updated_at` varchar(40) NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Data: businesses (12 rows)
INSERT INTO `businesses` (`id`, `owner_user_id`, `name`, `business_type`, `currency`, `timezone`, `created_at`, `updated_at`) VALUES (1, '1', 'Edit One', 'retail', 'ZAR', 'Africa/Johannesburg', '2026-11-11 09:32:30', '2026-11-11 09:32:30');
INSERT INTO `businesses` (`id`, `owner_user_id`, `name`, `business_type`, `currency`, `timezone`, `created_at`, `updated_at`) VALUES (2, '2', 'Edit Two', 'retail', 'ZAR', 'Africa/Johannesburg', '2026-11-11 09:32:31', '2026-11-11 09:32:31');
INSERT INTO `businesses` (`id`, `owner_user_id`, `name`, `business_type`, `currency`, `timezone`, `created_at`, `updated_at`) VALUES (3, '3', 'Jque', 'spaza', 'ZAR', 'Africa/Johannesburg', '2026-11-11 20:36:21', '2026-11-11 20:36:21');
INSERT INTO `businesses` (`id`, `owner_user_id`, `name`, `business_type`, `currency`, `timezone`, `created_at`, `updated_at`) VALUES (4, '4', 'Sunrise Salon', 'hair_salon', 'ZAR', 'Africa/Johannesburg', '2026-11-11 21:24:24', '2026-11-11 21:24:24');
INSERT INTO `businesses` (`id`, `owner_user_id`, `name`, `business_type`, `currency`, `timezone`, `created_at`, `updated_at`) VALUES (1, '1', 'Edit One', 'retail', 'ZAR', 'Africa/Johannesburg', '2026-11-11 09:32:30', '2026-11-11 09:32:30');
INSERT INTO `businesses` (`id`, `owner_user_id`, `name`, `business_type`, `currency`, `timezone`, `created_at`, `updated_at`) VALUES (2, '2', 'Edit Two', 'retail', 'ZAR', 'Africa/Johannesburg', '2026-11-11 09:32:31', '2026-11-11 09:32:31');
INSERT INTO `businesses` (`id`, `owner_user_id`, `name`, `business_type`, `currency`, `timezone`, `created_at`, `updated_at`) VALUES (3, '3', 'Jque', 'spaza', 'ZAR', 'Africa/Johannesburg', '2026-11-11 20:36:21', '2026-11-11 20:36:21');
INSERT INTO `businesses` (`id`, `owner_user_id`, `name`, `business_type`, `currency`, `timezone`, `created_at`, `updated_at`) VALUES (4, '4', 'Sunrise Salon', 'hair_salon', 'ZAR', 'Africa/Johannesburg', '2026-11-11 21:24:24', '2026-11-11 21:24:24');
INSERT INTO `businesses` (`id`, `owner_user_id`, `name`, `business_type`, `currency`, `timezone`, `created_at`, `updated_at`) VALUES (1, '1', 'Edit One', 'retail', 'ZAR', 'Africa/Johannesburg', '2026-11-11 09:32:30', '2026-11-11 09:32:30');
INSERT INTO `businesses` (`id`, `owner_user_id`, `name`, `business_type`, `currency`, `timezone`, `created_at`, `updated_at`) VALUES (2, '2', 'Edit Two', 'retail', 'ZAR', 'Africa/Johannesburg', '2026-11-11 09:32:31', '2026-11-11 09:32:31');
INSERT INTO `businesses` (`id`, `owner_user_id`, `name`, `business_type`, `currency`, `timezone`, `created_at`, `updated_at`) VALUES (3, '3', 'Jque', 'spaza', 'ZAR', 'Africa/Johannesburg', '2026-11-11 20:36:21', '2026-11-11 20:36:21');
INSERT INTO `businesses` (`id`, `owner_user_id`, `name`, `business_type`, `currency`, `timezone`, `created_at`, `updated_at`) VALUES (4, '4', 'Sunrise Salon', 'hair_salon', 'ZAR', 'Africa/Johannesburg', '2026-11-11 21:24:24', '2026-11-11 21:24:24');


-- Structure: business_memberships
CREATE TABLE `business_memberships` (
  `id` int(11) NOT NULL,
  `user_id` bigint(20) NOT NULL,
  `business_id` bigint(20) NOT NULL,
  `role` longtext NOT NULL DEFAULT 'admin',
  `created_at` varchar(40) NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Data: business_memberships (12 rows)
INSERT INTO `business_memberships` (`id`, `user_id`, `business_id`, `role`, `created_at`) VALUES (1, '1', '1', 'admin', '2026-11-11 09:32:30');
INSERT INTO `business_memberships` (`id`, `user_id`, `business_id`, `role`, `created_at`) VALUES (2, '2', '2', 'admin', '2026-11-11 09:32:31');
INSERT INTO `business_memberships` (`id`, `user_id`, `business_id`, `role`, `created_at`) VALUES (3, '3', '3', 'admin', '2026-11-11 20:36:21');
INSERT INTO `business_memberships` (`id`, `user_id`, `business_id`, `role`, `created_at`) VALUES (4, '4', '4', 'admin', '2026-11-11 21:24:24');
INSERT INTO `business_memberships` (`id`, `user_id`, `business_id`, `role`, `created_at`) VALUES (1, '1', '1', 'admin', '2026-11-11 09:32:30');
INSERT INTO `business_memberships` (`id`, `user_id`, `business_id`, `role`, `created_at`) VALUES (2, '2', '2', 'admin', '2026-11-11 09:32:31');
INSERT INTO `business_memberships` (`id`, `user_id`, `business_id`, `role`, `created_at`) VALUES (3, '3', '3', 'admin', '2026-11-11 20:36:21');
INSERT INTO `business_memberships` (`id`, `user_id`, `business_id`, `role`, `created_at`) VALUES (4, '4', '4', 'admin', '2026-11-11 21:24:24');
INSERT INTO `business_memberships` (`id`, `user_id`, `business_id`, `role`, `created_at`) VALUES (1, '1', '1', 'admin', '2026-11-11 09:32:30');
INSERT INTO `business_memberships` (`id`, `user_id`, `business_id`, `role`, `created_at`) VALUES (2, '2', '2', 'admin', '2026-11-11 09:32:31');
INSERT INTO `business_memberships` (`id`, `user_id`, `business_id`, `role`, `created_at`) VALUES (3, '3', '3', 'admin', '2026-11-11 20:36:21');
INSERT INTO `business_memberships` (`id`, `user_id`, `business_id`, `role`, `created_at`) VALUES (4, '4', '4', 'admin', '2026-11-11 21:24:24');


-- Structure: business_settings
CREATE TABLE `business_settings` (
  `id` int(11) NOT NULL,
  `business_id` bigint(20) NOT NULL,
  `operating_hours` longtext DEFAULT NULL,
  `contact_email` longtext DEFAULT NULL,
  `phone` longtext DEFAULT NULL,
  `address` longtext DEFAULT NULL,
  `created_at` varchar(40) NOT NULL DEFAULT current_timestamp(),
  `updated_at` varchar(40) NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Data: business_settings (12 rows)
INSERT INTO `business_settings` (`id`, `business_id`, `operating_hours`, `contact_email`, `phone`, `address`, `created_at`, `updated_at`) VALUES (1, '1', '09:00-17:00', NULL, NULL, NULL, '2026-11-11 09:32:30', '2026-11-11 09:32:30');
INSERT INTO `business_settings` (`id`, `business_id`, `operating_hours`, `contact_email`, `phone`, `address`, `created_at`, `updated_at`) VALUES (2, '2', '09:00-17:00', NULL, NULL, NULL, '2026-11-11 09:32:31', '2026-11-11 09:32:31');
INSERT INTO `business_settings` (`id`, `business_id`, `operating_hours`, `contact_email`, `phone`, `address`, `created_at`, `updated_at`) VALUES (3, '3', '09:00-17:00', NULL, NULL, NULL, '2026-11-11 20:36:21', '2026-11-11 20:36:21');
INSERT INTO `business_settings` (`id`, `business_id`, `operating_hours`, `contact_email`, `phone`, `address`, `created_at`, `updated_at`) VALUES (4, '4', '09:00-18:00', 'hello@sunrisesalon.co.za', '+27123456789', '1 Main Road', '2026-11-11 21:24:24', '2026-11-11 21:24:24');
INSERT INTO `business_settings` (`id`, `business_id`, `operating_hours`, `contact_email`, `phone`, `address`, `created_at`, `updated_at`) VALUES (1, '1', '09:00-17:00', NULL, NULL, NULL, '2026-11-11 09:32:30', '2026-11-11 09:32:30');
INSERT INTO `business_settings` (`id`, `business_id`, `operating_hours`, `contact_email`, `phone`, `address`, `created_at`, `updated_at`) VALUES (2, '2', '09:00-17:00', NULL, NULL, NULL, '2026-11-11 09:32:31', '2026-11-11 09:32:31');
INSERT INTO `business_settings` (`id`, `business_id`, `operating_hours`, `contact_email`, `phone`, `address`, `created_at`, `updated_at`) VALUES (3, '3', '09:00-17:00', NULL, NULL, NULL, '2026-11-11 20:36:21', '2026-11-11 20:36:21');
INSERT INTO `business_settings` (`id`, `business_id`, `operating_hours`, `contact_email`, `phone`, `address`, `created_at`, `updated_at`) VALUES (4, '4', '09:00-18:00', 'hello@sunrisesalon.co.za', '+27123456789', '1 Main Road', '2026-11-11 21:24:24', '2026-11-11 21:24:24');
INSERT INTO `business_settings` (`id`, `business_id`, `operating_hours`, `contact_email`, `phone`, `address`, `created_at`, `updated_at`) VALUES (1, '1', '09:00-17:00', NULL, NULL, NULL, '2026-11-11 09:32:30', '2026-11-11 09:32:30');
INSERT INTO `business_settings` (`id`, `business_id`, `operating_hours`, `contact_email`, `phone`, `address`, `created_at`, `updated_at`) VALUES (2, '2', '09:00-17:00', NULL, NULL, NULL, '2026-11-11 09:32:31', '2026-11-11 09:32:31');
INSERT INTO `business_settings` (`id`, `business_id`, `operating_hours`, `contact_email`, `phone`, `address`, `created_at`, `updated_at`) VALUES (3, '3', '09:00-17:00', NULL, NULL, NULL, '2026-11-11 20:36:21', '2026-11-11 20:36:21');
INSERT INTO `business_settings` (`id`, `business_id`, `operating_hours`, `contact_email`, `phone`, `address`, `created_at`, `updated_at`) VALUES (4, '4', '09:00-18:00', 'hello@sunrisesalon.co.za', '+27123456789', '1 Main Road', '2026-11-11 21:24:24', '2026-11-11 21:24:24');


-- Structure: customers
CREATE TABLE `customers` (
  `id` int(11) NOT NULL,
  `business_id` bigint(20) NOT NULL,
  `name` longtext NOT NULL,
  `email` varchar(254) DEFAULT NULL,
  `phone` longtext DEFAULT NULL,
  `loyalty_points` bigint(20) NOT NULL DEFAULT 0,
  `created_at` varchar(40) NOT NULL DEFAULT current_timestamp(),
  `updated_at` varchar(40) NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Data: customers (3 rows)
INSERT INTO `customers` (`id`, `business_id`, `name`, `email`, `phone`, `loyalty_points`, `created_at`, `updated_at`) VALUES (1, '3', 'Julian', 'julas@gmail.com', NULL, '0', '2026-11-11 20:37:28', '2026-11-11 20:37:28');
INSERT INTO `customers` (`id`, `business_id`, `name`, `email`, `phone`, `loyalty_points`, `created_at`, `updated_at`) VALUES (1, '3', 'Julian', 'julas@gmail.com', NULL, '0', '2026-11-11 20:37:28', '2026-11-11 20:37:28');
INSERT INTO `customers` (`id`, `business_id`, `name`, `email`, `phone`, `loyalty_points`, `created_at`, `updated_at`) VALUES (1, '3', 'Julian', 'julas@gmail.com', NULL, '0', '2026-11-11 20:37:28', '2026-11-11 20:37:28');


-- Structure: global_product_catalogue
CREATE TABLE `global_product_catalogue` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `product_name` longtext NOT NULL,
  `brand` longtext DEFAULT NULL,
  `packaging_size` longtext DEFAULT NULL,
  `category` longtext DEFAULT NULL,
  `description` longtext DEFAULT NULL,
  `verification_status` longtext NOT NULL DEFAULT 'incomplete',
  `data_source` longtext NOT NULL,
  `date_added` longtext NOT NULL DEFAULT current_timestamp(),
  `verified_at` varchar(40) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=53 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- Structure: inventory
CREATE TABLE `inventory` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `business_id` bigint(20) NOT NULL,
  `product_id` bigint(20) NOT NULL,
  `quantity_on_hand` bigint(20) NOT NULL DEFAULT 0,
  `reorder_level` bigint(20) NOT NULL DEFAULT 0,
  `updated_at` varchar(40) NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `sqlite_autoindex_inventory_1` (`business_id`,`product_id`),
  KEY `idx_inventory_business_quantity` (`business_id`,`quantity_on_hand`,`reorder_level`)
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Data: inventory (7 rows)
INSERT INTO `inventory` (`id`, `business_id`, `product_id`, `quantity_on_hand`, `reorder_level`, `updated_at`) VALUES (1, '1', '1', '6', '4', '2026-11-11T09:32:31.061Z');
INSERT INTO `inventory` (`id`, `business_id`, `product_id`, `quantity_on_hand`, `reorder_level`, `updated_at`) VALUES (2, '1', '2', '0', '0', '2026-11-11T09:32:31.042Z');
INSERT INTO `inventory` (`id`, `business_id`, `product_id`, `quantity_on_hand`, `reorder_level`, `updated_at`) VALUES (3, '3', '3', '9', '0', '2026-11-11 18:38:53.879000');
INSERT INTO `inventory` (`id`, `business_id`, `product_id`, `quantity_on_hand`, `reorder_level`, `updated_at`) VALUES (4, '3', '4', '7', '0', '2026-11-11 18:42:36.139000');
INSERT INTO `inventory` (`id`, `business_id`, `product_id`, `quantity_on_hand`, `reorder_level`, `updated_at`) VALUES (5, '3', '5', '2', '0', '2026-11-11 19:22:04.029000');
INSERT INTO `inventory` (`id`, `business_id`, `product_id`, `quantity_on_hand`, `reorder_level`, `updated_at`) VALUES (6, '3', '6', '9', '0', '2026-11-11 18:42:36.139000');
INSERT INTO `inventory` (`id`, `business_id`, `product_id`, `quantity_on_hand`, `reorder_level`, `updated_at`) VALUES (7, '3', '7', '9', '0', '2026-11-11 18:43:58.548000');


-- Structure: inventory_movements
CREATE TABLE `inventory_movements` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `business_id` bigint(20) NOT NULL,
  `product_id` bigint(20) NOT NULL,
  `movement_type` longtext NOT NULL,
  `quantity` bigint(20) NOT NULL,
  `reference_type` longtext DEFAULT NULL,
  `reference_id` bigint(20) DEFAULT NULL,
  `notes` longtext DEFAULT NULL,
  `created_at` varchar(191) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_inventory_movements_business_product` (`business_id`,`product_id`,`created_at`)
) ENGINE=InnoDB AUTO_INCREMENT=20 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Data: inventory_movements (19 rows)
INSERT INTO `inventory_movements` (`id`, `business_id`, `product_id`, `movement_type`, `quantity`, `reference_type`, `reference_id`, `notes`, `created_at`) VALUES (1, '1', '1', 'opening', '10', 'product', '1', 'Opening stock', '2026-11-11T09:32:31.020Z');
INSERT INTO `inventory_movements` (`id`, `business_id`, `product_id`, `movement_type`, `quantity`, `reference_type`, `reference_id`, `notes`, `created_at`) VALUES (2, '1', '1', 'sale', '-2', 'sale', '1', 'Stock sold', '2026-11-11T09:32:31.025Z');
INSERT INTO `inventory_movements` (`id`, `business_id`, `product_id`, `movement_type`, `quantity`, `reference_type`, `reference_id`, `notes`, `created_at`) VALUES (3, '1', '1', 'receipt', '5', 'product_edit', '1', 'Product edit stock change', '2026-11-11T09:32:31.036Z');
INSERT INTO `inventory_movements` (`id`, `business_id`, `product_id`, `movement_type`, `quantity`, `reference_type`, `reference_id`, `notes`, `created_at`) VALUES (4, '1', '1', 'adjustment', '-7', 'product_edit', '1', 'Product edit stock change', '2026-11-11T09:32:31.047Z');
INSERT INTO `inventory_movements` (`id`, `business_id`, `product_id`, `movement_type`, `quantity`, `reference_type`, `reference_id`, `notes`, `created_at`) VALUES (5, '3', '5', 'receipt', '10', 'adjustment', NULL, NULL, '2026-11-11 18:38:05.489000');
INSERT INTO `inventory_movements` (`id`, `business_id`, `product_id`, `movement_type`, `quantity`, `reference_type`, `reference_id`, `notes`, `created_at`) VALUES (6, '3', '4', 'receipt', '10', 'adjustment', NULL, NULL, '2026-11-11 18:38:11.340000');
INSERT INTO `inventory_movements` (`id`, `business_id`, `product_id`, `movement_type`, `quantity`, `reference_type`, `reference_id`, `notes`, `created_at`) VALUES (7, '3', '3', 'receipt', '10', 'adjustment', NULL, NULL, '2026-11-11 18:38:15.587000');
INSERT INTO `inventory_movements` (`id`, `business_id`, `product_id`, `movement_type`, `quantity`, `reference_type`, `reference_id`, `notes`, `created_at`) VALUES (8, '3', '3', 'sale', '-1', 'sale', '2', 'Stock sold', '2026-11-11 18:38:53.879000');
INSERT INTO `inventory_movements` (`id`, `business_id`, `product_id`, `movement_type`, `quantity`, `reference_type`, `reference_id`, `notes`, `created_at`) VALUES (9, '3', '4', 'sale', '-1', 'sale', '2', 'Stock sold', '2026-11-11 18:38:53.879000');
INSERT INTO `inventory_movements` (`id`, `business_id`, `product_id`, `movement_type`, `quantity`, `reference_type`, `reference_id`, `notes`, `created_at`) VALUES (10, '3', '5', 'sale', '-1', 'sale', '2', 'Stock sold', '2026-11-11 18:38:53.879000');
INSERT INTO `inventory_movements` (`id`, `business_id`, `product_id`, `movement_type`, `quantity`, `reference_type`, `reference_id`, `notes`, `created_at`) VALUES (11, '3', '5', 'sale', '-1', 'sale', '3', 'Stock sold', '2026-11-11 18:39:02.235000');
INSERT INTO `inventory_movements` (`id`, `business_id`, `product_id`, `movement_type`, `quantity`, `reference_type`, `reference_id`, `notes`, `created_at`) VALUES (12, '3', '4', 'sale', '-1', 'sale', '4', 'Stock sold', '2026-11-11 18:39:07.858000');
INSERT INTO `inventory_movements` (`id`, `business_id`, `product_id`, `movement_type`, `quantity`, `reference_type`, `reference_id`, `notes`, `created_at`) VALUES (13, '3', '6', 'opening', '10', 'product', '6', 'Opening stock from catalogue import', '2026-11-11 18:41:42');
INSERT INTO `inventory_movements` (`id`, `business_id`, `product_id`, `movement_type`, `quantity`, `reference_type`, `reference_id`, `notes`, `created_at`) VALUES (14, '3', '5', 'sale', '-1', 'sale', '5', 'Stock sold', '2026-11-11 18:42:36.139000');
INSERT INTO `inventory_movements` (`id`, `business_id`, `product_id`, `movement_type`, `quantity`, `reference_type`, `reference_id`, `notes`, `created_at`) VALUES (15, '3', '4', 'sale', '-1', 'sale', '5', 'Stock sold', '2026-11-11 18:42:36.139000');
INSERT INTO `inventory_movements` (`id`, `business_id`, `product_id`, `movement_type`, `quantity`, `reference_type`, `reference_id`, `notes`, `created_at`) VALUES (16, '3', '6', 'sale', '-1', 'sale', '5', 'Stock sold', '2026-11-11 18:42:36.139000');
INSERT INTO `inventory_movements` (`id`, `business_id`, `product_id`, `movement_type`, `quantity`, `reference_type`, `reference_id`, `notes`, `created_at`) VALUES (17, '3', '7', 'receipt', '10', 'product_edit', '7', 'Product edit stock change', '2026-11-11 18:43:47.196000');
INSERT INTO `inventory_movements` (`id`, `business_id`, `product_id`, `movement_type`, `quantity`, `reference_type`, `reference_id`, `notes`, `created_at`) VALUES (18, '3', '7', 'sale', '-1', 'sale', '6', 'Stock sold', '2026-11-11 18:43:58.548000');
INSERT INTO `inventory_movements` (`id`, `business_id`, `product_id`, `movement_type`, `quantity`, `reference_type`, `reference_id`, `notes`, `created_at`) VALUES (19, '3', '5', 'sale', '-5', 'sale', '7', 'Stock sold', '2026-11-11 19:22:04.029000');


-- Structure: products
CREATE TABLE `products` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `business_id` bigint(20) NOT NULL,
  `name` varchar(191) NOT NULL,
  `sku` varchar(191) DEFAULT NULL,
  `category` longtext DEFAULT NULL,
  `price_cents` bigint(20) NOT NULL DEFAULT 0,
  `cost_cents` bigint(20) NOT NULL DEFAULT 0,
  `is_active` bigint(20) NOT NULL DEFAULT 1,
  `created_at` varchar(40) NOT NULL DEFAULT current_timestamp(),
  `updated_at` varchar(40) NOT NULL DEFAULT current_timestamp(),
  `cost_is_known` bigint(20) NOT NULL DEFAULT 0,
  `brand` longtext DEFAULT NULL,
  `barcode` varchar(191) DEFAULT NULL,
  `barcode_status` longtext NOT NULL DEFAULT 'unverified',
  `description` longtext DEFAULT NULL,
  `packaging_size` longtext DEFAULT NULL,
  `global_catalogue_id` bigint(20) DEFAULT NULL,
  `unit_of_measure` longtext NOT NULL DEFAULT 'unit',
  `image_url` longtext DEFAULT NULL,
  `barcode_unique` varchar(191) GENERATED ALWAYS AS (case when `barcode` is not null and `barcode` <> '' then `barcode` else NULL end) STORED,
  PRIMARY KEY (`id`),
  UNIQUE KEY `sqlite_autoindex_products_1` (`business_id`,`sku`),
  UNIQUE KEY `idx_products_business_barcode_unique` (`business_id`,`barcode_unique`),
  KEY `idx_products_business_active_name` (`business_id`,`is_active`,`name`),
  KEY `idx_products_global_catalogue` (`global_catalogue_id`),
  KEY `idx_products_business_search` (`business_id`,`name`,`sku`),
  KEY `idx_products_business_id` (`business_id`)
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Data: products (7 rows)
INSERT INTO `products` (`id`, `business_id`, `name`, `sku`, `category`, `price_cents`, `cost_cents`, `is_active`, `created_at`, `updated_at`, `cost_is_known`, `brand`, `barcode`, `barcode_status`, `description`, `packaging_size`, `global_catalogue_id`, `unit_of_measure`, `image_url`) VALUES (1, '1', 'Archived but editable', 'NEW-1', 'New category', '1250', '525', '0', '2026-11-11 09:32:31', '2026-11-11T09:32:31.061Z', '1', 'Brand B', '87654325', 'unverified', 'Updated description', '500 g', NULL, 'pack', 'https://example.test/new.png');
INSERT INTO `products` (`id`, `business_id`, `name`, `sku`, `category`, `price_cents`, `cost_cents`, `is_active`, `created_at`, `updated_at`, `cost_is_known`, `brand`, `barcode`, `barcode_status`, `description`, `packaging_size`, `global_catalogue_id`, `unit_of_measure`, `image_url`) VALUES (2, '1', 'Existing barcode owner', NULL, NULL, '200', '0', '1', '2026-11-11 09:32:31', '2026-11-11 09:32:31', '0', NULL, '12345670', 'unverified', NULL, NULL, NULL, 'unit', NULL);
INSERT INTO `products` (`id`, `business_id`, `name`, `sku`, `category`, `price_cents`, `cost_cents`, `is_active`, `created_at`, `updated_at`, `cost_is_known`, `brand`, `barcode`, `barcode_status`, `description`, `packaging_size`, `global_catalogue_id`, `unit_of_measure`, `image_url`) VALUES (3, '3', 'Corn snack', NULL, 'Snacks and confectionery', '100', '0', '1', '2026-11-11 20:36:50', '2026-11-11 20:36:50', '0', 'NikNaks', NULL, 'unverified', 'Incomplete category candidate. Confirm exact product and packaging before attaching a GTIN.', NULL, '35', 'unit', NULL);
INSERT INTO `products` (`id`, `business_id`, `name`, `sku`, `category`, `price_cents`, `cost_cents`, `is_active`, `created_at`, `updated_at`, `cost_is_known`, `brand`, `barcode`, `barcode_status`, `description`, `packaging_size`, `global_catalogue_id`, `unit_of_measure`, `image_url`) VALUES (4, '3', 'Milk', NULL, 'Groceries', '2000', '0', '1', '2026-11-11 20:37:03', '2026-11-11 20:37:03', '0', 'Clover', NULL, 'unverified', 'Candidate only. Exact retail product and packaging must be confirmed before assigning a barcode.', NULL, '4', 'unit', NULL);
INSERT INTO `products` (`id`, `business_id`, `name`, `sku`, `category`, `price_cents`, `cost_cents`, `is_active`, `created_at`, `updated_at`, `cost_is_known`, `brand`, `barcode`, `barcode_status`, `description`, `packaging_size`, `global_catalogue_id`, `unit_of_measure`, `image_url`) VALUES (5, '3', 'Bread', NULL, 'Groceries', '2500', '0', '1', '2026-11-11 20:37:13', '2026-11-11 20:37:13', '0', 'Blue Ribbon', NULL, 'unverified', 'Candidate only. Exact retail product and packaging must be confirmed before assigning a barcode.', NULL, '3', 'unit', NULL);
INSERT INTO `products` (`id`, `business_id`, `name`, `sku`, `category`, `price_cents`, `cost_cents`, `is_active`, `created_at`, `updated_at`, `cost_is_known`, `brand`, `barcode`, `barcode_status`, `description`, `packaging_size`, `global_catalogue_id`, `unit_of_measure`, `image_url`) VALUES (6, '3', 'Tortilla chips', NULL, 'Snacks and confectionery', '1500', '1000', '1', '2026-11-11 20:41:42', '2026-11-11 20:41:42', '1', 'Doritos', NULL, 'unverified', 'Incomplete category candidate. Confirm exact product and packaging before attaching a GTIN.', NULL, '36', 'unit', NULL);
INSERT INTO `products` (`id`, `business_id`, `name`, `sku`, `category`, `price_cents`, `cost_cents`, `is_active`, `created_at`, `updated_at`, `cost_is_known`, `brand`, `barcode`, `barcode_status`, `description`, `packaging_size`, `global_catalogue_id`, `unit_of_measure`, `image_url`) VALUES (7, '3', 'Hair cut', NULL, NULL, '10000', '10000', '1', '2026-11-11 20:43:23', '2026-11-11 18:43:47.196000', '1', NULL, NULL, 'unverified', NULL, NULL, NULL, 'unit', NULL);


-- Structure: product_barcodes
CREATE TABLE `product_barcodes` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `global_product_id` bigint(20) NOT NULL,
  `barcode` varchar(191) NOT NULL,
  `barcode_format` longtext NOT NULL,
  `data_source` longtext NOT NULL,
  `verification_status` varchar(191) NOT NULL DEFAULT 'unverified',
  `date_added` longtext NOT NULL DEFAULT current_timestamp(),
  `verified_at` varchar(40) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_product_barcodes_unique` (`barcode`),
  KEY `idx_product_barcodes_lookup` (`barcode`,`verification_status`),
  KEY `idx_product_barcodes_global_product` (`global_product_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- Structure: product_barcode_duplicate_archive
CREATE TABLE `product_barcode_duplicate_archive` (
  `archive_id` int(11) NOT NULL AUTO_INCREMENT,
  `original_barcode_record_id` bigint(20) NOT NULL,
  `global_product_id` bigint(20) NOT NULL,
  `barcode` longtext NOT NULL,
  `barcode_format` longtext NOT NULL,
  `data_source` longtext NOT NULL,
  `verification_status` longtext NOT NULL,
  `date_added` longtext NOT NULL,
  `verified_at` varchar(40) DEFAULT NULL,
  `archived_at` varchar(40) NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`archive_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- Structure: sales
CREATE TABLE `sales` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `business_id` bigint(20) NOT NULL,
  `customer_id` bigint(20) DEFAULT NULL,
  `transaction_reference` varchar(191) NOT NULL,
  `idempotency_key` varchar(191) DEFAULT NULL,
  `subtotal_cents` bigint(20) NOT NULL,
  `discount_cents` bigint(20) NOT NULL DEFAULT 0,
  `tax_cents` bigint(20) NOT NULL DEFAULT 0,
  `total_cents` bigint(20) NOT NULL,
  `payment_method` longtext DEFAULT NULL,
  `status` varchar(191) NOT NULL DEFAULT 'completed',
  `created_at` varchar(191) NOT NULL,
  `updated_at` varchar(40) NOT NULL,
  `idempotency_key_unique` varchar(191) GENERATED ALWAYS AS (`idempotency_key`) STORED,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_sales_business_reference` (`business_id`,`transaction_reference`),
  UNIQUE KEY `idx_sales_business_idempotency` (`business_id`,`idempotency_key_unique`),
  KEY `idx_sales_business_customer` (`business_id`,`customer_id`),
  KEY `idx_sales_business_created_status` (`business_id`,`created_at`,`status`)
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Data: sales (7 rows)
INSERT INTO `sales` (`id`, `business_id`, `customer_id`, `transaction_reference`, `idempotency_key`, `subtotal_cents`, `discount_cents`, `tax_cents`, `total_cents`, `payment_method`, `status`, `created_at`, `updated_at`) VALUES (1, '1', NULL, 'WOS-9a3f177b-e435-43f1-b746-3382aad176d3', 'product-edit-history-1', '2000', '0', '0', '2000', 'cash', 'completed', '2026-11-11T09:32:31.025Z', '2026-11-11T09:32:31.025Z');
INSERT INTO `sales` (`id`, `business_id`, `customer_id`, `transaction_reference`, `idempotency_key`, `subtotal_cents`, `discount_cents`, `tax_cents`, `total_cents`, `payment_method`, `status`, `created_at`, `updated_at`) VALUES (2, '3', '1', 'WOS-e9a59e30-63c8-456e-9ad0-3552aa33855a', 'ecfd41b5-11fb-4338-8bbe-c36bff2879f4', '4600', '0', '0', '4600', 'cash', 'completed', '2026-11-11 18:38:53.879000', '2026-11-11 18:38:53.879000');
INSERT INTO `sales` (`id`, `business_id`, `customer_id`, `transaction_reference`, `idempotency_key`, `subtotal_cents`, `discount_cents`, `tax_cents`, `total_cents`, `payment_method`, `status`, `created_at`, `updated_at`) VALUES (3, '3', NULL, 'WOS-c182e29a-c645-4110-a1ae-af76297906d5', '55f82d55-deb5-4da8-83c5-7ef8b418036e', '2500', '0', '0', '2500', 'cash', 'completed', '2026-11-11 18:39:02.235000', '2026-11-11 18:39:02.235000');
INSERT INTO `sales` (`id`, `business_id`, `customer_id`, `transaction_reference`, `idempotency_key`, `subtotal_cents`, `discount_cents`, `tax_cents`, `total_cents`, `payment_method`, `status`, `created_at`, `updated_at`) VALUES (4, '3', NULL, 'WOS-b75d9839-d1a9-42ea-a587-c63022a31087', 'b50aa668-6246-44f5-9ac2-fd321752b23f', '2000', '0', '0', '2000', 'cash', 'completed', '2026-11-11 18:39:07.858000', '2026-11-11 18:39:07.858000');
INSERT INTO `sales` (`id`, `business_id`, `customer_id`, `transaction_reference`, `idempotency_key`, `subtotal_cents`, `discount_cents`, `tax_cents`, `total_cents`, `payment_method`, `status`, `created_at`, `updated_at`) VALUES (5, '3', '1', 'WOS-566be154-8078-4439-aba3-a976b6261091', '2775e078-c0cb-4de9-8e2f-2e47571a18a4', '6000', '0', '0', '6000', 'cash', 'completed', '2026-11-11 18:42:36.139000', '2026-11-11 18:42:36.139000');
INSERT INTO `sales` (`id`, `business_id`, `customer_id`, `transaction_reference`, `idempotency_key`, `subtotal_cents`, `discount_cents`, `tax_cents`, `total_cents`, `payment_method`, `status`, `created_at`, `updated_at`) VALUES (6, '3', '1', 'WOS-b5827e86-e2f8-4adf-a258-1b8da47f10b2', 'cc6a8856-ae8d-486f-bd81-91bb2a2240e2', '10000', '0', '0', '10000', 'cash', 'completed', '2026-11-11 18:43:58.548000', '2026-11-11 18:43:58.548000');
INSERT INTO `sales` (`id`, `business_id`, `customer_id`, `transaction_reference`, `idempotency_key`, `subtotal_cents`, `discount_cents`, `tax_cents`, `total_cents`, `payment_method`, `status`, `created_at`, `updated_at`) VALUES (7, '3', NULL, 'WOS-9b92b0a4-f9bd-4a9c-88db-71cb2101c147', 'a8065608-9707-4c9e-adf8-05c8e3f99840', '12500', '0', '0', '12500', 'cash', 'completed', '2026-11-11 19:22:04.029000', '2026-11-11 19:22:04.029000');


-- Structure: sale_items
CREATE TABLE `sale_items` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `sale_id` bigint(20) NOT NULL,
  `product_id` bigint(20) NOT NULL,
  `product_name_snapshot` longtext NOT NULL,
  `product_category_snapshot` longtext DEFAULT NULL,
  `quantity` bigint(20) NOT NULL,
  `unit_price_cents` bigint(20) NOT NULL,
  `unit_cost_cents` bigint(20) DEFAULT NULL,
  `line_total_cents` bigint(20) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_sale_items_product` (`product_id`),
  KEY `idx_sale_items_sale` (`sale_id`)
) ENGINE=InnoDB AUTO_INCREMENT=12 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Data: sale_items (11 rows)
INSERT INTO `sale_items` (`id`, `sale_id`, `product_id`, `product_name_snapshot`, `product_category_snapshot`, `quantity`, `unit_price_cents`, `unit_cost_cents`, `line_total_cents`) VALUES (1, '1', '1', 'Old name', 'Old category', '2', '1000', '400', '2000');
INSERT INTO `sale_items` (`id`, `sale_id`, `product_id`, `product_name_snapshot`, `product_category_snapshot`, `quantity`, `unit_price_cents`, `unit_cost_cents`, `line_total_cents`) VALUES (2, '2', '3', 'Corn snack', 'Snacks and confectionery', '1', '100', NULL, '100');
INSERT INTO `sale_items` (`id`, `sale_id`, `product_id`, `product_name_snapshot`, `product_category_snapshot`, `quantity`, `unit_price_cents`, `unit_cost_cents`, `line_total_cents`) VALUES (3, '2', '4', 'Milk', 'Groceries', '1', '2000', NULL, '2000');
INSERT INTO `sale_items` (`id`, `sale_id`, `product_id`, `product_name_snapshot`, `product_category_snapshot`, `quantity`, `unit_price_cents`, `unit_cost_cents`, `line_total_cents`) VALUES (4, '2', '5', 'Bread', 'Groceries', '1', '2500', NULL, '2500');
INSERT INTO `sale_items` (`id`, `sale_id`, `product_id`, `product_name_snapshot`, `product_category_snapshot`, `quantity`, `unit_price_cents`, `unit_cost_cents`, `line_total_cents`) VALUES (5, '3', '5', 'Bread', 'Groceries', '1', '2500', NULL, '2500');
INSERT INTO `sale_items` (`id`, `sale_id`, `product_id`, `product_name_snapshot`, `product_category_snapshot`, `quantity`, `unit_price_cents`, `unit_cost_cents`, `line_total_cents`) VALUES (6, '4', '4', 'Milk', 'Groceries', '1', '2000', NULL, '2000');
INSERT INTO `sale_items` (`id`, `sale_id`, `product_id`, `product_name_snapshot`, `product_category_snapshot`, `quantity`, `unit_price_cents`, `unit_cost_cents`, `line_total_cents`) VALUES (7, '5', '5', 'Bread', 'Groceries', '1', '2500', NULL, '2500');
INSERT INTO `sale_items` (`id`, `sale_id`, `product_id`, `product_name_snapshot`, `product_category_snapshot`, `quantity`, `unit_price_cents`, `unit_cost_cents`, `line_total_cents`) VALUES (8, '5', '4', 'Milk', 'Groceries', '1', '2000', NULL, '2000');
INSERT INTO `sale_items` (`id`, `sale_id`, `product_id`, `product_name_snapshot`, `product_category_snapshot`, `quantity`, `unit_price_cents`, `unit_cost_cents`, `line_total_cents`) VALUES (9, '5', '6', 'Tortilla chips', 'Snacks and confectionery', '1', '1500', '1000', '1500');
INSERT INTO `sale_items` (`id`, `sale_id`, `product_id`, `product_name_snapshot`, `product_category_snapshot`, `quantity`, `unit_price_cents`, `unit_cost_cents`, `line_total_cents`) VALUES (10, '6', '7', 'Hair cut', NULL, '1', '10000', '10000', '10000');
INSERT INTO `sale_items` (`id`, `sale_id`, `product_id`, `product_name_snapshot`, `product_category_snapshot`, `quantity`, `unit_price_cents`, `unit_cost_cents`, `line_total_cents`) VALUES (11, '7', '5', 'Bread', 'Groceries', '5', '2500', NULL, '12500');


-- Structure: schema_migrations
CREATE TABLE `schema_migrations` (
  `version` varchar(191) NOT NULL,
  `checksum` longtext NOT NULL,
  `applied_at` varchar(40) NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Data: schema_migrations (7 rows)
INSERT INTO `schema_migrations` (`version`, `checksum`, `applied_at`) VALUES ('001_initial_schema.sql', '6213386200bd32f308e35fb0add6db8301962e8121a694aab7f11eb5ffb5c5da', '2026-11-11 09:32:30');
INSERT INTO `schema_migrations` (`version`, `checksum`, `applied_at`) VALUES ('002_products_and_customers.sql', '3f7f073e38d0338d5b9fa7e48050269d47b03e063ad960c4ed121d43b0b1db86', '2026-11-11 09:32:30');
INSERT INTO `schema_migrations` (`version`, `checksum`, `applied_at`) VALUES ('003_sales_and_inventory.sql', 'd1713ac7d2bd7b655961248400282acd67f677168f5efeb03e57d163a3e75aad', '2026-11-11 09:32:30');
INSERT INTO `schema_migrations` (`version`, `checksum`, `applied_at`) VALUES ('004_barcode_and_shared_catalogue.sql', 'f7fe713ac8b8947accb20350e1b2792828c95749804d0caf371e91793c31093c', '2026-11-11 09:32:30');
INSERT INTO `schema_migrations` (`version`, `checksum`, `applied_at`) VALUES ('005_unique_barcode_claims.sql', '55af1b33ca6037e5a0c95e2cb15aced2d2f0e5ff700cd0e521c40180688c3f6f', '2026-11-11 09:32:30');
INSERT INTO `schema_migrations` (`version`, `checksum`, `applied_at`) VALUES ('006_sa_retail_candidate_catalogue.sql', '5e80a136e16deefd1b58e371061b897658a0afab2ebea2efc4a99b0a11097238', '2026-11-11 09:32:30');
INSERT INTO `schema_migrations` (`version`, `checksum`, `applied_at`) VALUES ('007_product_edit_fields.sql', 'e6b9c78d6f03e23fcb0b606ce92d6776c8a9ea49d93c936cbb977b8788608d50', '2026-11-11 09:32:30');


-- Structure: sessions
CREATE TABLE `sessions` (
  `id` varchar(255) NOT NULL,
  `user_id` bigint(20) NOT NULL,
  `business_id` bigint(20) DEFAULT NULL,
  `created_at` varchar(40) NOT NULL DEFAULT current_timestamp(),
  `expires_at` varchar(40) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_sessions_user_id` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Data: sessions (5 rows)
INSERT INTO `sessions` (`id`, `user_id`, `business_id`, `created_at`, `expires_at`) VALUES ('1416f5ac-d3e5-404a-a899-7c89a69b8b39', '3', '3', '2026-11-11 21:20:39', '2026-11-12 07:20:39.576000');
INSERT INTO `sessions` (`id`, `user_id`, `business_id`, `created_at`, `expires_at`) VALUES ('631b3a7c-1312-41d5-80d7-77f2ab125c19', '2', '2', '2026-11-11 09:32:31', '2026-11-11T21:32:31.014Z');
INSERT INTO `sessions` (`id`, `user_id`, `business_id`, `created_at`, `expires_at`) VALUES ('bf988801-a755-47c2-ad15-912b93108ef8', '3', '3', '2026-11-11 21:59:57', '2026-11-12 07:59:57.493000');
INSERT INTO `sessions` (`id`, `user_id`, `business_id`, `created_at`, `expires_at`) VALUES ('c84e6d72-b244-4c06-a6a2-63524ba8157c', '1', '1', '2026-11-11 09:32:30', '2026-11-11T21:32:30.942Z');
INSERT INTO `sessions` (`id`, `user_id`, `business_id`, `created_at`, `expires_at`) VALUES ('cf65141f-0345-43c8-bc43-de8e072a0d31', '4', '4', '2026-11-11 21:24:24', '2026-11-12 07:24:24.311000');


-- Structure: users
CREATE TABLE `users` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `email` varchar(254) NOT NULL,
  `password_hash` longtext NOT NULL,
  `first_name` longtext DEFAULT NULL,
  `last_name` longtext DEFAULT NULL,
  `created_at` varchar(40) NOT NULL DEFAULT current_timestamp(),
  `updated_at` varchar(40) NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `sqlite_autoindex_users_1` (`email`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Data: users (4 rows)
INSERT INTO `users` (`id`, `email`, `password_hash`, `first_name`, `last_name`, `created_at`, `updated_at`) VALUES (1, 'edit-one@example.com', '$2a$10$lGXn1w0TIAeTpkw.ua0kxu2gpOYyV4n1Db1Y8na1oJLgomKBp1zfm', 'Product', 'Owner', '2026-11-11 09:32:30', '2026-11-11 09:32:30');
INSERT INTO `users` (`id`, `email`, `password_hash`, `first_name`, `last_name`, `created_at`, `updated_at`) VALUES (2, 'edit-two@example.com', 'edit21', 'Product', 'Owner', '2026-11-11 09:32:31', '2026-11-11 09:32:31');
INSERT INTO `users` (`id`, `email`, `password_hash`, `first_name`, `last_name`, `created_at`, `updated_at`) VALUES (3, 'alexjquest@gmail.com', '$2a$10$GD0iAEkYUfwzyhki3Zdvy.wOATInYqg6zHUO41F17DZHs7iqsQjny', 'Alex', 'JQuest', '2026-11-11 20:36:21', '2026-11-11 20:36:21');
INSERT INTO `users` (`id`, `email`, `password_hash`, `first_name`, `last_name`, `created_at`, `updated_at`) VALUES (4, 'alice@example.com', '$2a$10$00HEP6dMCTH76J9RIh4BE.g8NzDAaImaTr5gwRQOpLf6jo8ijHAbe', 'Alice', 'Smith', '2026-11-11 21:24:24', '2026-11-11 21:24:24');


SET FOREIGN_KEY_CHECKS = 1;

-- End of WorkflowOS TEST database export.