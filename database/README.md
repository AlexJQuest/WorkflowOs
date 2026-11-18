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
