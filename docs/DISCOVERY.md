# Discovery report

## Verified facts

- The repository was empty at the start of the project.
- No existing source code, database scripts, tests, CI configuration, or deployment setup were present.
- The local environment includes Node.js v22.1.0 and npm 10.7.0.
- Python 3.11.9 is available for scripting and tooling.
- `psql` and Docker are not installed in the current environment.
- There is no existing Git repository in the workspace.

## Functional status

- No production-ready application exists yet.
- There is no database schema, migration system, or application runtime.
- Authentication, onboarding, permissions, and tenant isolation are not yet implemented.

## Incomplete and missing items

- Database engine installation and provisioning
- SQL migration package structure
- User and business onboarding workflow
- Authenticated session handling
- Multi-tenant authorization and business switching
- Persistent dashboard data
- Frontend/backend integration
- Security hardening and audit logging
- Deployment automation
- Human acceptance testing documents and sign-off workflow

## Recommended architecture

A modular monolith is the best fit for a founder-led SaaS prototype. It provides a clear separation between business logic, API, and presentation while avoiding unnecessary operational complexity.

### Recommended technology stack

- Frontend: Vanilla HTML/CSS/JavaScript served by Express, with responsive layouts for desktop and mobile.
- Backend: Node.js with Express.js and MVC-equivalent module separation.
- Database: SQLite for the prototype because it is lightweight, relational, portable, and easy to version with real SQL files.
- ORM/data layer: Direct SQL access via `better-sqlite3` and migration scripts to keep the data model explicit and reviewable.
- Authentication: secure hashed passwords, signed sessions, and per-request tenant checks.
- Testing: Node.js built-in test runner for API and database integration tests.
- Deployment: local development first, then a managed hosting environment with explicit production configuration.

## Database engine and SQL dialect

- Engine: SQLite 3
- SQL dialect: standard SQL with SQLite-specific pragmas and constraints
- This is a practical choice for a prototype because it is portable and provides genuine relational database behavior without requiring a separate database server in the initial environment.

## Required development tools

- Node.js 22 LTS
- npm
- SQLite-compatible tooling
- Git
- Basic HTTP client for API verification
- Node.js test runner

## External services likely required later

- Payment provider sandbox (e.g., Payfast or Yoco depending on final market validation)
- Email delivery provider for verification and password recovery
- AI provider with data minimization controls
- Optional import provider or CSV processing tool
- Error monitoring and log shipping for production deployment

## Critical risks and unresolved decisions

- External payment provider selection is not yet validated for the South African market.
- Email and AI integration are deferred until core flows are stable.
- SQLite is a practical prototype choice, but production scale and concurrency requirements may later justify PostgreSQL or another server-based SQL engine.
- No human acceptance testing has been performed yet.

## Proposed MVP and deferred features

### MVP candidates

- User registration
- Email or username-based login
- Business creation and ownership
- Tenant-scoped business settings
- Dashboard summary with real persistence
- Product and customer creation for basic operations
- Secure logout and session handling

### Deferred features

- Advanced subscription billing
- Multi-provider POS integration
- AI recommendation engines
- Full appointment and inventory workflows
- Production-grade monitoring and deployment automation

## Assumptions

- A founder-led workflow will benefit from a modular monolith instead of heavy microservices.
- The initial customer focus is small businesses in South Africa.
- A secure, privacy-first prototype can be built with a small but real data model and tested workflows.

## Recommendations

1. Start with a minimal but real multi-tenant SaaS skeleton.
2. Implement the registration → business creation → authentication → dashboard → settings update → logout flow first.
3. Keep schemas versioned and reviewable from the beginning.
4. Treat tenant isolation as a core design requirement, not a later add-on.
5. Validate human acceptance after each increment before broad scope expansion.
