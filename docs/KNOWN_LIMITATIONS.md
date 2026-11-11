# Known limitations

- No real email verification or password recovery flow
- No rate limiting or CSRF protections yet
- No RBAC beyond admin membership at this stage
- No payment provider integration or subscription enforcement
- No AI recommendations or external integrations
- SQLite is intentionally lightweight and does not yet represent the final production database decision
- Dashboard custom range and daily/weekly/monthly chart grouping are available; granular chart comparison series are not yet exposed for each grouping.
- The dashboard's returning-customer count identifies customers who had an earlier completed sale before today; it does not yet calculate repeat revenue.
- Full refunds are implemented. Partial refunds, payment-provider verification, tax configuration, discounts, and accounting reconciliation are not.
- Sale recording captures a completed business transaction and an operator-entered payment method; it does not process or verify card/EFT payments.
- Dashboard date comparisons use completed records; dashboard insights are rules-based and are not AI-generated.
- Inventory currently requires tracked product balances; advanced stocktakes, suppliers, purchase orders, and waste workflows are not implemented.
- Customer creation date metrics rely on stored timestamps. Email verification and explicit privacy consent fields are not yet implemented.
- The shared catalogue has incomplete brand/category candidates but no preloaded verified South African GTIN-to-product mappings. Exact product/pack identity data must be sourced and reviewed; none has been invented.
- Barcode verification is a human platform-admin decision after reviewing an HTTPS evidence URL. The prototype does not call GS1 or independently validate external source contents.
- USB keyboard-wedge scanner and manual barcode entry are supported; device-camera barcode decoding is not implemented.
- Platform catalogue verification requires `CATALOGUE_ADMIN_EMAILS` to be configured; leaving it blank disables global catalogue administration.
- Product images can be stored as validated HTTPS URL references, but file upload/storage and image processing are not implemented.
- Product archival is implemented by deactivation; there is intentionally no physical product deletion endpoint while transaction history may reference the product.

These limitations are tracked to maintain accurate documentation while the product evolves.
