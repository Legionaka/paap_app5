-- Stage 3: broaden the sourced location directory and expose record provenance.
-- Apply after 0004_location_directory.sql.

alter table public.locations
  add column if not exists coordinate_source_date date;

alter table public.location_species
  drop constraint if exists location_species_evidence_type_check;
alter table public.location_species
  add constraint location_species_evidence_type_check
  check (evidence_type in (
    'official_survey', 'official_ecological_report', 'official_fishing_guide',
    'official_resource_management_plan',
    'community_catch'
  ));

insert into public.data_sources
  (id, title, publisher, url, source_type, update_cadence, license_note, access_note)
values
  ('cape-nature-freshwater-fishing', 'Recreational fishing permit, spots and species guide', 'CapeNature', 'https://www.capenature.co.za/permits/recreational-fishing-permit-dams-and-rivers', 'official', null, 'Confirm reuse terms with CapeNature before commercial redistribution.', 'Guide gives popular spots and commonly fished species; confirm current entry, access, licence and site-specific conditions before travel.'),
  ('dws-clanwilliam-rqs', 'Clanwilliam Dam resource quality station', 'South African Department of Water and Sanitation', 'https://www.dws.gov.za/iwqs/gis_apps/dam/dams/clanwilliam.htm', 'official', null, 'Confirm reuse terms with DWS before commercial redistribution.', 'Legacy DWS station coordinates are approximate and dated; use for mapping only.'),
  ('dws-theewaterskloof-rqs', 'Theewaterskloof Dam resource quality station', 'South African Department of Water and Sanitation', 'https://www.dwa.gov.za/iwqs/gis_apps/dam/dams/theewaterskloof.htm', 'official', null, 'Confirm reuse terms with DWS before commercial redistribution.', 'Legacy DWS station coordinates are approximate and dated; use for mapping only.'),
  ('dws-voelvlei-rmp', 'Voëlvlei Dam Resource Management Plan', 'South African Department of Water and Sanitation', 'https://www.dws.gov.za/Documents/Approved%20Resource%20Management%20Plans/Voelvlei%20Dam/Voelvlei%20RMP.pdf', 'official_report', null, 'Confirm reuse terms with DWS before commercial redistribution.', '2015 management plan; historical planning context, not a current access notice.'),
  ('dws-greater-brandvlei-rmp', 'Greater Brandvlei Dam Resource Management Plan', 'South African Department of Water and Sanitation', 'https://www.dws.gov.za/Documents/Approved%20Resource%20Management%20Plans/Greater%20Brandvlei%20Dam/Greater%20Brandvlei%20RMP.pdf', 'official_report', null, 'Confirm reuse terms with DWS before commercial redistribution.', '2015 management plan; historical facilities and access descriptions must be reconfirmed.'),
  ('dws-misverstand-station', 'Misverstand Dam hydrology station', 'South African Department of Water and Sanitation', 'https://www.dws.gov.za/Hydrology/Verified/HyStations.aspx?Region=G&StationType=rbMeteor', 'official', null, 'Confirm reuse terms with DWS before commercial redistribution.', 'Station point is approximate to the dam; it is not a surveyed shoreline access point.'),
  ('dws-major-dams-map-2014', 'South Africa major dams map (2014)', 'South African Department of Water and Sanitation', 'https://www.dws.gov.za/SLIM/Digital%20Map%20Library/RSA_Dams_Weekly_Aug2014_A0.pdf', 'official_report', null, 'Confirm reuse terms with DWS before commercial redistribution.', '2014 map coordinates are approximate; use for general location only.')
on conflict (id) do update set
  title = excluded.title, publisher = excluded.publisher, url = excluded.url,
  source_type = excluded.source_type, update_cadence = excluded.update_cadence,
  license_note = excluded.license_note, access_note = excluded.access_note;

insert into public.locations
  (id, name, location_type, province, country_code, point, coordinate_precision,
   coordinate_source_id, coordinate_source_date, river_name, is_published)
