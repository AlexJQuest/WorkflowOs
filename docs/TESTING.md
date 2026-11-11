# Testing

## Automated tests

The repository includes real HTTP API integration tests backed by isolated SQLite database files.

### Command

```bash
npm test
```

### Checks

- `npm run check` - syntax checks for the server, data services, migration scripts, deploy hook, and tests.
- `npm run db:migrate` - apply versioned migrations to the configured SQLite database.
- `npm test` - API integration tests for registration/login/settings/logout, tenant-isolated products/customers, sale and inventory transactions, dashboard calculations, idempotency, refunds, and deployment-hook safety.
- `npm audit --omit=dev --audit-level=high` - high-severity-or-higher production dependency audit.

The dashboard tests verify actual API behavior for revenue, transaction counts, item quantities, unit-cost snapshots, product rankings, low stock, tenant boundaries, idempotent retries, full refunds, and stock restoration.

## Human acceptance

Automated tests do not establish visual/product acceptance. Dashboard scenarios remain `NOT_RUN` until a human tester records the results in [HUMAN_ACCEPTANCE_TESTS.md](HUMAN_ACCEPTANCE_TESTS.md).

## Planned additions

- migration validation tests
- tenant-isolation tests
- role-based authorization tests
- UI regression checks
- partial refund and payment reconciliation tests
- browser automation and small-screen navigation tests
- security scanning and dependency checks
