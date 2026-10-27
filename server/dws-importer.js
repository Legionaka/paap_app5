import { load } from 'cheerio';
import { neon } from '@neondatabase/serverless';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const SOURCE_ID = 'dws-weekly-dam-levels';
const METRIC = 'storage_percent_full_supply';
const STATUS_URL = 'https://www.dws.gov.za/drought/weeklystatus.aspx';
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const MAX_REPORT_BYTES = 8 * 1024 * 1024;
const STATUS_TIMEOUT_MS = 10000;
const PDF_TIMEOUT_MS = 18000;
const PDF_ATTEMPTS = 2;

function normalize(value) {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function southAfricaDate(value) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Johannesburg',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const dateParts = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
}

async function readLimitedBytes(response, maxBytes) {
  if (!response.body) throw new Error('DWS response had no body');
  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw new Error('DWS report exceeded the size limit');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, totalBytes);
}

async function downloadDwsPdf(reportUrl) {
  let lastError;
  for (let attempt = 1; attempt <= PDF_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(reportUrl, {
        headers: { Accept: 'application/pdf', 'User-Agent': 'Stillwater-DWS-Report-Importer/1.0' },
        signal: AbortSignal.timeout(PDF_TIMEOUT_MS),
      });
      if (!response.ok) {
        const error = new Error(`DWS reservoir PDF returned HTTP ${response.status}`);
        if (response.status < 500) throw error;
        lastError = error;
        continue;
      }
      if (!(response.headers.get('content-type') ?? '').toLowerCase().includes('application/pdf')) {
        throw new Error('DWS linked report was not a PDF');
      }
      const contentLength = Number(response.headers.get('content-length'));
      if (contentLength > MAX_REPORT_BYTES)
        throw new Error('DWS reservoir PDF exceeded the size limit');
      return await readLimitedBytes(response, MAX_REPORT_BYTES);
    } catch (error) {
      lastError = error;
      if (
        attempt === PDF_ATTEMPTS ||
        error.message.includes('size limit') ||
        error.message.includes('not a PDF')
      ) {
        break;
      }
    }
  }
  throw new Error(
    `DWS PDF download failed after ${PDF_ATTEMPTS} attempts: ${lastError?.message ?? 'unknown network error'}`,
  );
}

function parseReportLink(html) {
  const $ = load(html);
  for (const anchor of $('a[href]').toArray()) {
    const href = $(anchor).attr('href');
    const match = href?.match(/(?:^|\/)docs\/(Weekly(\d{8})\.pdf)$/i);
    if (!match) continue;
    const reportDate = `${match[2].slice(0, 4)}-${match[2].slice(4, 6)}-${match[2].slice(6, 8)}`;
    return { reportUrl: new URL(href, STATUS_URL).href, reportDate };
  }
  const updated = normalize($('body').text()).match(/last updated\s+(\d{4}-\d{2}-\d{2})/i);
  throw new Error(
    `DWS weekly status page did not link to a dated reservoir PDF${updated ? ` (page date: ${updated[1]})` : ''}`,
  );
}

