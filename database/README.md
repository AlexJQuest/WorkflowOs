# Database package

This project uses SQLite for the initial prototype. The schema is intentionally small, relational, and version-controlled so the design can evolve without destructive changes.

## Structure

- `migrations/` - ordered schema changes
- `architecture/` - database design notes and relationships
- `modules/` - logical module mapping for platform, catalog, customers, sales, and settings
- `seed/` - repeatable reference data placeholders

## Current baseline

The first migration creates the core multi-tenant foundation:

- `users`
- `businesses`
- `business_memberships`
- `business_settings`
- `sessions`

This supports the registered user → business creation → authenticated dashboard → settings update → logout flow.
