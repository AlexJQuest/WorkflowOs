# Threat model

## Threats considered

- Cross-tenant data access through modified business IDs
- Credential stuffing or password guessing
- Weak session handling
- Data leakage through logs or browser state
- Insufficient validation of business membership

## Mitigations in this prototype

- Server-side authorisation checks
- SQL access guarded by user membership validation
- Password hashing before persistence
- Session expiry checks on every protected request

## Outstanding items

- Automated security scanning and dependency review
- Authentication and password-reset flow
- CSRF protections if cookies are introduced
- Data export protections and audit events
- Secure secret storage for future provider keys
