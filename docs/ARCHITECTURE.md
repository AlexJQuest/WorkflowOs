# Architecture

## Recommended baseline

The project uses a modular monolith with a clear MVC-inspired separation:

- Models/data layer: SQLite schema, migration files, and data access logic in `src/api`
- Controllers/application layer: Express route handlers and authorisation logic in `server.js`
- Views/presentation layer: static frontend served from `public/`

## Runtime

- Node.js 22 LTS
- Express.js for HTTP API and static assets
- SQLite for relational data storage in the prototype
- better-sqlite3 for direct, explicit SQL access

## Why this stack

This is the smallest maintainable architecture for a founder-led SaaS prototype. It keeps the codebase reviewable, secure, and testable while still supporting real multi-tenant data rules.

## Current implementation scope

The prototype currently includes:

- user registration with password hashing
- business creation and member assignment
- session creation and validation
- tenant-aware settings update
- dashboard access shell
- browser-based login and logout flow

## Gaps and next decisions

The next architecture step is to add:

- real role/permission checks beyond admin membership
- more business modules and module-specific schemas
- payment and subscription entitlement enforcement
- database migration validation automation
- CI and human acceptance workflow
