# Data model

## Core entities

### users
- id
- email
- password_hash
- first_name
- last_name
- created_at
- updated_at

### businesses
- id
- owner_user_id
- name
- business_type
- currency
- timezone
- created_at
- updated_at

### business_memberships
- id
- user_id
- business_id
- role
- created_at

### business_settings
- id
- business_id
- operating_hours
- contact_email
- phone
- address
- created_at
- updated_at

### sessions
- id
- user_id
- business_id
- created_at
- expires_at

## Multi-tenant integrity rules

- Businesses are owned by a user and may contain multiple memberships.
- Users can belong to multiple businesses through `business_memberships`.
- Session and settings operations are scoped to the authenticated user and their authorised business membership.
- Each database change is done through a single, explicit SQL statement and is not trusted from browser-provided IDs alone.

## Sales and inventory (migration 003)

### sales

- Business-owned transaction with optional same-business customer, unique business transaction reference, optional idempotency key, integer-cent totals, payment method, status, and ISO timestamp.
- Revenue queries include only `completed` sales. Full refunds change status to `refunded`; they do not erase transaction history.

### sale_items

- Stores product ID and snapshots of product name, category, quantity, unit price, optional known unit cost, and line total at sale time.
- Historical values remain stable if the product catalogue changes later.

### inventory

- Stores one balance and reorder level for each business/product pair.
- Zero stock and positive low stock are separate dashboard alert categories.

### inventory_movements

- Append-only record of opening stock, receipts/adjustments, sale deductions, and refund reversals.
- Sale and refund ledger rows are written in the same SQLite transaction as the corresponding sale/status and balance update.

## Barcode and shared catalogue (migration 004)

### global_product_catalogue

- Shared product metadata: name, brand, package size, category, description, source, verification status, and added/verified timestamps.
- Initial seeded entries are incomplete candidates derived from the requested brand/category list; exact product packaging and barcode are intentionally unset.

### product_barcodes

- One or more barcode claims per shared product, with normalized GTIN, EAN/UPC format, source, status, and verification timestamps.
- GTIN strings are unique globally. Only manually verified records can participate in automatic barcode identification.
- Migration 005 archives pre-existing duplicate barcode claims before enforcing global barcode uniqueness, preserving their source and verification metadata for audit.

### products (business additions)

- Each product remains owned by one business and can contain brand, barcode, barcode status, description, packaging size, and optional global catalogue linkage.
- Business uniqueness prevents duplicate barcode values in one business. Price, cost, and inventory remain business-specific and are never copied from the shared catalogue.
- CSV/manual barcode input remains unverified. A verified shared-catalogue mapping can be imported without sharing a business's financial or stock data.

## Product editing fields (migration 007)

- `products.unit_of_measure` stores the business-facing unit label (defaults to `unit`).
- `products.image_url` stores an optional HTTPS image URL; image upload/storage is not implemented.
- Product edits update only current catalogue data and `updated_at`. `created_at` is preserved.
- A change to `inventory.quantity_on_hand` through product editing is transactional and writes a signed receipt/adjustment to `inventory_movements`; reorder-level changes update the current inventory rule.
- Historical `sale_items` name, price, and cost snapshots are not modified by product edits.
- Archive sets `products.is_active = 0`; it does not physically delete products or sales history.

## Migration governance

The runner records each migration filename, SHA-256 checksum, and applied timestamp in `schema_migrations`. Migrations are applied transactionally once; an already-applied script whose checksum changes stops startup. Released migration files must remain immutable. A narrowly allowlisted historical checksum for migration 004 is retained for databases that recorded its earlier local version; the follow-up uniqueness change is in migration 005. New migrations remain checksum-enforced.

## Next additions

The data model will expand with products, services, customers, stock movements, sales, payments, inventory, appointments, and audit events as the prototype grows.
