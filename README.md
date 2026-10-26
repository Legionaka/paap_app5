# Stillwater

Stillwater is a mobile first guide to fishing locations, conditions, species records and community knowledge.

## Run locally

Set `DATABASE_URL` in PowerShell to the pooled Neon connection string, then run:

```powershell
npm run dev
```

Open <http://localhost:5173>. The location API returns data from Neon. Weather, hourly conditions, sunrise, and sunset are fetched from Open-Meteo at runtime for the selected location's approximate coordinates.

To run the DWS import once from the terminal, run `npm run import:dws` after setting `DATABASE_URL` in that same terminal session.

## Neon data and DWS updates

- `db/migrations/0001_location_catalog.sql` defines the Postgres/PostGIS location, source, fact, observation and species tables and seeds Hartbeespoort Dam.
- `db/migrations/0002_dws_ingest_runs.sql` adds an audit log for import attempts and points the DWS source record at its official weekly status page. Apply this migration to Neon before deploying the scheduled function.
- `db/migrations/0003_location_forum.sql` creates community accounts, expiring sessions, location discussions, replies, reports, and persistent API rate limits. Apply it to Neon before enabling the forum.
- `db/migrations/0004_location_directory.sql` adds initial sourced location records for Boskop, Vaalkop, and Roodekopjes dams. The published directory only includes entries with coordinates; access and fishing rules remain explicitly unverified unless sourced facts are added.
- `db/migrations/0005_stage3_location_details.sql` expands the directory with five Western Cape dams, sourced species records, permit/access notes, and coordinate source dates. Apply after `0004_location_directory.sql` in Neon. The current directory is a sourced starter catalogue for North West and Western Cape, not an exhaustive national gazetteer. Access, facilities, and rules remain “not recorded” when a current authoritative source does not establish them; historical plans are not treated as current conditions.
- `server/location-api.js` reads published location records. Vercel serves it through `api/locations/[id].js`; the local development server exposes the same endpoint.
- `GET /api/locations` returns the published directory for search and location selection. Each profile and location discussion is loaded by its database location ID.
- `public/` contains browser-facing files only. Server modules, SQL migrations and credentials are outside the static output.
- `server/dws-importer.js` follows the official DWS weekly status page to its dated reservoir PDF, validates Hartbeespoort's capacity and storage row, and stores dated observations in Neon. Older reports and malformed values are rejected. This is weekly reporting, not a live sensor feed.
- `server/community-api.js` provides account registration and sign-in, location discussion posts and replies, content reports, and moderator actions. Explicit Vercel route files under `api/community/` map each nested endpoint to the shared handler. Session cookies are HttpOnly, SameSite=Lax and Secure in production; passwords use Node's scrypt; user-generated text is rendered as text; write endpoints enforce same-origin JSON requests and database-backed rate limits.
- `vercel.json` schedules the import once daily at 06:00 UTC. Vercel cron jobs run on production deployments; Hobby plan jobs can run at any point during their scheduled hour. Vercel does not retry failed cron invocations, so check the function logs and the `data_ingest_runs` table.

## Vercel environment variables

Add these in the Vercel project settings for Production:

- `DATABASE_URL`: pooled Neon connection string used by the read-only location API.
- `CRON_SECRET`: random secret with at least 16 characters. Vercel sends this to the scheduled endpoint as a bearer token.
- `INGEST_DATABASE_URL`: optional separate Neon role for the importer. If unset, the importer falls back to `DATABASE_URL`; use a restricted writer role for production.

The Neon credentials must remain server-side. Do not add them to frontend code or commit them to the repository. Vercel Cron invokes the import only after a production deployment. DWS report reuse terms should be confirmed before commercial redistribution.

To grant moderator access after registration, use a trusted Neon SQL session and promote a specific account by its exact email:

```sql
UPDATE public.community_users
SET role = 'moderator', updated_at = now()
WHERE email = 'moderator@example.com';
```

The forum supports password accounts without an email delivery integration, so this release does not verify email ownership or provide password reset emails. Configure an email provider and verification/reset flows before relying on email identity for sensitive community actions.

In Vercel, use the **Other** framework preset, leave the build command blank, and set the output directory to `public` (also recorded in `vercel.json`).

## Data quality notes

- DWS publishes state of dams weekly. A daily check looks for a newer report; it does not make the underlying reading real time.
- Weather is a model-based forecast, not a local sensor observation. Open-Meteo's free API is for non-commercial use; commercial use needs a paid plan.
- Species entries are source records, not current catch surveys. Weather is a model-based forecast; sunrise/sunset times are provider calculations at approximate location coordinates. The dawn/dusk ranking compares forecast wind, rain probability and storm codes only; it is not a prediction of fish activity. DWS storage is a weekly report and is not live. No sourced water temperature or clarity readings are currently available. Access, facilities and rules show a source or remain unverified.