values
  ('greater-brandvlei-dam', 'Greater Brandvlei Dam', 'dam', 'Western Cape', 'ZA', extensions.st_setsrid(extensions.st_makepoint(19.433189, -33.693611), 4326)::extensions.geography, 'approximate', 'dws-major-dams-map-2014', null, 'Lower Brandvlei River', true),
  ('misverstand-dam', 'Misverstand Dam', 'dam', 'Western Cape', 'ZA', extensions.st_setsrid(extensions.st_makepoint(18.78688, -33.02512), 4326)::extensions.geography, 'approximate', 'dws-misverstand-station', null, 'Berg River', true),
  ('theewaterskloof-dam', 'Theewaterskloof Dam', 'dam', 'Western Cape', 'ZA', extensions.st_setsrid(extensions.st_makepoint(19.203675, -34.030046), 4326)::extensions.geography, 'approximate', 'dws-theewaterskloof-rqs', '2004-05-21', 'Riviersonderend River', true),
  ('voelvlei-dam', 'Voëlvlei Dam', 'dam', 'Western Cape', 'ZA', extensions.st_setsrid(extensions.st_makepoint(19.02472, -33.34556), 4326)::extensions.geography, 'approximate', 'dws-voelvlei-rmp', null, null, true),
  ('clanwilliam-dam', 'Clanwilliam Dam', 'dam', 'Western Cape', 'ZA', extensions.st_setsrid(extensions.st_makepoint(18.909434, -32.257154), 4326)::extensions.geography, 'approximate', 'dws-clanwilliam-rqs', '2004-05-21', 'Olifants River', true)
on conflict (id) do update set
  name = excluded.name, location_type = excluded.location_type,
  province = excluded.province, country_code = excluded.country_code,
  point = excluded.point, coordinate_precision = excluded.coordinate_precision,
  coordinate_source_id = excluded.coordinate_source_id,
  coordinate_source_date = excluded.coordinate_source_date,
  river_name = excluded.river_name, is_published = excluded.is_published,
  updated_at = now();

insert into public.species (id, common_name)
values
  ('largemouth-bass', 'Largemouth bass'),
  ('smallmouth-bass', 'Smallmouth bass'),
  ('rainbow-trout', 'Rainbow trout'),
  ('whitefish', 'Berg-Breede whitefish'),
  ('sharptooth-catfish', 'Sharptooth catfish'),
  ('mozambique-tilapia', 'Mozambique tilapia'),
  ('mullet', 'Mullet')
on conflict (id) do update set common_name = excluded.common_name;

insert into public.location_species
  (location_id, species_id, source_id, source_data_date, evidence_type, checked_at)
values
  ('roodekopjes-dam', 'carp', 'dws-roodekopjes-rmp', null, 'official_resource_management_plan', now()),
  ('roodekopjes-dam', 'sharptooth-catfish', 'dws-roodekopjes-rmp', null, 'official_resource_management_plan', now()),
  ('greater-brandvlei-dam', 'carp', 'cape-nature-freshwater-fishing', null, 'official_fishing_guide', now()),
  ('greater-brandvlei-dam', 'whitefish', 'cape-nature-freshwater-fishing', null, 'official_fishing_guide', now()),
  ('misverstand-dam', 'carp', 'cape-nature-freshwater-fishing', null, 'official_fishing_guide', now()),
  ('misverstand-dam', 'largemouth-bass', 'cape-nature-freshwater-fishing', null, 'official_fishing_guide', now()),
  ('misverstand-dam', 'smallmouth-bass', 'cape-nature-freshwater-fishing', null, 'official_fishing_guide', now()),
  ('misverstand-dam', 'mozambique-tilapia', 'cape-nature-freshwater-fishing', null, 'official_fishing_guide', now()),
  ('theewaterskloof-dam', 'largemouth-bass', 'cape-nature-freshwater-fishing', null, 'official_fishing_guide', now()),
  ('theewaterskloof-dam', 'carp', 'cape-nature-freshwater-fishing', null, 'official_fishing_guide', now()),
  ('theewaterskloof-dam', 'sharptooth-catfish', 'cape-nature-freshwater-fishing', null, 'official_fishing_guide', now()),
  ('voelvlei-dam', 'carp', 'cape-nature-freshwater-fishing', null, 'official_fishing_guide', now()),
  ('voelvlei-dam', 'sharptooth-catfish', 'cape-nature-freshwater-fishing', null, 'official_fishing_guide', now())
