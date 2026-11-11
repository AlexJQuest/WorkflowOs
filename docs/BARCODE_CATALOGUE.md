# Barcode integration and shared product catalogue

## Implemented

- Business product records now support brand, barcode, barcode status, description, packaging size, and optional linkage to the shared product catalogue.
- EAN-13, EAN-8, and UPC-A lengths and check digits are validated. A valid check digit proves only syntactic validity; it does not prove that the GTIN belongs to the named product.
- Manual product entry and CSV imports mark barcodes `unverified`; they cannot be used for automatic scanner identification.
- USB keyboard-wedge scanners work in the Sales & Transactions lookup field: focus the field, scan, and the scanner's Enter suffix triggers exact lookup. Name/SKU search is also supported.
- A verified lookup fills product identity, barcode, SKU, category, business-specific price, and available stock. Scans add to a multi-line cart, successive products can be scanned, and quantities/line and transaction totals are editable/calculated.
- Repeated identical scans inside a short 700 ms interval are ignored. Unknown, invalid, inactive, duplicate, and unavailable stock cases provide feedback.
- Completed sale recording uses each business's own price/stock, stores item snapshots, and updates inventory and dashboard source records transactionally.
- Shared-catalogue imports copy product metadata into that business's private product record. Prices, costs, stock, and sales remain business-specific.
- Business product CSV import/export is available. Imports report imported, duplicate, invalid, and incomplete/unverified counts.
- Shared catalogue includes candidate entries based on the founder's requested brand/category list. Candidate records explicitly have no barcode or packaging assertion and are marked incomplete.
- Platform catalogue create/edit/add-barcode/verify routes are restricted to addresses in `CATALOGUE_ADMIN_EMAILS`. Verification is an explicit human administrator decision with an HTTPS evidence URL. Editing an entry invalidates its prior verification status.

## Verified barcode data status

**No production product-to-GTIN mappings are preloaded.** The accessible official material describes GTIN and Verified by GS1 lookup, but does not publish product-specific South African mappings in the fetched pages. The example GTIN displayed by GS1 is not used as a product mapping. Therefore no GTIN has been guessed or represented as a verified retail product.

To populate verified products, a platform catalogue administrator must confirm exact product and packaging identity against a licensed/authorized source (for example GS1 Verified by GS1, the manufacturer, or an authorized supplier), record the source, then verify the barcode record. Format and check-digit validation alone are insufficient.

Authoritative references:

- [GS1 South Africa](https://www.gs1za.org/) identifies GS1 South Africa as the official barcode supplier and describes GTIN product identification and data-sharing services.
- [GS1 GTIN information](https://www.gs1.org/standards/id-keys/gtin) explains GTIN purpose and directs users to Verified by GS1 for verification.
- [Verified by GS1](https://www.gs1.org/services/verified-by-gs1) supports product lookup by GTIN and notes that expanded batch/API access is an enterprise-level capability.

The current app does not have a GS1 API licence or automatic external verification integration. A source URL is recorded as evidence of a human review; the app does not fetch or independently validate that source.

## Configure platform catalogue administrators

Set `CATALOGUE_ADMIN_EMAILS` to a comma-separated allowlist of platform-maintained admin account emails in the local `.env` or protected hosting configuration. Leave it blank if no administrator should manage global verification. Business ownership alone does not grant these global routes.

Available platform routes:

- `POST /api/admin/global-catalogue` - create an incomplete shared product candidate.
- `PUT /api/admin/global-catalogue/:catalogueId` - edit candidate metadata; resets verification.
- `POST /api/admin/global-catalogue/:catalogueId/barcodes` - add a format/check-digit-valid barcode claim as unverified, with a source note.
- `POST /api/admin/global-catalogue/barcodes/:barcodeId/verify` - human-confirm verification using an HTTPS source URL.

## CSV format

CSV import requires `name`. Supported columns include `brand`, `barcode`, `sku`, `category`, `description`, `packaging_size`, `price`, `cost`, `initialStock`, and `reorderLevel`. Import treats every barcode as unverified; CSV cannot self-assert verification. Rows with invalid check digits are reported and skipped. Duplicate SKU/barcode values for that business are reported and skipped.

## Limitations

- No barcode image decoding through a camera is implemented; standard USB keyboard scanners and manual barcode entry are supported.
- The current `Sales & Transactions` view records one unit/price per product line and supports multiple lines; partial refunds and payment provider processing remain unavailable.
- Platform administration is an email allowlist for this prototype. Production should use a dedicated platform-admin identity/role system, audited review UI, source retention policy, and licensed GS1/API access as required.
- CSV parser currently expects one record per physical line; quoted commas and escaped quotes work, but multiline quoted cells are not supported.
