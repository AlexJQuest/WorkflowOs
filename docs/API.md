# API

## Authentication

Protected routes require a bearer token in the `Authorization` header.

Example:

```http
Authorization: Bearer <session-token>
```

## Endpoints

### POST /api/register
Registers a user and creates their first business.

### POST /api/login
Authenticates a user and returns a session token.

### GET /api/session
Returns safe current user identity and business context, along with authorised memberships.

### GET /api/dashboard?period=7d&granularity=daily
Returns the current session business's today summary, previous-day comparisons, customers, inventory alerts, best sellers, recent sales, revenue trend series, and data-supported insights. Supported periods are `today`, `7d`, `30d`, `month`, and `custom` (with `startDate` and `endDate`). The backend resolves the business from the current authenticated session/membership; clients cannot select arbitrary business IDs.

### PUT /api/businesses/:businessId/settings
Updates business settings for the authenticated business.

### GET /api/businesses/:businessId/settings
Returns settings only after membership authorization.

### GET /api/inventory
Returns the authenticated business's product stock balances.

### GET /api/products/search?q=...
Searches the current business's active products by name or SKU; barcode values match only when verified.

### GET /api/products/:productId
Returns a product only if it belongs to the authenticated session's business membership. The frontend does not choose a business ID.

### GET /api/products/barcode/:barcode
Looks up an EAN-13, EAN-8, or UPC-A check-digit-valid barcode only among verified products in the current business.

### GET /api/global-catalogue?q=...
Searches shared catalogue candidates and verified barcode metadata. Business-specific price, cost, stock, and sales are not exposed.

### POST /api/global-catalogue/:catalogueId/import
Copies shared metadata into a new business-owned product while accepting the current business's own price, cost, opening stock, and reorder threshold.

### POST /api/products/import-csv and GET /api/products/export.csv
Imports/exports the authenticated business's product catalogue. CSV barcode values are always unverified on import.

### PUT /api/products/:productId
Updates the existing same-business product record, including name, SKU, barcode, brand, category, description, packaging, unit, HTTPS image URL, selling/cost prices, current quantity, reorder level, and active state. A stock quantity change and its movement-ledger entry occur in one transaction. Historical sale snapshots and `created_at` remain unchanged. A changed barcode is marked unverified; duplicates are rejected.

### POST /api/products/:productId/archive
Deactivates a same-business product without deleting it or any historical sale data. Restore it with `PUT /api/products/:productId` and `{ "isActive": true }`.

### Platform catalogue administration

`GET /api/admin/catalogue-access` reports the current account's own allowlist access. `GET /api/admin/global-catalogue?q=...`, `POST /api/admin/global-catalogue`, `PUT /api/admin/global-catalogue/:catalogueId`, `POST /api/admin/global-catalogue/:catalogueId/barcodes`, and `POST /api/admin/global-catalogue/barcodes/:barcodeId/verify` require the account email to appear in the server-side `CATALOGUE_ADMIN_EMAILS` allowlist. Verification is an explicit human action with an HTTPS source URL; the application does not independently fetch or verify the source.

### POST /api/inventory/:productId/adjustments
Records a signed whole-number stock adjustment with a reason in the inventory movement ledger.

### POST /api/sales
Records a sale that the business operator states was already completed; this endpoint does not process a payment. Payment method is operator-recorded and is not provider-verified. Supports `Idempotency-Key`; the sale, item snapshots, stock deductions, and movement ledger entries are transactional. Insufficient stock is rejected.

### POST /api/sales/:saleId/refund
Marks a completed same-business sale refunded and restores stock transactionally. This prototype supports full refunds only.

### POST /api/logout
Invalidates the current bearer token.

### GET /api/health
Health check endpoint.

## Error handling

The API returns JSON errors with HTTP status codes for invalid input, unauthorised access, and forbidden tenant access.
