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
