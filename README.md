# WorkflowOS

WorkflowOS is a lightweight SaaS prototype for South African small businesses. It is designed as a secure, reusable multi-tenant platform with a modular monolith architecture, an SQL-backed database, and an end-to-end onboarding and dashboard workflow.

## Current status

WorkflowOS is a working local prototype with onboarding, authentication, tenant-scoped products, customers, and expenses; an inventory-aware sales workflow; barcode lookup; product editing; and a database-backed dashboard. Its runtime database is MariaDB. It is not production-ready and still requires human acceptance testing, deployment infrastructure, email/payment services, and security review.

## Sale totals

Sale amounts are stored in integer cents. The subtotal is the sum of each
quantity multiplied by its sale-time unit price. An optional manually entered
discount is subtracted from the subtotal, then an optional manually entered
tax amount is added:

`total = subtotal - discount + tax`

Discounts cannot exceed the subtotal and are allocated proportionally to sale
items for gross-profit reporting. Revenue excludes tax and includes discounts;
the transaction total includes tax. WorkflowOS does not infer a tax rate;
businesses must enter the tax amount for each sale.

## Expenses and reports

Expenses support business-scoped categories and suppliers, expense records,
recurring schedules with idempotent due-expense generation, partial payment
tracking, payment history, and overdue/outstanding summaries.
The Reports module provides date-filtered sales, expense, inventory, and
customer views with business-scoped CSV exports, plus a profit/loss estimate and
a system-activity report. The activity report covers recorded inventory
movements and expense payments only, not a complete audit trail. The profit/loss
estimate subtracts recorded expenses including tax and can double-count stock
purchases already included in cost of sales; it is not an accounting statement.
Revenue excludes sales tax. Profit estimates treat missing sale-time costs as
zero and may overstate profit; historical cost snapshots are not changed.
Reports can be printed or saved as PDF through the browser; the server does not
generate PDF files. Receipt uploads are not enabled because this deployment
has no private file-storage service.

## Recommended stack

- Runtime: Node.js 22 LTS
- Web server: Express.js
- Database: MariaDB via `mysql2`
- Frontend: Vanilla HTML, CSS, and JavaScript served by the backend
- Testing: Node.js built-in test runner
- Security: bcrypt password hashing, session tokens, authorization checks, tenant scoping

## Quick start

```bash
npm install
npm run db:migrate
npm test
npm start
```

Then open the application at http://localhost:3000.

## CI/CD

The requested `DEV`, `TEST`, and `LIVE` branches use the same CI checks as `main`. Promote reviewed changes from `DEV` to `TEST`, then to `LIVE`; the production deployment-hook and GitHub Pages jobs run only after successful verification on `LIVE`. See [docs/CI_CD.md](docs/CI_CD.md).

## Hosting limitation

GitHub Pages is static hosting; it cannot run this app's Express API or SQLite database. Pages publishes a clearly labeled static information page from `pages/`, not the operational dashboard. A separately hosted API and database, plus frontend API configuration, are required before the actual authenticated product can be live.
See [docs/BRANCH_AND_PAGES_DEPLOYMENT.md](docs/BRANCH_AND_PAGES_DEPLOYMENT.md) for branch promotion and hosting setup.

## Barcode catalogue

Sales supports USB keyboard-wedge barcode scanners and manual/name/SKU lookup. See [docs/BARCODE_CATALOGUE.md](docs/BARCODE_CATALOGUE.md) for CSV format, platform admin setup, and the current verified-GTIN data limitation. No product barcode mapping is fabricated or treated as verified by a CSV upload.

## Environment

Copy `.env.example` to a local `.env` file before running the app in a non-default environment.
