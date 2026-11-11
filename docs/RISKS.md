# Risks

## Current risks

- No external provider validation yet
- No payment or subscription enforcement yet
- No production security review or penetration assessment
- SQLite may need replacement when scale or concurrency increases
- Human acceptance testing is not yet complete

## Mitigation strategy

- Keep the architecture modular and explicit
- Use versioned SQL schema changes
- Add tenant security tests before broad feature growth
- Validate business assumptions against real user testing
