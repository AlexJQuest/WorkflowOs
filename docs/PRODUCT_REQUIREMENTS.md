# Product requirements

## Product vision

WorkflowOS is a secure operating system for small businesses in South Africa. It combines business management, basic reporting, onboarding, and a tenant-aware data model into a single SaaS foundation.

## Core user goals

- Understand sales, expenses, and profitability
- Manage products and services
- Maintain customer profiles and loyalty context
- Keep inventory and stock visibility practical
- Manage business settings and onboarding workflow
- Operate within a secure multi-tenant architecture

## MVP scope

The current local prototype implements this path and an initial transaction-backed dashboard:

1. Register a new account
2. Create a business profile
3. Log in and resolve business context
4. View a dashboard shell
5. Update business settings
6. Persist changes via SQLite-backed API
7. Log out and invalidate the session token
8. Add products with optional known costs and initial/reorder stock
9. Record stock-checked sales with an idempotency key and sale-time snapshots
10. View database-derived revenue, transaction, quantity, gross-profit, customer, inventory, best-seller, activity, and trend information
11. Refund a completed sale and reverse its stock movement

## Deferred features

- Full subscriptions and payment integration
- Advanced stocktake and inventory reconciliation
- POS import workflows
- AI recommendations
- Appointments, loyalty, and staff scheduling
- Live production deployment and a provider-backed release process

## Key product decisions

- Prefer a modular monolith over service sprawl
- Prioritize security and tenant boundaries before broad feature expansion
- Keep configuration and entitlements flexible rather than business-specific by default
- Validate all customer-facing claims against implemented functionality
