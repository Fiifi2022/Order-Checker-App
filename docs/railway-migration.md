# Move Order Checker from Render to Railway

Prepared 1 November 2026. The migration reuses the existing Firebase project and
Firestore database. No database export, reseeding or allocation reset is needed.

## Deployment

Deploy the current workspace using Railway CLI after account sign-in. This
includes local fixes without committing or pushing them to GitHub. The root
Dockerfile builds the website, server and extension on Node 22 and runs the
production server as a non-root user. The server uses Railway's assigned `PORT`
and listens on `0.0.0.0`.

`.railwayignore` and `.dockerignore` restrict uploads/build inputs to the app.
Local `.env`, home-directory files, credentials, caches and recovery snapshots
are excluded. Provide credentials using Railway service variables instead.

Use one service and one replica initially. Disable Serverless sleeping for
consistent response times. Set the deployment healthcheck path to `/api/health`.
Keep Render online until the checks below pass.

## Service variables

Copy the existing server values through Railway's protected variables UI or
CLI input; never paste keys into chat or commit them:

- `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`.
- `GEMINI_API_KEY` for optional AI and screenshot extraction.
- Existing optional audit timing or extension refresh settings, if configured.
- `APP_URL` to the new HTTPS origin or custom domain. If unset, extension
  downloads detect `RAILWAY_PUBLIC_DOMAIN` automatically. Do not copy Render's
  old `APP_URL` or `RENDER_EXTERNAL_URL` into Railway.

The Dockerfile sets `NODE_ENV=production`. Keep emulator variables unset.
`AUTH_BOOTSTRAP_ADMIN_EMAIL` is not needed once administrator roles are saved.

## Domain and verification

1. Generate the Railway public domain and add its hostname to the existing
   Firebase Authentication authorized domains. Keep the Render hostname during
   the transition.
2. Confirm `/api/health` returns `{"status":"ok"}` and the website loads its
   assets over HTTPS.
3. Sign in with an existing approved account. Verify the catalogue, facilities,
   Blueprint districts and cycles load from the existing database.
4. Run a known audit and an uncertain audit. Verify identity and quantity checks,
   AI availability, and truthful Firestore save status.
5. Download a new extension ZIP from the Railway website, reload it in Chrome,
   and sign in. The ZIP must point to Railway. Confirm facility detection and
   read-only allocation lookup before any real fulfillment operation.
6. Compare first and subsequent audit timings against Render using the same
   inputs. Check Railway resource usage and account spending controls.
7. Move any custom domain only after verification. Retire Render separately once
   the new host and extension are working.

Docker is not installed locally. Railway successfully built the multi-stage
Docker image and passed the deployment health check.

Local preparation checks passed: `npm run lint`, `npm run build`, all three
extension-package tests, and `git diff --check`. An isolated runtime containing
only the intended production files returned healthy JSON from `/api/health`
and served the built frontend on the configured port. This smoke check used
the installed dependencies; it did not build a Docker image, run an audit or
write database records.

## Live deployment — 1 November 2026

- Site: https://ordercheck-production.up.railway.app
- Project: `8830f10c-d3d5-4c13-a881-862c400c8796` (`Order-Checker-App`).
- Service: `8b159f02-a434-4dd0-8642-2ca8d83d24d8` (`ordercheck`).
- Environment: production; one replica in `europe-west4-drams3a`.
- Deployment: `7a33f5be-76fd-4d5c-8a30-7c47387a0ca1`, confirmed `SUCCESS`.
- Dockerfile build, `/api/health`, 120-second health-check window, sleeping
  disabled, restart on failure with three retries.
- Required Firebase credentials and the optional Gemini key were transferred
  through CLI stdin without displaying values. The existing Firebase project,
  database and saved roles were retained. No operational data was migrated,
  reseeded or reset.
- Added the Railway hostname to Firebase Authentication authorized domains and
  confirmed it, preserving every existing hostname.

Public read-only smoke checks passed: HTTPS health JSON (200), production page
(200), JavaScript asset (200), and protected catalogue API rejecting anonymous
access (401). Observed request times from this workstation were 783 ms, 581 ms,
183 ms and 246 ms respectively; these are not authenticated audit timings.

The CLI deployment includes the current local fixes. No Git commit, push or
GitHub autodeploy connection was created. Future local changes require another
Railway deployment to update the live service.

## Remaining verification

Sign in at the new site with an existing approved account, run a representative
audit, confirm saved history and Blueprint data, and download/reload the new
extension package. Authenticated browser audits and installed Chrome extension
behavior have not been verified in this migration. A remote read-only database
probe could not run because this workstation has no SSH key; no key was added
and no user was impersonated to bypass sign-in.

The build reports existing dependency audit findings (28: 13 moderate, 14 high,
1 critical) and the existing large frontend bundle warning. Dependencies were
not changed or force-upgraded as part of the hosting migration.

Render remains online as the rollback host. No custom DNS or Render service
settings were changed. The initial expired-trial blocker was resolved by the
account owner selecting a plan before this deployment.

References: [Railway CLI deployment](https://docs.railway.com/cli/up),
[Dockerfile builds](https://docs.railway.com/builds/dockerfiles).
