# Human acceptance tests

## Status

This is a template for the required release process. No human sign-off has been recorded yet.

## Scenarios

1. New account registration
2. Business creation
3. Login and logout
4. Business settings update
5. Session persistence after refresh
6. Cross-tenant access attempts
7. Data export and privacy request review
8. Mobile layout review

## Dashboard and sales acceptance scenarios

| Scenario | Prerequisites and steps | Expected result | Actual outcome | Tester | Date | Result | Defects |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Dashboard after sign-in | Sign in with an admin account; inspect `/dashboard`; compare figures with recorded sales for the selected business and local date. | Dashboard loads from persisted business records; no figures are shown as successful if the request fails. | — | — | — | NOT_RUN | — |
| Record sale and refresh metrics | Add products with known prices, costs, stock, and reorder threshold; record a sale; refresh dashboard. | Revenue, transactions, item counts, profit, best sellers, recent activity, and stock reflect the saved sale. | — | — | — | NOT_RUN | — |
| Refund sale | Refund a completed sale from transactions and inspect dashboard and stock. | Sale remains in history as refunded, is excluded from completed revenue, and its stock is restored once. | — | — | — | NOT_RUN | — |
| Tenant isolation | Create two businesses; add and sell products in one; inspect the other dashboard and attempt cross-business product use. | No information crosses the business boundary; API rejects use of another tenant's product/customer. | — | — | — | NOT_RUN | — |
| Responsive dashboard | Inspect dashboard and navigation at desktop and mobile viewport widths. | Key metrics remain readable; navigation and tables remain operable without horizontal page overflow. | — | — | — | NOT_RUN | — |
| USB barcode scanning | Import a product with a verified catalogue mapping, focus Sales & Transactions barcode input, scan its physical packaging. | Exact business product is identified; barcode, SKU, category, price, and available stock are shown from that business's product record; item is added once. | — | — | — | NOT_RUN | — |
| Multiple scan/cart checkout | Scan two or more verified products successively; change a quantity; complete the sale. | Lines and total recalculate; sale persists with all items; each stock balance and dashboard metric changes correctly. | — | — | — | NOT_RUN | — |
| Unknown/unverified barcode | Scan a GTIN absent from the verified catalogue and manually enter a CSV barcode that has not been reviewed. | App reports no verified match; it does not guess product identity or treat the CSV claim as verified. | — | — | — | NOT_RUN | — |
| Catalogue source review | Platform catalogue administrator checks exact product and package against an authorized source, records evidence, and performs verification. | Product mapping is marked verified only after the human review; imported business prices and stock remain business-specific. | — | — | — | NOT_RUN | — |
| Product edit and archive | Create a product; select Edit; change name, price, barcode, stock and reorder level; save; refresh; then archive and restore it. | Existing product values load; Save Changes persists without duplication; stock movements are recorded; barcode stays unverified after manual change; historical sale snapshots stay unchanged; archive keeps history and restore reactivates the product. | — | — | — | NOT_RUN | — |

## Result status

Each scenario must be recorded as one of:

- NOT_RUN
- PASS
- FAIL
- BLOCKED

Human acceptance is mandatory before production release and must not be claimed automatically by the system.
