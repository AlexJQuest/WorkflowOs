# Architecture decisions

## Decision 1: Modular monolith

A modular monolith is preferred because it keeps the codebase maintainable for a single founder while remaining extensible.

## Decision 2: SQLite for prototype

SQLite is chosen for the first iteration because it is relational, fast to run locally, and compatible with real SQL file-based migrations.

## Decision 3: Tenant-aware server-side checks

The backend validates business membership before allowing settings or dashboard access. Browser-provided IDs are not trusted.

## Decision 4: Security-first MVP

The prototype prioritises real authentication and data isolation before broad feature expansion.
