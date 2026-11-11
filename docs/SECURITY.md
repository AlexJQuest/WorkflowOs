# Security

## Implemented controls

- Password hashing using bcrypt
- Session-based auth with bearer token validation
- Tenant-scoped business access checks on API routes
- SQLite foreign keys enabled
- User existence checks before registration
- No database credentials exposed to the browser

## Risks that remain

- No rate limiting or CSRF guard is yet implemented.
- No email verification or password recovery is yet implemented.
- No production TLS, audit log retention, or secret management layer exists yet.
- No RBAC beyond admin membership is implemented yet.

## Next security work

- Add rate limiting and request validation improvements
- Introduce explicit role/permission checks
- Add audit logging for sensitive actions
- Add secure session rotation and expiry review
- Prepare a threat model and privacy review for POPIA alignment