on conflict (location_id, species_id, source_id) do update set
  source_data_date = excluded.source_data_date,
  evidence_type = excluded.evidence_type,
  checked_at = excluded.checked_at;

-- Make reruns safe even though PostgreSQL unique keys treat NULL source dates
-- as distinct values.
delete from public.location_facts
where location_id in ('greater-brandvlei-dam', 'misverstand-dam', 'theewaterskloof-dam', 'voelvlei-dam', 'clanwilliam-dam')
  and fact_key in ('access_information', 'fishing_rules')
  and source_id = 'cape-nature-freshwater-fishing'
  and source_data_date is null;
delete from public.location_facts
where location_id = 'greater-brandvlei-dam'
  and fact_key = 'facilities'
  and source_id = 'dws-greater-brandvlei-rmp';

-- The guide describes these as accessible angling spots, but does not provide
-- site gate details or guarantee current entry. Clanwilliam access remains unknown.
insert into public.location_facts
  (location_id, fact_key, value, source_id, verification_status, checked_at)
values
  ('greater-brandvlei-dam', 'access_information', to_jsonb('CapeNature lists Brandvlei among accessible angling spots within 150 km of Cape Town. Confirm current entry, access points, hours, fees and permission with the operator before travelling.'::text), 'cape-nature-freshwater-fishing', 'verified_primary', now()),
  ('misverstand-dam', 'access_information', to_jsonb('CapeNature lists Misverstand among accessible angling spots within 150 km of Cape Town. Confirm current entry, access points, hours, fees and permission with the operator before travelling.'::text), 'cape-nature-freshwater-fishing', 'verified_primary', now()),
  ('theewaterskloof-dam', 'access_information', to_jsonb('CapeNature lists Theewaterskloof among accessible angling spots within 150 km of Cape Town. Confirm current entry, access points, hours, fees and permission with the operator before travelling.'::text), 'cape-nature-freshwater-fishing', 'verified_primary', now()),
  ('voelvlei-dam', 'access_information', to_jsonb('CapeNature lists Voëlvlei among accessible angling spots within 150 km of Cape Town. Confirm current entry, access points, hours, fees and permission with the operator before travelling.'::text), 'cape-nature-freshwater-fishing', 'verified_primary', now()),
  ('greater-brandvlei-dam', 'fishing_rules', to_jsonb('CapeNature says freshwater anglers over six need an angling licence for public waters in the Western Cape. Check the current licence requirements and site-specific rules before fishing.'::text), 'cape-nature-freshwater-fishing', 'verified_primary', now()),
  ('misverstand-dam', 'fishing_rules', to_jsonb('CapeNature says freshwater anglers over six need an angling licence for public waters in the Western Cape. Check the current licence requirements and site-specific rules before fishing.'::text), 'cape-nature-freshwater-fishing', 'verified_primary', now()),
  ('theewaterskloof-dam', 'fishing_rules', to_jsonb('CapeNature says freshwater anglers over six need an angling licence for public waters in the Western Cape. Check the current licence requirements and site-specific rules before fishing.'::text), 'cape-nature-freshwater-fishing', 'verified_primary', now()),
  ('voelvlei-dam', 'fishing_rules', to_jsonb('CapeNature says freshwater anglers over six need an angling licence for public waters in the Western Cape. Check the current licence requirements and site-specific rules before fishing.'::text), 'cape-nature-freshwater-fishing', 'verified_primary', now()),
  ('clanwilliam-dam', 'fishing_rules', to_jsonb('CapeNature says freshwater anglers over six need an angling licence for public waters in the Western Cape. Check the current licence requirements and site-specific rules before fishing.'::text), 'cape-nature-freshwater-fishing', 'verified_primary', now())
on conflict do nothing;

insert into public.location_facts
  (location_id, fact_key, value, source_id, source_data_date, verification_status, checked_at)
values
  ('greater-brandvlei-dam', 'facilities', to_jsonb('Historical note: the 2015 DWS management plan described its public access area as having no facilities. This does not confirm current facilities or access.'::text), 'dws-greater-brandvlei-rmp', null, 'verified_primary', now())
on conflict do nothing;
