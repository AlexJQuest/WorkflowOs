# Deployment

## Current state

This repository is not yet configured for production deployment and should not be treated as production-ready.

CI/CD verification is configured in GitHub Actions. The deployment stage is an opt-in HTTPS deploy-hook request and requires a GitHub `production` environment secret named `DEPLOY_HOOK_URL`. See [CI_CD.md](CI_CD.md). No hosting provider is configured in this repository yet.

## Required before production

- explicit environment configuration
- secure secret management
- HTTPS termination
- database backup strategy
- monitoring and health checks
- change review and human acceptance
- protected GitHub production environment with required reviewers

## Recommended next deployment model

Use a managed Node.js host with a managed relational database and explicit environment variables. Keep the application and database separate and enforce a staged promotion model.
