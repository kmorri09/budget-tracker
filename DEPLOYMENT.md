# Railway first-release deployment

The app is configured as a single Railway web service backed by Railway PostgreSQL. The database is the source of truth; the app can still run in local demo mode when `DATABASE_URL` is absent.

## Web service

1. Create a Railway project and add a PostgreSQL service.
2. Deploy this repository as a web service.
3. Set `DATABASE_URL` from the PostgreSQL service reference.
4. Set `NODE_ENV=production`.
5. Migrations run automatically as a Railway pre-deploy command (`npm run db:migrate`) before each deployment. The application start command also runs the same idempotent migration when `DATABASE_URL` is present, so the schema is initialized even if the Railway pre-deploy setting is not applied.

   If the Deployment details page does not show a pre-deploy step, set it manually in the web service at **Settings → Deploy → Pre-deploy Command** to `npm run db:migrate`. Some newer Railway services do not apply legacy `railway.json` config-as-code settings automatically.

6. Provision only the owner account (this does not create financial data), replacing the values:

   `npm run db:seed -- owner@example.com "a-long-unique-password"`

The seed command requires an explicit password of at least 12 characters; there is no default credential. Do not run it with a password you intend to reuse elsewhere.

Demo financial data is opt-in only: set `SEED_DEMO=1` when running the seed command. Leave it unset for a clean production database.

The service health endpoint is `/api/health`. The Railway public domain can then be opened on a phone and installed as a PWA.

## Public URL port

Generate the domain for the **web service**, not the PostgreSQL service. Use the target port shown by Railway—normally `8080` (the value in the screenshot). Railway injects `PORT` into the service, and `next start` listens on that value. If the service Variables tab shows a different `PORT`, use that exact number instead.

The repository pins the build to Node.js 20+ because Next.js 16 does not support Node.js 18. `package.json` declares the engine requirement and `nixpacks.toml` explicitly selects `nodejs_20`.

## First-release environment checklist

- `DATABASE_URL` — Railway Postgres connection string
- `NODE_ENV=production`
- `TZ=America/Chicago` (or the owner's chosen timezone)
- `INITIAL_USER_EMAIL` — comma-separated allow-list for the one-time first-user setup (for example, `owner@example.com`)
- `PLAID_CLIENT_ID` and `PLAID_SECRET` — only when live account sync is enabled
- `SESSION_SECRET` — reserved for a future signed-session upgrade; database sessions are currently random, httpOnly cookies

After the first successful deployment, open the app and choose **Create the initial user**. This option is only offered while the users table is empty, and the submitted email must match `INITIAL_USER_EMAIL`. Once the account is created, the option disappears permanently unless the database is intentionally reset.

Railway's scheduled jobs can be added later as a second service using `npm run jobs:check` once alert dispatch and provider sync are enabled. No financial action is scheduled automatically by the current release.
