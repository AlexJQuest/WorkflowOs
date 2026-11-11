# Backup and recovery

## Current prototype position

This prototype uses a local SQLite file and does not yet include automated backup orchestration.

## Minimum protection before production

- nightly database backup
- restore validation in a non-production environment
- versioned SQL migration history
- retention policy documentation
- encrypted backups at rest

## Recovery procedure

1. Restore the latest valid SQLite file or database dump.
2. Confirm migration history is intact.
3. Run the app against the restored database in a controlled environment.
4. Validate critical flows before promoting recovery to production.
