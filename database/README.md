# Database package

The application runtime uses MariaDB through `mysql2`. Versioned runtime
migrations are in `migrations-mariadb/` and are applied with `npm run db:migrate`.
The separate `migrations/` directory contains the earlier SQLite prototype
schema and is not used by the current server.

## Structure

- `migrations-mariadb/` - ordered MariaDB schema changes
- `migrations/` - legacy SQLite prototype schema
- `architecture/` - database design notes and relationships
- `modules/` - logical module mapping for platform, catalog, customers, sales, and settings
- `seed/` - repeatable reference data placeholders

## Existing MariaDB baseline

The server uses the existing core multi-tenant tables:

- `users`
- `businesses`
- `business_memberships`
- `business_settings`
- `sessions`

The core schema predates the versioned MariaDB migrations. New runtime schema
changes must be additive, placed in `migrations-mariadb/`, and applied through
the migration runner so checksums and migration history are preserved.

## Invoices

`migrations-mariadb/005_invoices.sql` adds business-scoped invoice settings,
sequences, invoice and item snapshots, payments, and invoice audit events.
Invoice amounts are stored in cents; quantity is stored in thousandths and
tax rates in basis points. The invoice API calculates line totals on the server,
assigns numbers atomically when a draft is issued, and records payments
separately from POS sales. Apply the migration with `npm run db:migrate`.

## Financial workflows

The additive migrations `006_financial_workflows.sql` through
`008_financial_audit_extraction.sql` add customer credit notes and numbered
receipts, supplier invoices and payments, explicit expense links, stock receipt
records, product cost history, private financial-document metadata, invoice
payment details, and document extraction suggestions. Amounts remain stored in
cents; quantities use thousandths and tax rates use basis points. Linked
supplier invoice payments are mirrored to their linked expense so reports do
not count the same payable twice.

Financial files are stored outside `public` in `private-documents/` by default.
Set `WORKFLOWOS_PRIVATE_STORAGE_DIR` to a persistent, access-controlled path
outside the web root before deployment; this directory is ignored by Git and
must be included in the business's protected backup/retention plan. Uploads are
limited to 10 MB and checked against supported MIME types and file signatures.
These checks do not replace malware scanning, which must be provided by the
deployment environment.

Invoice email is optional and uses Resend when `RESEND_API_KEY` and `EMAIL_FROM`
are configured. Document extraction is not enabled by default. To enable an
external provider, configure `DOCUMENT_EXTRACTION_PROVIDER`,
`DOCUMENT_EXTRACTION_URL` (HTTPS), and `DOCUMENT_EXTRACTION_API_KEY`. The user
must explicitly consent before a document is sent externally, and extracted
values remain suggestions requiring human confirmation; they are not applied
to invoices automatically. Keep all provider credentials in deployment
secrets, not in source control.

The public contact form sends messages through the same Resend adapter when
`PUBLIC_CONTACT_EMAIL`, `RESEND_API_KEY`, and `EMAIL_FROM` are configured. Its
per-process rate limit is a basic abuse control and is not a substitute for
deployment-level protection in a multi-instance environment. Public Privacy and
Terms pages are marked as drafts and require approved legal review before
production use.

The public website is served from `/`, `/about`, `/features`, `/solutions`,
`/pricing`, `/contact`, `/faq`, `/privacy`, and `/terms`. Pricing and company
details are not invented; legal pages are draft placeholders and must be
reviewed before launch.

## Employee records

`migrations-mariadb/009_employee_management.sql` adds business-scoped employee
profiles, effective-dated base compensation, and action-only audit events.
`migrations-mariadb/010_attendance_leave.sql` adds attendance submissions,
audited corrections and reviews, configurable leave types, leave requests, and
an append-only leave balance ledger. The current employee, attendance, and leave
management APIs are restricted to the business owner because the existing
membership model does not yet provide HR/payroll permissions. Employee records
are retained by changing employment status; there is no hard delete endpoint.
This foundation intentionally does not collect identity numbers or bank
details. Attendance and leave are not automatically converted into earnings.
Finalised payroll runs can produce private PDF payslips, and employees can use
a one-time owner invitation to view their own finalised slips. Invitation links
must be shared securely and expire after seven days. Owners can record payments
that were made externally; the application does not initiate transfers. Do not
treat these features as a complete statutory payroll or SARS reporting system.

`migrations-mariadb/011_payroll_statutory_rules.sql` adds effective-dated,
business-specific PAYE bands, rebates, UIF parameters, and SDL parameters. No
rates or tax tables are preloaded: an owner must supply and review each schedule
against current official guidance before it can be used. The application does
not submit information to SARS.

`migrations-mariadb/012_payroll_runs.sql` adds monthly draft runs, immutable
employee calculation snapshots, and owner approval/finalization audit events.
Gross pay and other deductions are explicitly entered by the owner; configured
PAYE bands, UIF values, and the SDL threshold are applied as an estimate. This
workflow is not a substitute for a reviewed payroll provider, does not cover
every employee-specific tax circumstance, and does not submit statutory
returns. `migrations-mariadb/013_payroll_access_payments.sql` adds individually
invited employee portal links and idempotent payment records. Payment records
are manual bookkeeping only and do not verify or initiate a bank transfer.
Payroll reports and dashboard balances are owner-only, remain separate from
sales and operating-expense totals, and retain the same estimate and manual
payment limitations.
