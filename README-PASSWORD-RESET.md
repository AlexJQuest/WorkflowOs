# WorkflowOS password reset patch

This patch adds password recovery to the existing WorkflowOS Express + MariaDB app. It does not replace the login or registration endpoints and does not touch business/product data.

## Files in this patch

Copy the contents of this ZIP into the root of your existing `WorkflowOS` folder, allowing these files to merge/overwrite:
- `server.js`
- `public/app.js`
- `public/styles.css`
- `src/api/password-reset.service.js`
- `database/migrations-mariadb/002_password_reset_tokens.sql`

The updated `server.js`, `public/app.js`, and `public/styles.css` are based on the project archive supplied for this change.

## 1. Apply the database migration

Open PowerShell in your `WorkflowOS` project folder and run:

```powershell
node .\scripts\run-mariadb-migrations.js
```

Review that `002_password_reset_tokens.sql` is listed as pending. Then apply:

```powershell
node .\scripts\run-mariadb-migrations.js --apply
```

The migration creates only `password_reset_tokens`. It does not modify users, products, catalogue records, or business stock.

## 2. Configure email delivery

The app uses Resend's email API. Add these settings to your local `.env` (do not replace the rest of your `.env`):

```dotenv
APP_BASE_URL=http://localhost:3000
RESEND_API_KEY=
EMAIL_FROM="WorkflowOS <onboarding@resend.dev>"
```

For local development, you can leave `RESEND_API_KEY` blank. Requesting a reset for an existing account will print a development reset URL in the server terminal and show a clickable development link in the app. This is for local testing only.

For real email delivery, set:
- `RESEND_API_KEY` to your Resend API key.
- `EMAIL_FROM` to a sender address/domain verified in Resend.
- `APP_BASE_URL` to the public HTTPS URL of your deployed WorkflowOS app, with no trailing slash.

Do not deploy with an empty email API key. Production mode intentionally refuses reset requests if email delivery is not configured.

## 3. Start and test

Restart the app:

```powershell
npm run dev
```

Then:
1. Open `/login`.
2. Click **Forgot password?**.
3. Enter the email address of an existing test account.
4. In local development without Resend, use the development reset link shown on the page (also printed in the server terminal).
5. Set a new password of at least 10 characters.
6. Sign in using the new password.

## Security behaviour

- Reset tokens are generated from cryptographically secure random bytes.
- Only the SHA-256 digest is stored in MariaDB.
- Tokens expire after 30 minutes and can be used once.
- A new request invalidates the user's previous reset token.
- Successful reset invalidates all existing sessions for that user.
- Unknown email addresses receive the same generic response as known addresses.
- Reset requests are rate-limited to five per IP per 15-minute window.
- Passwords are hashed with the same `bcryptjs` cost factor used by the existing registration flow.

## Notes

- This patch expects the existing MariaDB `users` table and the existing `TEST_DB_*` database configuration.
- Node.js 18+ is recommended because the Resend integration uses the built-in `fetch`.
- The ZIP intentionally excludes `.env`, `.git`, database dumps, and `node_modules`.