async function parseDwsPdf(pdfBytes, reportDate, locationAliases) {
  const loadingTask = getDocument({
    data: new Uint8Array(pdfBytes),
    useSystemFonts: true,
    isEvalSupported: false,
  });
  let pdf;
  const reportRows = new Map();
  try {
    pdf = await loadingTask.promise;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const rows = new Map();
      for (const item of content.items) {
        if (!('str' in item) || !item.str.trim()) continue;
        const y = Math.round(item.transform[5] * 2) / 2;
        if (!rows.has(y)) rows.set(y, []);
        rows.get(y).push({ x: item.transform[4], text: item.str.trim() });
      }
      for (const cells of rows.values()) {
        const line = cells
          .sort((a, b) => a.x - b.x)
          .map((cell) => cell.text)
          .join(' ');
        const normalizedLine = normalize(line);
        const matchingAliases = locationAliases
          .filter((alias) => normalizedLine.includes(normalize(alias.sourceAlias)))
          .sort((left, right) => right.sourceAlias.length - left.sourceAlias.length);
        if (matchingAliases.length === 0) continue;

        // Name abbreviations and wrapped words occur in the official PDF.
        // Keep only rows with the report's five numeric storage columns.
        const values = [...line.matchAll(/#?\s*(\d[\d,]*(?:\.\d+)?)/g)]
          .map((match) => ({
            value: Number(match[1].replaceAll(',', '')),
            latestAvailable: match[0].trim().startsWith('#'),
          }))
          .slice(-5);
        if (values.length !== 5 || values.some((item) => !Number.isFinite(item.value))) continue;
        const [capacity, volume, previousYear, previousWeek, current] = values;
        if (
          capacity.value < 0.01 ||
          capacity.value > 1000000 ||
          volume.value < 0 ||
          volume.value > 10000000 ||
          current.value < 0 ||
          current.value > 200 ||
          previousWeek.value < 0 ||
          previousWeek.value > 200 ||
          previousYear.value < 0 ||
          previousYear.value > 200
        )
          continue;

        const alias = matchingAliases[0];
        const record = {
          locationId: alias.locationId,
          sourceAlias: alias.sourceAlias,
          capacityMillionM3: capacity.value,
          storageMillionM3: volume.value,
          storagePercent: current.value,
          latestAvailable: current.latestAvailable,
          previousWeekPercent: previousWeek.value,
          previousYearPercent: previousYear.value,
          reportDate,
        };
        const existing = reportRows.get(record.locationId);
        if (
          existing &&
          (existing.storagePercent !== record.storagePercent ||
            existing.capacityMillionM3 !== record.capacityMillionM3)
        ) {
          throw new Error(
            `DWS report contained multiple conflicting rows for ${record.locationId}`,
          );
        }
        reportRows.set(record.locationId, record);
      }
      page.cleanup();
    }
  } finally {
    await loadingTask.destroy();
  }
  if (reportRows.size === 0)
    throw new Error('DWS reservoir PDF did not contain any recognized, valid location rows');

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const latestAllowedDate = southAfricaDate(tomorrow);
  if (reportDate > latestAllowedDate) throw new Error('DWS report date is in the future');

  return [...reportRows.values()];
}

export async function importLatestDwsDamLevel() {
  const connectionString = process.env.INGEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!connectionString) throw new Error('INGEST_DATABASE_URL or DATABASE_URL is not configured');
  const sql = neon(connectionString);
  const started = await sql`
    INSERT INTO public.data_ingest_runs (source_id, status)
    VALUES (${SOURCE_ID}, 'running')
    RETURNING id
  `;
  const runId = started[0].id;
  let stage = 'DWS status page request';

  try {
    const pageResponse = await fetch(STATUS_URL, {
      headers: { Accept: 'text/html', 'User-Agent': 'Stillwater-DWS-Report-Importer/1.0' },
      signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
    });
    if (!pageResponse.ok)
      throw new Error(`DWS weekly status page returned HTTP ${pageResponse.status}`);
    if (!(pageResponse.headers.get('content-type') ?? '').toLowerCase().includes('text/html')) {
      throw new Error('DWS weekly status page was not HTML');
    }
    const pageLength = Number(pageResponse.headers.get('content-length'));
    if (pageLength > MAX_PAGE_BYTES)
      throw new Error('DWS weekly status page exceeded the size limit');
    const statusPage = (await readLimitedBytes(pageResponse, MAX_PAGE_BYTES)).toString('utf8');
    const { reportUrl, reportDate } = parseReportLink(statusPage);

    stage = 'DWS reservoir PDF request';
    const pdfBytes = await downloadDwsPdf(reportUrl);

    stage = 'DWS PDF parsing';
    const aliasRows = await sql`
      SELECT a.location_id AS "locationId", a.source_alias AS "sourceAlias"
      FROM public.data_source_location_aliases a
      JOIN public.locations l ON l.id = a.location_id
      WHERE a.source_id = ${SOURCE_ID} AND l.is_published = true AND l.point IS NOT NULL
      ORDER BY length(a.source_alias) DESC
    `;
    const reports = await parseDwsPdf(pdfBytes, reportDate, aliasRows);
    stage = 'Neon capacity validation';
    const accepted = [];
    const capacityMismatches = [];
    for (const report of reports) {
      const capacityRows = await sql`
        SELECT value
        FROM public.location_facts
        WHERE location_id = ${report.locationId} AND fact_key = 'full_supply_capacity'
        ORDER BY source_data_date DESC NULLS LAST
        LIMIT 1
      `;
      const expectedCapacity = Number(capacityRows[0]?.value);
      if (
        Number.isFinite(expectedCapacity) &&
        expectedCapacity > 0 &&
        Math.abs(report.capacityMillionM3 - expectedCapacity) / expectedCapacity > 0.05
      ) {
        capacityMismatches.push({
          locationId: report.locationId,
          reportCapacityMillionM3: report.capacityMillionM3,
          savedCapacityMillionM3: expectedCapacity,
        });
      } else {
        accepted.push(report);
      }
    }
    if (accepted.length === 0) {
      const summary = capacityMismatches
        .map(
          (item) =>
            `${item.locationId}: report ${item.reportCapacityMillionM3} vs saved ${item.savedCapacityMillionM3}`,
        )
        .join('; ');
      const error = new Error(
        `All ${reports.length} matched reservoir rows failed capacity validation${summary ? ` (${summary})` : ''}`,
      );
      error.metadata = {
        matched_location_ids: reports.map((report) => report.locationId),
        capacity_mismatches: capacityMismatches,
      };
      throw error;
    }

    stage = 'Neon observation upsert';
    let recordsWritten = 0;
    let recordsSkippedStale = 0;
    const staleLocationIds = [];
    for (const report of accepted) {
      const previousRows = await sql`
        SELECT to_char(observed_at AT TIME ZONE 'Africa/Johannesburg', 'YYYY-MM-DD') AS report_date,
               value, metadata
        FROM public.location_observations
        WHERE location_id = ${report.locationId} AND metric = ${METRIC} AND source_id = ${SOURCE_ID}
        ORDER BY observed_at DESC
        LIMIT 1
      `;
      const previous = previousRows[0];
      const previousDate =
        previous?.report_date == null ? null : String(previous.report_date).slice(0, 10);
      if (previousDate && report.reportDate < previousDate) {
        recordsSkippedStale += 1;
        staleLocationIds.push(report.locationId);
        continue;
      }

      const metadata = {
        report_url: reportUrl,
        source_row_alias: report.sourceAlias,
        full_supply_capacity_million_m3: report.capacityMillionM3,
        water_in_storage_million_m3: report.storageMillionM3,
        previous_week_percent: report.previousWeekPercent,
        previous_year_percent: report.previousYearPercent,
        latest_available_marker: report.latestAvailable,
      };
      const unchanged =
        previousDate === report.reportDate &&
        Number(previous.value) === report.storagePercent &&
        previous.metadata?.latest_available_marker === report.latestAvailable &&
        Number(previous.metadata?.full_supply_capacity_million_m3) === report.capacityMillionM3;

      await sql`
        WITH capacity_fact AS (
          INSERT INTO public.location_facts (
          location_id, fact_key, value, unit, source_id, source_data_date,
          verification_status, checked_at
          ) VALUES (
            ${report.locationId}, 'full_supply_capacity', ${JSON.stringify(report.capacityMillionM3)}::jsonb,
            'million m3', ${SOURCE_ID}, ${report.reportDate}, 'verified_primary', now()
          )
          ON CONFLICT (location_id, fact_key, source_id, source_data_date)
          DO UPDATE SET value = EXCLUDED.value, unit = EXCLUDED.unit,
                        verification_status = EXCLUDED.verification_status, checked_at = now()
          RETURNING location_id
        )
        INSERT INTO public.location_observations (
          location_id, metric, value, unit, source_id, captured_from_source_id,
          observed_at, retrieved_at, verification_status, metadata
        ) VALUES (
          ${report.locationId}, ${METRIC}, ${report.storagePercent}, '%', ${SOURCE_ID}, null,
          ${`${report.reportDate}T00:00:00+02:00`}, now(), 'verified_primary', ${JSON.stringify(metadata)}::jsonb
        )
        ON CONFLICT (location_id, metric, source_id, observed_at)
        DO UPDATE SET value = EXCLUDED.value, captured_from_source_id = null,
                      retrieved_at = now(), verification_status = 'verified_primary',
                      metadata = EXCLUDED.metadata
      `;
      if (!unchanged) recordsWritten += 1;
    }

    const status =
      recordsSkippedStale === accepted.length
        ? 'skipped_stale'
        : recordsWritten === 0
          ? 'no_change'
          : 'succeeded';
    const metadata = {
      report_url: reportUrl,
      matched_location_ids: reports.map((report) => report.locationId),
      capacity_mismatches: capacityMismatches,
      records_skipped_stale: recordsSkippedStale,
      stale_location_ids: staleLocationIds,
    };
    stage = 'Neon import audit update';
    await sql`
      UPDATE public.data_ingest_runs
      SET finished_at = now(), status = ${status}, report_date = ${reportDate},
          records_seen = ${reports.length}, records_written = ${recordsWritten},
          metadata = ${JSON.stringify(metadata)}::jsonb
      WHERE id = ${runId}
    `;

    return {
      status,
      reportDate,
      recordsSeen: reports.length,
      recordsWritten,
      matchedLocationIds: reports.map((report) => report.locationId),
      capacityMismatches,
      recordsSkippedStale,
      staleLocationIds,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown import failure';
    const message = `${stage}: ${detail}`.slice(0, 500);
    try {
      await sql`
        UPDATE public.data_ingest_runs
        SET finished_at = now(), status = 'failed', error_message = ${message},
            metadata = ${JSON.stringify({ failure_stage: stage, ...(error?.metadata ?? {}) })}::jsonb
        WHERE id = ${runId}
      `;
    } catch (logError) {
      console.error('Could not record DWS import failure:', logError.message);
    }
    throw new Error(message, { cause: error });
  }
}
