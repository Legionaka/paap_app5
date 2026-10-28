import { neon } from '@neondatabase/serverless';

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.setHeader('Allow', 'GET, HEAD');
    return response.status(405).json({ status: 'method_not_allowed' });
  }
  try {
    if (!process.env.DATABASE_URL) throw new Error('Database is not configured');
    const sql = neon(process.env.DATABASE_URL);
    const [checks] = await sql`
      SELECT
        (SELECT status
         FROM public.data_ingest_runs
         WHERE source_id = 'dws-weekly-dam-levels'
         ORDER BY started_at DESC
         LIMIT 1) AS "latestDwsRunStatus",
        (SELECT to_char(report_date, 'YYYY-MM-DD')
         FROM public.data_ingest_runs
         WHERE source_id = 'dws-weekly-dam-levels'
           AND report_date IS NOT NULL
           AND status IN ('succeeded', 'no_change', 'skipped_stale')
         ORDER BY report_date DESC, started_at DESC
         LIMIT 1) AS "latestDwsReportDate",
        (SELECT count(*)::int
         FROM public.locations
         WHERE is_published = true AND point IS NOT NULL) AS "publishedLocationCount"
    `;
    const latestDwsReportDate = checks.latestDwsReportDate;
    const ageDays = latestDwsReportDate
      ? Math.max(
          0,
          Math.floor((Date.now() - Date.parse(`${latestDwsReportDate}T00:00:00Z`)) / 86_400_000),
        )
      : null;
    const dwsStatus =
      checks.latestDwsRunStatus === 'failed'
        ? 'latest_run_failed'
        : !latestDwsReportDate
          ? 'no_report'
          : ageDays > 10
            ? 'stale'
            : 'ok';

    return response.status(200).json({
      status: 'ok',
      database: 'ok',
      locations: { published: checks.publishedLocationCount },
      dataFeeds: {
        dws: {
          status: dwsStatus,
          latestRunStatus: checks.latestDwsRunStatus ?? 'no_runs',
          latestReportDate: latestDwsReportDate,
          reportAgeDays: ageDays,
        },
      },
      deployment: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 8) ?? 'local',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Health check failed:', error.message);
    return response.status(503).json({ status: 'unavailable', database: 'unavailable' });
  }
}
