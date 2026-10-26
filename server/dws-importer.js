import { load } from 'cheerio';
import { neon } from '@neondatabase/serverless';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const SOURCE_ID = 'dws-weekly-dam-levels';
const LOCATION_ID = 'hartbeespoort-dam';
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
    timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value);
  const dateParts = Object.fromEntries(parts.map(part => [part.type, part.value]));
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
      if (contentLength > MAX_REPORT_BYTES) throw new Error('DWS reservoir PDF exceeded the size limit');
      return await readLimitedBytes(response, MAX_REPORT_BYTES);
    } catch (error) {
      lastError = error;
      if (attempt === PDF_ATTEMPTS || error.message.includes('size limit') || error.message.includes('not a PDF')) {
        break;
      }
    }
  }
  throw new Error(`DWS PDF download failed after ${PDF_ATTEMPTS} attempts: ${lastError?.message ?? 'unknown network error'}`);
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
  throw new Error(`DWS weekly status page did not link to a dated reservoir PDF${updated ? ` (page date: ${updated[1]})` : ''}`);
}

async function parseDwsPdf(pdfBytes, reportDate) {
  const loadingTask = getDocument({ data: new Uint8Array(pdfBytes), useSystemFonts: true, isEvalSupported: false });
  let pdf;
  let damLine = '';
  try {
    pdf = await loadingTask.promise;
    for (let pageNumber = 1; pageNumber <= pdf.numPages && !damLine; pageNumber += 1) {
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
        const line = cells.sort((a, b) => a.x - b.x).map(cell => cell.text).join(' ');
        // The PDF wraps the last four letters of "Hartbeespoort" onto a second
        // baseline, while the numeric columns remain on the first baseline.
        if (line.toLowerCase().includes('hartbeesp')) {
          damLine = line;
          break;
        }
      }
      page.cleanup();
    }
  } finally {
    await loadingTask.destroy();
  }
  if (!damLine) throw new Error('Hartbeespoort Dam was missing from the dated DWS reservoir PDF');

  const values = [...damLine.matchAll(/#?\s*(\d[\d,]*(?:\.\d+)?)/g)].map(match => ({
    value: Number(match[1].replaceAll(',', '')),
    latestAvailable: match[0].trim().startsWith('#'),
  })).slice(-5);
  if (values.length !== 5 || values.some(item => !Number.isFinite(item.value))) {
    throw new Error('DWS Hartbeespoort PDF row did not contain capacity, volume and three percentage values');
  }
  const [capacity, , previousYear, previousWeek, current] = values;
  if (capacity.value < 0.01 || capacity.value > 1000000) throw new Error('DWS full supply capacity failed validation');
  if (current.value < 0 || current.value > 200) throw new Error('DWS storage percentage failed validation');

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const latestAllowedDate = southAfricaDate(tomorrow);
  if (reportDate > latestAllowedDate) throw new Error('DWS report date is in the future');

  return {
    reportDate,
    capacityMillionM3: capacity.value,
    storagePercent: current.value,
    latestAvailable: current.latestAvailable,
    previousWeekPercent: previousWeek.value,
    previousYearPercent: previousYear.value,
  };
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
    if (!pageResponse.ok) throw new Error(`DWS weekly status page returned HTTP ${pageResponse.status}`);
    if (!(pageResponse.headers.get('content-type') ?? '').toLowerCase().includes('text/html')) {
      throw new Error('DWS weekly status page was not HTML');
    }
    const pageLength = Number(pageResponse.headers.get('content-length'));
    if (pageLength > MAX_PAGE_BYTES) throw new Error('DWS weekly status page exceeded the size limit');
    const statusPage = (await readLimitedBytes(pageResponse, MAX_PAGE_BYTES)).toString('utf8');
    const { reportUrl, reportDate } = parseReportLink(statusPage);

    stage = 'DWS reservoir PDF request';
    const pdfBytes = await downloadDwsPdf(reportUrl);

    stage = 'DWS PDF parsing';
    const report = await parseDwsPdf(pdfBytes, reportDate);
    stage = 'Neon capacity validation';
    const capacityRows = await sql`
      SELECT value
      FROM public.location_facts
      WHERE location_id = ${LOCATION_ID} AND fact_key = 'full_supply_capacity'
      ORDER BY source_data_date DESC NULLS LAST
      LIMIT 1
    `;
    const expectedCapacity = Number(capacityRows[0]?.value);
    if (Number.isFinite(expectedCapacity)
      && Math.abs(report.capacityMillionM3 - expectedCapacity) / expectedCapacity > 0.05) {
      throw new Error('DWS capacity did not match the saved location record');
    }

    stage = 'Neon observation lookup';
    const previousRows = await sql`
      SELECT to_char(observed_at AT TIME ZONE 'Africa/Johannesburg', 'YYYY-MM-DD') AS report_date,
             value, metadata
      FROM public.location_observations
      WHERE location_id = ${LOCATION_ID} AND metric = ${METRIC} AND source_id = ${SOURCE_ID}
      ORDER BY observed_at DESC
      LIMIT 1
    `;
    const previous = previousRows[0];
    const previousDate = previous?.report_date == null ? null : String(previous.report_date).slice(0, 10);
    const metadata = {
      report_url: reportUrl,
      full_supply_capacity_million_m3: report.capacityMillionM3,
      previous_week_percent: report.previousWeekPercent,
      previous_year_percent: report.previousYearPercent,
      latest_available_marker: report.latestAvailable,
    };

    if (previousDate && report.reportDate < previousDate) {
      stage = 'Neon stale-report audit update';
      await sql`
        UPDATE public.data_ingest_runs
        SET finished_at = now(), status = 'skipped_stale', report_date = ${report.reportDate},
            records_seen = 1, metadata = ${JSON.stringify(metadata)}::jsonb
        WHERE id = ${runId}
      `;
      return {
        status: 'skipped_stale',
        reportDate: report.reportDate,
        existingReportDate: previousDate,
      };
    }

    const unchanged = previousDate === report.reportDate
      && Number(previous.value) === report.storagePercent
      && previous.metadata?.latest_available_marker === report.latestAvailable;

    stage = 'Neon observation upsert';
    await sql`
      INSERT INTO public.location_observations (
        location_id, metric, value, unit, source_id, captured_from_source_id,
        observed_at, retrieved_at, verification_status, metadata
      ) VALUES (
        ${LOCATION_ID}, ${METRIC}, ${report.storagePercent}, '%', ${SOURCE_ID}, null,
        ${`${report.reportDate}T00:00:00+02:00`}, now(), 'verified_primary', ${JSON.stringify(metadata)}::jsonb
      )
      ON CONFLICT (location_id, metric, source_id, observed_at)
      DO UPDATE SET value = EXCLUDED.value, captured_from_source_id = null,
                    retrieved_at = now(), verification_status = 'verified_primary',
                    metadata = EXCLUDED.metadata
    `;

    stage = 'Neon import audit update';
    await sql`
      UPDATE public.data_ingest_runs
      SET finished_at = now(), status = ${unchanged ? 'no_change' : 'succeeded'},
          report_date = ${report.reportDate}, records_seen = 1,
          records_written = ${unchanged ? 0 : 1}, metadata = ${JSON.stringify(metadata)}::jsonb
      WHERE id = ${runId}
    `;

    return {
      status: unchanged ? 'no_change' : 'succeeded',
      reportDate: report.reportDate,
      storagePercent: report.storagePercent,
      latestAvailable: report.latestAvailable,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown import failure';
    const message = `${stage}: ${detail}`.slice(0, 500);
    try {
      await sql`
        UPDATE public.data_ingest_runs
        SET finished_at = now(), status = 'failed', error_message = ${message}
        WHERE id = ${runId}
      `;
    } catch (logError) {
      console.error('Could not record DWS import failure:', logError.message);
    }
    throw new Error(message, { cause: error });
  }
}
