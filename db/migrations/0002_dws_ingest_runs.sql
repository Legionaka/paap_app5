-- Audit scheduled imports from the DWS weekly reservoir PDF.
create table if not exists public.data_ingest_runs (
  id bigint generated always as identity primary key,
  source_id text not null references public.data_sources(id),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null check (status in ('running', 'succeeded', 'no_change', 'skipped_stale', 'failed')),
  report_date date,
  records_seen integer not null default 0,
  records_written integer not null default 0,
  error_message text,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists data_ingest_runs_source_started_idx
  on public.data_ingest_runs (source_id, started_at desc);

update public.data_sources
set name = 'Weekly state of dams — DWS reservoir report',
    url = 'https://www.dws.gov.za/drought/weeklystatus.aspx',
    access_note = 'Automated importer follows the official weekly status page to its dated reservoir PDF and checks the Hartbeespoort row daily. Report values are weekly.'
where id = 'dws-weekly-dam-levels';
