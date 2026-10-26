# Stillwater

Stillwater is a mobile first guide to fishing locations, conditions, species records and community knowledge.

## Run locally

Set `DATABASE_URL` in PowerShell to the pooled Neon connection string, then run:

```powershell
npm run dev
```

Open <http://localhost:5173>. The location API returns data from Neon. Weather is fetched from Open-Meteo at runtime for approximate Hartbeespoort coordinates.

To run the DWS import once from the terminal, run `npm run import:dws` after setting `DATABASE_URL` in that same terminal session.

## Neon data and DWS updates

- `db/migrations/0001_location_catalog.sql` defines the Postgres/PostGIS location, source, fact, observation and species tables and seeds Hartbeespoort Dam.
- `db/migrations/0002_dws_ingest_runs.sql` adds an audit log for import attempts and points the DWS source record at its official weekly status page. Apply this migration to Neon before deploying the scheduled function.
- `server/location-api.js` reads published location records. Vercel serves it through `api/locations/[id].js`; the local development server exposes the same endpoint.
- `public/` contains browser-facing files only. Server modules, SQL migrations and credentials are outside the static output.
- `server/dws-importer.js` follows the official DWS weekly status page to its dated reservoir PDF, validates Hartbeespoort's capacity and storage row, and stores dated observations in Neon. Older reports and malformed values are rejected. This is weekly reporting, not a live sensor feed.
- `vercel.json` schedules the import once daily at 06:00 UTC. Vercel cron jobs run on production deployments; Hobby plan jobs can run at any point during their scheduled hour. Vercel does not retry failed cron invocations, so check the function logs and the `data_ingest_runs` table.

## Vercel environment variables

Add these in the Vercel project settings for Production:

- `DATABASE_URL`: pooled Neon connection string used by the read-only location API.
- `CRON_SECRET`: random secret with at least 16 characters. Vercel sends this to the scheduled endpoint as a bearer token.
- `INGEST_DATABASE_URL`: optional separate Neon role for the importer. If unset, the importer falls back to `DATABASE_URL`; use a restricted writer role for production.

The Neon credentials must remain server-side. Do not add them to frontend code or commit them to the repository. Vercel Cron invokes the import only after a production deployment. DWS report reuse terms should be confirmed before commercial redistribution.

In Vercel, use the **Other** framework preset, leave the build command blank, and set the output directory to `public` (also recorded in `vercel.json`).

## Data quality notes

- DWS publishes state of dams weekly. A daily check looks for a newer report; it does not make the underlying reading real time.
- Weather is a model-based forecast, not a local sensor observation. Open-Meteo's free API is for non-commercial use; commercial use needs a paid plan.
- Fish species shown are those named in a DWS ecological water-quality report. That is not a current catch survey. Access rules, facilities, current water temperature, clarity and bite windows are not yet verified and are deliberately not shown as facts.
