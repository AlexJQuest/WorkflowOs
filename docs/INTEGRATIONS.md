# Integrations

## Current status

No external provider integrations are live yet. The architecture is intentionally designed to keep integration adapters isolated from core business logic.

## Planned additions

- Payment provider adapter
- Email provider integration
- AI recommendation provider adapter
- CSV import workflow for POS and product migration

## Requirements before production

- Provider-specific sandbox testing
- Secret management
- Webhook verification
- Idempotency protection
- Duplicate event reconciliation
- User consent review where personal data is processed
