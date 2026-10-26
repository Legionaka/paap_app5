-- Initial North West directory entries. Coordinates are approximate and sourced
-- from DWS dam mapping / resource-management publications; access is not asserted.
insert into public.data_sources
  (id, title, publisher, url, source_type, update_cadence, license_note, access_note)
values
  ('dws-dam-location-register', 'DWS South African dam location register', 'South African Department of Water and Sanitation', 'https://www.dws.gov.za/iwqs/gis_apps/dam/dams/index.htm', 'official_report', null, 'Confirm reuse terms with DWS before commercial redistribution.', 'Legacy dam register used for approximate map coordinates; confirm location on current maps.'),
  ('dws-roodekopjes-rmp', 'Roodekopjes Dam Resource Management Plan', 'South African Department of Water and Sanitation', 'https://www.dws.gov.za/Documents/Approved%20Resource%20Management%20Plans/Roodekoppies%20Dam/Roodekopjes%20Dam%20RMP.pdf', 'official_report', null, 'Confirm reuse terms with DWS before commercial redistribution.', '2017 management plan used for approximate location and river context; not a current access notice.')
on conflict (id) do update set title = excluded.title, publisher = excluded.publisher, url = excluded.url,
  source_type = excluded.source_type, update_cadence = excluded.update_cadence,
  license_note = excluded.license_note, access_note = excluded.access_note;

insert into public.locations
  (id, name, location_type, province, country_code, point, coordinate_precision, coordinate_source_id, river_name, is_published)
values
  ('boskop-dam', 'Boskop Dam', 'dam', 'North West', 'ZA', extensions.st_setsrid(extensions.st_makepoint(27.119417, -26.54575), 4326)::extensions.geography, 'approximate', 'dws-dam-location-register', 'Mooi River', true),
  ('vaalkop-dam', 'Vaalkop Dam', 'dam', 'North West', 'ZA', extensions.st_setsrid(extensions.st_makepoint(27.445472, -25.338556), 4326)::extensions.geography, 'approximate', 'dws-dam-location-register', 'Elands River', true),
  ('roodekopjes-dam', 'Roodekopjes Dam', 'dam', 'North West', 'ZA', extensions.st_setsrid(extensions.st_makepoint(27.5775, -25.406667), 4326)::extensions.geography, 'approximate', 'dws-roodekopjes-rmp', 'Crocodile River', true)
on conflict (id) do update set name = excluded.name, location_type = excluded.location_type,
  province = excluded.province, country_code = excluded.country_code, point = excluded.point,
  coordinate_precision = excluded.coordinate_precision, coordinate_source_id = excluded.coordinate_source_id,
  river_name = excluded.river_name, is_published = excluded.is_published, updated_at = now();
