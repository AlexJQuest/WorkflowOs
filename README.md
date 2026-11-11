# WorkflowOS

WorkflowOS is a lightweight SaaS prototype for South African small businesses. It is designed as a secure, reusable multi-tenant platform with a modular monolith architecture, an SQL-backed database, and an end-to-end onboarding and dashboard workflow.

## Current status

WorkflowOS is a working local prototype with onboarding, authentication, tenant-scoped products and customers, a database-backed dashboard, inventory-aware sales, barcode lookup, and product editing. It is not production-ready and still requires human acceptance testing, deployment infrastructure, email/payment services, and security review.

## Recommended stack

- Runtime: Node.js 22 LTS
- Web server: Express.js
- Database: SQLite via `better-sqlite3`
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
