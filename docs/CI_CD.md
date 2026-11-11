# CI/CD pipeline

## CI workflow

The GitHub Actions workflow at `.github/workflows/ci-cd.yml` runs for pull requests and pushes to `main`, `DEV`, `TEST`, and `LIVE`. It:

1. Checks out the repository.
2. Sets up Node.js 22 and uses the npm lockfile cache.
3. Runs `npm ci` to install the locked dependency tree.
4. Runs JavaScript syntax checks with `npm run check`.
5. Applies the SQL migrations to a fresh temporary SQLite database.
6. Runs the API integration tests with `npm test`.
7. Runs `npm audit --omit=dev --audit-level=high`.

A failed verification job prevents the deployment job from running.

## CD behavior

A push to `LIVE` can trigger the `production` deployment job only after CI passes. The job sends an HTTPS POST to a deployment hook configured as the `DEPLOY_HOOK_URL` secret in the GitHub `production` environment.

If the secret is not configured, the deploy script reports that deployment was skipped. No production service is currently selected or configured, so no live deployment has been performed.

A separate Pages job deploys only the static `pages/` status/information page after CI passes on `LIVE`. It does not publish the functional app, because GitHub Pages cannot host Express APIs or SQLite. See [BRANCH_AND_PAGES_DEPLOYMENT.md](BRANCH_AND_PAGES_DEPLOYMENT.md).

## GitHub setup required

1. Push this repository and its `DEV`, `TEST`, and `LIVE` promotion branches to GitHub.
2. In **Settings → Pages**, choose **GitHub Actions** as the publishing source.
3. Open **Settings → Environments** and create an environment named `production`.
4. Configure required reviewers on that environment before enabling live deployments.
5. Add the API hosting provider's HTTPS deploy hook as the `DEPLOY_HOOK_URL` environment secret.
6. Ensure the provider has required runtime/database/environment variables and an explicit migration process.
7. Confirm provider health checks and rollback before enabling any API deployment hook.

The local `origin` remote now points to `https://github.com/AlexJQuest/WorkflowOs.git`, but the initial push was rejected because this environment has no valid GitHub credentials. Authenticate Git with Git Credential Manager or VS Code's GitHub sign-in, then push `main`, `DEV`, `TEST`, and `LIVE`. GitHub Actions will run after the refs arrive. Also, the Pages site is not the operational SaaS; the API/database host remains to be selected and configured.

## Safety

- Pull requests run verification only; they never deploy.
- Deployment is only considered for pushes to `LIVE` and waits for CI.
- Production approval is managed by GitHub Environment protection rules.
- The deployment hook is required to use HTTPS and is never printed by the script.
- The application does not run destructive migrations or change production databases as part of this deployment hook.
