# Stillwater

Stillwater is a mobile first fishing-water guide for South Africa. The public landing page is `/`; the location guide is `/explore/`. Visitors can browse without an account. Community accounts support location discussions and replies, moderation, email verification, password recovery, and saved waters synced across devices.

## Run locally

Set `DATABASE_URL` in PowerShell to the pooled Neon connection string, then run:

```powershell
npm run dev
```

Open <http://localhost:5173>. The `predev` step generates a shareable static page for each published location, plus `sitemap.xml` and `robots.txt`, using the published Neon directory. Weather, hourly conditions, sunrise, and sunset are fetched from Open-Meteo at runtime for the selected location's approximate coordinates.

To run the DWS import once from the terminal, run `npm run import:dws` after setting `DATABASE_URL` in that same terminal session.

## Neon data and DWS updates

- `db/migrations/0001_location_catalog.sql` defines the Postgres/PostGIS location, source, fact, observation and species tables and seeds Hartbeespoort Dam.
- `db/migrations/0002_dws_ingest_runs.sql` adds an audit log for import attempts and points the DWS source record at its official weekly status page. Apply this migration to Neon before deploying the scheduled function.
- `db/migrations/0003_location_forum.sql` creates community accounts, expiring sessions, location discussions, replies, reports, and persistent API rate limits. Apply it to Neon before enabling the forum.
- `db/migrations/0004_location_directory.sql` adds initial sourced location records for Boskop, Vaalkop, and Roodekopjes dams. The published directory only includes entries with coordinates; access and fishing rules remain explicitly unverified unless sourced facts are added.
- `db/migrations/0005_stage3_location_details.sql` expands the directory with five Western Cape dams, sourced species records, permit/access notes, and coordinate source dates. Apply after `0004_location_directory.sql` in Neon. The current directory is a sourced starter catalogue for North West and Western Cape, not an exhaustive national gazetteer. Access, facilities, and rules remain “not recorded” when a current authoritative source does not establish them; historical plans are not treated as current conditions.
- `db/migrations/0006_stage4_dws_coverage.sql` maps official DWS reservoir-report labels to the published location IDs. Apply after `0005_stage3_location_details.sql`. The importer records only rows it recognizes in each dated report; a configured alias does not mean that the dam appears in every report.
- `db/migrations/0007_stage5_accounts.sql` adds email verification and password recovery tokens plus account-synced saved waters. Apply it after `0006_stage4_dws_coverage.sql` before deploying Stage 5.
- `server/location-api.js` reads published location records. Vercel serves it through `api/locations/[id].js`; the local development server exposes the same endpoint.
- `GET /api/locations` returns the published directory for search and location selection. Each profile and location discussion is loaded by its database location ID.
- `public/` contains browser-facing files only. Server modules, SQL migrations and credentials are outside the static output.
- `server/dws-importer.js` follows the official DWS weekly status page to its dated reservoir PDF, matches configured location aliases, validates each capacity/storage row, and stores dated capacity facts and storage observations in Neon. Older reports and malformed values are rejected. A capacity change above 5% is held for review. This is weekly reporting, not a live sensor feed.
- The DWS weekly report does not list every dam in South Africa. Import-run metadata records which configured locations matched each report, so missing rows stay missing instead of being inferred from provincial totals.
- `server/community-api.js` provides account registration and sign-in, location discussion posts and replies, content reports, and moderator actions. One Vercel function (`api/community.js`) handles the community endpoints, with a rewrite preserving the `/api/community/*` URLs. Session cookies are HttpOnly, SameSite=Lax and Secure in production; passwords use Node's scrypt; user-generated text is rendered as text; write endpoints enforce same-origin JSON requests and database-backed rate limits.
- Registration, verification, password recovery, and verification resend use Resend. Email actions require a verified sending domain and the `RESEND_API_KEY` and `EMAIL_FROM` environment variables. `APP_BASE_URL` should be set to the canonical production origin (for example `https://your-domain.example`) so emails always link to the production site.
- Account pages are `/sign-in/`, `/register/`, `/account/`, `/forgot-password/`, `/reset-password/`, and `/verify-email/`. The API endpoint `/api/health` reports Neon status, published-location count, deployment commit, and DWS report freshness without exposing importer error details. Monitor its HTTP status and `dataFeeds.dws.status`; reports older than ten days are marked stale.
- `vercel.json` schedules the import once daily at 06:00 UTC. Vercel cron jobs run on production deployments; Hobby plan jobs can run at any point during their scheduled hour. Vercel does not retry failed cron invocations, so check the function logs and the `data_ingest_runs` table.

