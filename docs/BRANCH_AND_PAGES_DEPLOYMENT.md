# Branch and GitHub Pages deployment

## Branches

The repository uses these promotion branches:

- `DEV` — active development and feature integration
- `TEST` — reviewed candidate for acceptance testing
- `LIVE` — approved release candidate

Promote changes with reviewed pull requests: `DEV` → `TEST` → `LIVE`. GitHub Actions runs the CI validation workflow on pushes and pull requests for these branches. Keep branch protection and required reviewers enabled in repository settings, especially for `LIVE`.

## GitHub Pages

A workflow deploys `pages/` to GitHub Pages only after CI passes on pushes to `LIVE`. The Pages artifact is a static project/status page.

**This is not the working WorkflowOS SaaS application.** GitHub Pages cannot host the Express server, SQLite database, authenticated API routes, local file database, or Node background processing. The actual frontend calls same-origin `/api/...` endpoints, so copying `public/` to Pages would make login, catalogue, sales, barcode lookup, and dashboard data fail. The Pages site explicitly says this and does not present mock business metrics.

To make the actual product live, select and configure a suitable Node.js/API host and persistent SQL database first. Configure CORS/secure auth, a production database migration/backup policy, and a public API base URL in a reviewed frontend change. Then use an API-capable host for the app; Pages can optionally host the static frontend only after it is configured to call that API.

## Repository setup still required

1. Push `main`, `DEV`, `TEST`, and `LIVE` to the GitHub repository.
2. In GitHub **Settings → Pages**, set the source to **GitHub Actions**.
3. In **Settings → Environments**, configure `production` approval reviewers and the selected API host's HTTPS `DEPLOY_HOOK_URL` if enabling API deployment.
4. Protect `DEV`, `TEST`, and `LIVE`; require checks and reviews before merging.
5. Do not treat the Pages static notice as client onboarding or production acceptance.

No production API host or deploy hook is configured by this repository yet.
