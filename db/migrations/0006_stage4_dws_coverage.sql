-- Stage 4: map DWS weekly reservoir report labels to published location IDs.
-- Only rows explicitly matched in a dated DWS report are ingested.

create table if not exists public.data_source_location_aliases (
  source_id text not null references public.data_sources(id) on delete cascade,
  location_id text not null references public.locations(id) on delete cascade,
  source_alias text not null,
  match_mode text not null default 'contains' check (match_mode in ('contains')),
  created_at timestamptz not null default now(),
  primary key (source_id, location_id),
  unique (source_id, source_alias)
);

create index if not exists data_source_location_aliases_location_idx
  on public.data_source_location_aliases (location_id, source_id);

insert into public.data_source_location_aliases (source_id, location_id, source_alias)
values
  ('dws-weekly-dam-levels', 'hartbeespoort-dam', 'hartbeesp'),
  ('dws-weekly-dam-levels', 'vaalkop-dam', 'vaalkop'),
  ('dws-weekly-dam-levels', 'roodekopjes-dam', 'roodekopj'),
  ('dws-weekly-dam-levels', 'boskop-dam', 'boskop'),
  ('dws-weekly-dam-levels', 'voelvlei-dam', 'voelvlei'),
  ('dws-weekly-dam-levels', 'greater-brandvlei-dam', 'brandvlei lower'),
  ('dws-weekly-dam-levels', 'misverstand-dam', 'misverstand'),
  ('dws-weekly-dam-levels', 'theewaterskloof-dam', 'theewaterskloof'),
  ('dws-weekly-dam-levels', 'clanwilliam-dam', 'clanwilliam')
on conflict (source_id, location_id) do update set
  source_alias = excluded.source_alias,
  match_mode = excluded.match_mode;

update public.locations
set name = 'Brandvlei Dam (Lower Brandvlei)', updated_at = now()
where id = 'greater-brandvlei-dam';

update public.data_sources
set title = 'Weekly state of reservoirs — DWS report',
    update_cadence = 'weekly',
    access_note = 'Automated importer follows the official status page to its dated reservoir report. Only explicitly matched location rows are stored. Report values are weekly and are not live readings.'
where id = 'dws-weekly-dam-levels';