## Vercel environment variables

Add these in the Vercel project settings for Production:

- `DATABASE_URL`: pooled Neon connection string used by the read-only location API.
- `CRON_SECRET`: random secret with at least 16 characters. Vercel sends this to the scheduled endpoint as a bearer token.
- `INGEST_DATABASE_URL`: optional separate Neon role for the importer. If unset, the importer falls back to `DATABASE_URL`; use a restricted writer role for production.
- `RESEND_API_KEY`: server-only Resend API key used for verification and password recovery email.
- `EMAIL_FROM`: sender address on a domain verified with Resend, for example `Stillwater <accounts@your-domain.example>`.
- `APP_BASE_URL`: canonical production origin used to generate email links.

The Neon credentials must remain server-side. Do not add them to frontend code or commit them to the repository. Vercel Cron invokes the import only after a production deployment. DWS report reuse terms should be confirmed before commercial redistribution.

To grant moderator access after registration, use a trusted Neon SQL session and promote a specific account by its exact email:

```sql
UPDATE public.community_users
SET role = 'moderator', updated_at = now()
WHERE email = 'moderator@example.com';
```

After applying migration `0007`, configure the email variables in Vercel and redeploy. Existing accounts remain unverified until their owners use the verification flow; community posting and account-synced saved waters require a verified address. Registration and verification resend require working email delivery. Password recovery always shows the same response to protect account privacy; check Vercel function logs if a reset email is not delivered.

In Vercel, use the **Other** framework preset, set the build command to `npm run build`, and set the output directory to `public` (also recorded in `vercel.json`). The build runs formatting checks and unit/project checks, then generates a static, shareable `/explore/locations/<id>/` page for every published location and a sitemap. Set `DATABASE_URL` and the canonical `APP_BASE_URL` for each environment that should build these pages. Vercel must have access to Neon during the build.

## Design and quality checks

- `npm run format` formats the maintained HTML, CSS, JavaScript, JSON and Markdown files. Vendored Leaflet files and generated pages are excluded.
- `npm run check` checks formatting and runs the Node test suite.
- `npm run build` runs those checks before generating location pages and search metadata.
- GitHub Actions runs `npm run check` on pushes and pull requests targeting `main`; Vercel performs the deployment build separately because page generation requires Neon access.
- Shared design tokens and typography are in `public/css/tokens.css`; page-specific layouts stay in `site.css` and `styles.css`.
- The installable guide caches public pages and public location API responses after they have been fetched online. Previously opened public guides can then be read offline. Community and account responses, weather forecasts, and external map tiles are not cached; they require a connection.
- Leaflet is vendored under `public/vendor/leaflet/` with its BSD license. Map tiles are requested only as a user views the map, and visible [OpenStreetMap attribution](https://www.openstreetmap.org/copyright) is included. Follow the [OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/); the public tile service has no availability guarantee, so move to a commercial or self-hosted tile provider if traffic grows.

Location profile pages are generated from the published database at build time. Adding or changing a published location requires a new deployment to update the static page metadata and sitemap. The live directory and profile data still come from the location API.

## Data quality notes

- DWS publishes state of dams weekly. The scheduled daily check looks for a newer report; it does not make the underlying reading real time. Only matched dams listed in that report will have a storage record.
- Weather is a model-based forecast, not a local sensor observation. Open-Meteo's free API is for non-commercial use; commercial use needs a paid plan.
- Species entries are source records, not current catch surveys. Weather is a model-based forecast; sunrise/sunset times are provider calculations at approximate location coordinates. The dawn/dusk ranking compares forecast wind, rain probability and storm codes only; it is not a prediction of fish activity. DWS storage is a weekly report and is not live. No sourced water temperature or clarity readings are currently available. DWS water-quality products are monitoring snapshots and may lag; use a sample's own date rather than calling it current. Access, facilities and rules show a source or remain unverified.
- DWS NIWIS water-quality data has separate access and reuse conditions; review them before using its extracts in a commercial product. No water-quality values are imported until a suitable, permitted location-level feed is established.
