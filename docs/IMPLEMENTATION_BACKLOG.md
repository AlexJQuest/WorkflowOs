# Implementation backlog

## TASK-001: Initialize project skeleton
- Objective: Create the working repository structure and package manifest.
- Dependencies: None
- Likely files: package.json, .gitignore, README.md, docs/
- Acceptance criteria: Project can install dependencies and run scripts.
- Security/data-integrity: N/A for initial setup
- Automated tests required: npm install and test script execution
- Manual human acceptance tests required: repository setup review
- Relative effort: Small
- Status: IMPLEMENTED

## TASK-002: Create database migration foundation
- Objective: Add versioned SQL migrations and database bootstrap scripts.
- Dependencies: TASK-001
- Likely files: database/**, scripts/run-migrations.js
- Acceptance criteria: Schema can be created and checked by automated tests.
- Security/data-integrity: Use explicit schema constraints and foreign keys.
- Automated tests required: migration tests and tenant isolation tests
- Manual human acceptance tests required: verify schema and seed records
- Relative effort: Medium
- Status: PLANNED

## TASK-003: Implement registration and auth vertical slice
- Objective: Register a user, create a business, log in, update settings, and log out.
- Dependencies: TASK-001, TASK-002
- Likely files: src/**, public/**, tests/**
- Acceptance criteria: API and UI support a complete onboarding flow with persisted data.
- Security/data-integrity: Password hashing, session tokens, business ownership checks, tenant scoping
- Automated tests required: API integration tests for register, login, business update, and logout
- Manual human acceptance tests required: browser flow confirm persistence and business context
- Relative effort: Medium
- Status: IMPLEMENTED

## TASK-004: Add dashboard and settings foundation
- Objective: Provide business dashboard metrics and settings persistence.
- Dependencies: TASK-003
- Likely files: src/api/**, public/app.js, public/styles.css
- Acceptance criteria: Authenticated user sees a dashboard and can update business settings from the UI.
- Security/data-integrity: Guard against cross-tenant access and invalid IDs.
- Automated tests required: Dashboard access and business settings update tests
- Manual human acceptance tests required: UI validation and refresh persistence
- Relative effort: Medium
- Status: IMPLEMENTED

## TASK-005: Add tenant-scoped product and customer operations
- Objective: Manage business products and customers with isolation across businesses.
- Dependencies: TASK-003, TASK-004
- Likely files: src/api/**, server.js, public/app.js, database/migrations/**, tests/business-data.test.js
- Acceptance criteria: Users can add products and customers to their business and cannot see another business's records.
- Security/data-integrity: enforce business membership checks and tenant isolation in all reads and writes
- Automated tests required: product and customer CRUD plus cross-tenant access tests
- Manual human acceptance tests required: UI flow and refresh persistence
- Relative effort: Medium
- Status: IMPLEMENTED

## TASK-006: Define security, privacy, and release docs
- Objective: Document threat model, POPIA risk considerations, and release checklist.
- Dependencies: TASK-003
- Likely files: docs/**
- Acceptance criteria: Security and privacy docs reflect implemented controls and known gaps.
- Security/data-integrity: Required for release readiness review
- Automated tests required: Documentation review checklist
- Manual human acceptance tests required: Security review by human owner
- Relative effort: Medium
- Status: IMPLEMENTED

## TASK-007: Establish CI and gated deployment workflow
- Objective: Run reproducible verification on GitHub pull requests and main-branch pushes, then provide an opt-in production deploy-hook stage.
- Dependencies: TASK-001, TASK-002, TASK-003
- Likely files: .github/workflows/ci-cd.yml, package.json, scripts/deploy-hook.js, docs/CI_CD.md
- Acceptance criteria: CI installs locked dependencies, checks syntax, applies migrations to a fresh database, runs integration tests, and audits production dependencies; CD is limited to verified pushes to main and requires an HTTPS deployment hook in a protected production environment.
- Security/data-integrity: Minimal workflow permissions; no deployment from pull requests; production approval and provider-managed rollback required; migrations are not automatically run against production by the pipeline.
- Automated tests required: Run the same syntax, migration, test, and audit commands locally; verify deploy hook skips without configuration and rejects non-HTTPS URLs.
- Manual human acceptance tests required: Configure GitHub remote/environment and hosting provider hook; review and approve a deployment rehearsal.
- Relative effort: Medium
- Status: AUTOMATED_TESTED

## TASK-008: Build database-backed business dashboard and sales/inventory foundation
- Objective: Show tenant-scoped real operational metrics after login and support basic stock-tracked sales.
- Dependencies: TASK-002, TASK-003, TASK-005
- Likely files: database/migrations/003_sales_and_inventory.sql, src/api/dashboard.service.js, src/api/service.js, server.js, public/app.js, public/styles.css, tests/dashboard.test.js
- Acceptance criteria: Products can carry opening stock/reorder thresholds; completed sales use item snapshots and update stock; dashboard metrics, trends, best sellers, transaction activity, customer counts, and low-stock values are SQL-derived and tenant-isolated; full refunds reverse stock and exclude sales from revenue; authenticated users land at /dashboard.
- Security/data-integrity: Authorize current business membership server-side; reject cross-business product/customer use; use integer cents, foreign keys, transactional sale/stock changes, idempotency keys, and immutable migration checksums.
- Automated tests required: KPI math, profit cost coverage, product ranking, stock updates, idempotent retries, full refund reversal, tenant separation, date-range handling, repeated migration safety.
- Manual human acceptance tests required: Owner review of dashboard readability and reported sales against known transactions on desktop and mobile; confirm actual historical data before client pilot.
- Relative effort: Large
- Status: AUTOMATED_TESTED

## TASK-009: Add barcode scanner and shared catalogue foundation
- Objective: Search/scan business products, manage shared catalogue metadata, import/export CSV, and verify GTIN mappings through controlled platform administration.
- Dependencies: TASK-005, TASK-008
- Likely files: database/migrations/004_barcode_and_shared_catalogue.sql, src/api/barcodes.js, src/api/catalogue.service.js, server.js, public/app.js, public/styles.css, tests/catalogue.test.js
- Acceptance criteria: USB keyboard scanners and manual/name/SKU lookup can add multiple products to a basket; only verified barcode mappings identify products automatically; business price/stock are used; CSV and shared-catalogue imports are tenant scoped; duplicate barcodes are blocked; every scan/sale updates stock/dashboard correctly.
- Security/data-integrity: Business-scoped queries; global catalogue admin allowlist; check-digit validation; barcode claims remain unverified until a platform admin records reviewed HTTPS source evidence; global source data never includes business prices/costs/stock.
- Automated tests required: format/check digit, admin access, unverified lookup rejection, verified lookup, duplicate prevention, CSV counts, tenant isolation, multi-item sale stock and dashboard calculations.
- Manual human acceptance tests required: Scan actual products with a USB barcode scanner; compare exact package/GTIN against GS1/manufacturer/supplier source; test desktop/mobile flows and review catalogue records.
- Relative effort: Large
- Status: AUTOMATED_TESTED
- Blocker: No verified product-to-GTIN dataset or GS1/API access is available in this workspace; initial shared entries remain incomplete candidates.

## TASK-010: Complete product editing and controlled archival
- Objective: Reopen saved products in the product form, edit current product fields, record stock deltas, and archive/restore without deleting history.
- Dependencies: TASK-005, TASK-008, TASK-009
- Likely files: database/migrations/007_product_edit_fields.sql, src/api/service.js, server.js, public/app.js, public/styles.css, tests/product-edit.test.js
- Acceptance criteria: Same-business product-by-ID read and update persist the existing record; form supports product identity, barcode, SKU, brand, category, description, packaging, price/cost, stock/reorder, unit, HTTPS image URL, and active state; cancel discards changes; archive/restore is soft and keeps transaction history.
- Security/data-integrity: Resolve business from authenticated membership; validate duplicate and barcode data; stock deltas and ledger entries are transactional; preserve `created_at` and sale snapshots; prevent negative stock and physical deletion.
- Automated tests required: create/read/update/persist, invalid/duplicate barcode, tenant-denied read/update, positive/negative stock ledger deltas, historical snapshot preservation, inactive edit, archive/restore.
- Manual human acceptance tests required: Complete product edit flow in browser, refresh and verify, scan/lookup active product, archive/restore, and review mobile form usability.
- Relative effort: Medium
- Status: AUTOMATED_TESTED
