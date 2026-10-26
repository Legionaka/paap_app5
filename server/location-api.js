import { neon } from '@neondatabase/serverless';

const toSourceType = value => value.replaceAll('_', '-');

export async function getPublishedLocations() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    const error = new Error('DATABASE_URL is not configured');
    error.statusCode = 503;
    throw error;
  }
  const sql = neon(connectionString);
  return sql`
    SELECT l.id, l.name, l.location_type AS type, l.province, l.country_code AS country,
           l.river_name AS river,
           (SELECT count(*)::int FROM public.location_facts f WHERE f.location_id = l.id) AS "factCount",
           (SELECT max(f.checked_at) FROM public.location_facts f WHERE f.location_id = l.id) AS "lastCheckedAt"
    FROM public.locations l
    WHERE l.is_published = true AND l.point IS NOT NULL
    ORDER BY l.province, l.name
    LIMIT 250
  `;
}

export async function getPublishedLocation(locationId) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    const error = new Error('DATABASE_URL is not configured');
    error.statusCode = 503;
    throw error;
  }

  const sql = neon(connectionString);
  const [locations, facts, observations, species, sources] = await Promise.all([
    sql`SELECT id, name, location_type AS type, province, country_code,
               extensions.st_y(point::extensions.geometry) AS latitude,
               extensions.st_x(point::extensions.geometry) AS longitude,
               coordinate_precision AS precision, coordinate_source_id AS "coordinateSourceId",
               river_name AS river
        FROM public.locations
        WHERE id = ${locationId} AND is_published = true AND point IS NOT NULL`,
    sql`SELECT fact_key AS key, value, unit, source_id AS "sourceId",
               source_data_date AS "sourceDate",
               replace(verification_status, '_', '-') AS status
        FROM public.location_facts
        WHERE location_id = ${locationId}
          AND EXISTS (SELECT 1 FROM public.locations WHERE id = ${locationId} AND is_published = true)
        ORDER BY source_data_date DESC NULLS LAST`,
    sql`SELECT metric, value, unit, source_id AS "sourceId",
               observed_at::date AS "sourceDate",
               captured_from_source_id AS "capturedFromSourceId",
               observed_at AS "observedAt", retrieved_at AS "capturedAt", metadata,
               replace(verification_status, '_', '-') AS status
        FROM public.location_observations
        WHERE location_id = ${locationId}
          AND EXISTS (SELECT 1 FROM public.locations WHERE id = ${locationId} AND is_published = true)
        ORDER BY observed_at DESC`,
    sql`SELECT s.common_name AS name, ls.source_id AS "sourceId",
               replace(ls.evidence_type, '_', '-') AS status
        FROM public.location_species ls
        JOIN public.species s ON s.id = ls.species_id
        WHERE ls.location_id = ${locationId}
          AND EXISTS (SELECT 1 FROM public.locations WHERE id = ${locationId} AND is_published = true)
        ORDER BY s.common_name`,
    sql`SELECT id, title, publisher, url,
               replace(source_type, '_', '-') AS "sourceType",
               update_cadence AS "updateCadence", license_note AS "licenseNote",
               access_note AS "accessNote"
        FROM public.data_sources
        ORDER BY title`,
  ]);

  const row = locations[0];
  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    type: row.type,
    province: row.province,
    country: row.country_code === 'ZA' ? 'South Africa' : row.country_code,
    coordinates: {
      latitude: row.latitude,
      longitude: row.longitude,
      precision: row.precision,
      sourceId: row.coordinateSourceId,
    },
    river: row.river,
    facts: facts.map(item => ({ ...item, label: item.key.replaceAll('_', ' ') })),
    observations: observations.map(item => ({
      ...item,
      label: item.metric.replaceAll('_', ' '),
      cadence: 'reported',
      latestAvailable: Boolean(item.metadata?.latest_available_marker),
    })),
    species,
    sources: sources.map(source => ({ ...source, id: source.id, sourceType: toSourceType(source.sourceType) })),
  };
}
