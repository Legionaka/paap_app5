-- Stillwater location catalogue foundation.
-- Apply to your Neon database with a server-side migration role. Keep DATABASE_URL out of browser code.
create schema if not exists extensions;
create extension if not exists postgis with schema extensions;

create table if not exists public.data_sources (
  id text primary key,
  title text not null,
  publisher text not null,
  url text not null,
  source_type text not null check (source_type in ('official', 'official_report', 'secondary_transcription', 'weather_provider', 'community')),
  update_cadence text,
  license_note text,
  access_note text,
  created_at timestamptz not null default now()
);

create table if not exists public.locations (
  id text primary key,
  name text not null,
  location_type text not null check (location_type in ('dam', 'reservoir', 'river', 'lake', 'fishing_access')),
  province text not null,
  country_code char(2) not null default 'ZA',
  point extensions.geography(point, 4326),
  coordinate_precision text not null default 'approximate',
  coordinate_source_id text references public.data_sources(id),
  river_name text,
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists locations_point_gix on public.locations using gist (point);
create index if not exists locations_region_idx on public.locations (country_code, province, location_type);

create table if not exists public.location_facts (
  id bigint generated always as identity primary key,
  location_id text not null references public.locations(id) on delete cascade,
  fact_key text not null,
  value jsonb not null,
  unit text,
  source_id text not null references public.data_sources(id),
  source_data_date date,
  captured_from_source_id text references public.data_sources(id),
  verification_status text not null check (verification_status in ('verified_primary', 'transcribed_secondary', 'community_reported', 'unverified')),
  checked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (location_id, fact_key, source_id, source_data_date)
);

create table if not exists public.location_observations (
  id bigint generated always as identity primary key,
  location_id text not null references public.locations(id) on delete cascade,
  metric text not null,
  value numeric not null,
  unit text not null,
  source_id text not null references public.data_sources(id),
  captured_from_source_id text references public.data_sources(id),
  observed_at timestamptz not null,
  retrieved_at timestamptz not null default now(),
  verification_status text not null check (verification_status in ('verified_primary', 'transcribed_secondary', 'estimated', 'community_reported')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (location_id, metric, source_id, observed_at)
);

create index if not exists location_observations_latest_idx on public.location_observations (location_id, metric, observed_at desc);

create table if not exists public.species (
  id text primary key,
  common_name text not null,
  scientific_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.location_species (
  location_id text not null references public.locations(id) on delete cascade,
  species_id text not null references public.species(id),
  source_id text not null references public.data_sources(id),
  source_data_date date,
  evidence_type text not null check (evidence_type in ('official_survey', 'official_ecological_report', 'community_catch')),
  checked_at timestamptz not null default now(),
  primary key (location_id, species_id, source_id)
);

-- Seed source register and the first published location from the research snapshot.
insert into public.data_sources (id, title, publisher, url, source_type, update_cadence, license_note, access_note)
values
  ('dws-weekly-dam-levels', 'Weekly state of dams — drainage region A', 'South African Department of Water and Sanitation', 'https://www.dws.gov.za/hydrology/Weekly/DrainageWeek.aspx?region=A', 'official', 'weekly', 'Confirm reuse terms with DWS before commercial redistribution.', 'Latest storage observation was transcribed from a secondary summary; capacity is from a DWS report. No automated DWS feed is connected.'),
  ('anglershub-hartbeespoort', 'Hartbeespoort Dam weekly level summary', 'AnglersHub', 'https://anglershub.co.za/dam-levels/hartbeespoort-dam', 'secondary_transcription', 'weekly', null, 'Secondary transcription of a DWS report, checked 2026-10-25; not a direct API response.'),
  ('dws-crocodile-water-quality', 'Crocodile River catchment water resource quality', 'South African Department of Water and Sanitation', 'https://www.dws.gov.za/iwrp/crocodilemaintenance/Documents/SSC1/SSC1%206.4%20Water%20Resource%20Quality.pdf', 'official_report', null, 'Check DWS terms before commercial redistribution.', 'Ecological report; not a current fish survey.'),
  ('open-meteo-weather', 'Open-Meteo weather forecast API', 'Open-Meteo', 'https://open-meteo.com/en/docs', 'weather_provider', 'Forecast models update several times daily', 'Free API is for non-commercial use; a paid plan is required for commercial use.', 'Model output at approximate dam coordinates, not a local station observation.')
on conflict (id) do update set title = excluded.title, publisher = excluded.publisher, url = excluded.url, source_type = excluded.source_type, update_cadence = excluded.update_cadence, license_note = excluded.license_note, access_note = excluded.access_note;

insert into public.species (id, common_name)
values ('carp', 'Carp'), ('barbel', 'Barbel'), ('canary-kurper', 'Canary Kurper')
on conflict (id) do update set common_name = excluded.common_name;

insert into public.locations (id, name, location_type, province, country_code, point, coordinate_precision, coordinate_source_id, river_name, is_published)
values ('hartbeespoort-dam', 'Hartbeespoort Dam', 'reservoir', 'North West', 'ZA', extensions.st_setsrid(extensions.st_makepoint(27.85, -25.73), 4326)::extensions.geography, 'approximate', 'anglershub-hartbeespoort', 'Krokodil (Crocodile) River', true)
on conflict (id) do update set name = excluded.name, location_type = excluded.location_type, province = excluded.province, point = excluded.point, coordinate_precision = excluded.coordinate_precision, coordinate_source_id = excluded.coordinate_source_id, river_name = excluded.river_name, is_published = excluded.is_published, updated_at = now();

insert into public.location_facts (location_id, fact_key, value, unit, source_id, source_data_date, captured_from_source_id, verification_status, checked_at)
values ('hartbeespoort-dam', 'full_supply_capacity', '185.8'::jsonb, 'million m3', 'dws-weekly-dam-levels', '2026-06-08', null, 'verified_primary', '2026-10-25T14:08:00+02:00')
on conflict (location_id, fact_key, source_id, source_data_date) do update set value = excluded.value, unit = excluded.unit, captured_from_source_id = excluded.captured_from_source_id, verification_status = excluded.verification_status, checked_at = excluded.checked_at;

insert into public.location_observations (location_id, metric, value, unit, source_id, captured_from_source_id, observed_at, retrieved_at, verification_status)
values ('hartbeespoort-dam', 'storage_percent_full_supply', 100.6, '%', 'dws-weekly-dam-levels', 'anglershub-hartbeespoort', '2026-10-19T00:00:00+02:00', '2026-10-25T14:08:00+02:00', 'transcribed_secondary')
on conflict (location_id, metric, source_id, observed_at) do update set value = excluded.value, captured_from_source_id = excluded.captured_from_source_id, retrieved_at = excluded.retrieved_at, verification_status = excluded.verification_status;

insert into public.location_species (location_id, species_id, source_id, source_data_date, evidence_type, checked_at)
values
  ('hartbeespoort-dam', 'carp', 'dws-crocodile-water-quality', null, 'official_ecological_report', '2026-10-25T14:08:00+02:00'),
  ('hartbeespoort-dam', 'barbel', 'dws-crocodile-water-quality', null, 'official_ecological_report', '2026-10-25T14:08:00+02:00'),
  ('hartbeespoort-dam', 'canary-kurper', 'dws-crocodile-water-quality', null, 'official_ecological_report', '2026-10-25T14:08:00+02:00')
on conflict (location_id, species_id, source_id) do update set source_data_date = excluded.source_data_date, evidence_type = excluded.evidence_type, checked_at = excluded.checked_at;
