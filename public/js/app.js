import { locationPhotos } from './location-photos.js';
import { loadWeather, WEATHER_TIME_ZONE } from './weather.js';
import { createLocationMap } from './location-map.js';
import { createCommunity } from './community.js';

const catalogSources = new Map();
let locationIndex = [];
let activeLocationId = null;
let activeLocation = null;
let savedLocationIds = new Set();
try {
  savedLocationIds = new Set(
    JSON.parse(localStorage.getItem('stillwater-saved-locations') ?? '[]'),
  );
} catch {
  /* Keep saving available for this session when storage is blocked. */
}
const search = document.querySelector('#locationSearch');
const provinceFilter = document.querySelector('#provinceFilter');
const speciesFilter = document.querySelector('#speciesFilter');
const toast = document.querySelector('#toast');
const locationMap = createLocationMap((locationId) => selectLocation(locationId));
const community = createCommunity(() => activeLocationId);
let toastTimer;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 2600);
}

async function syncSavedLocations(locationId) {
  try {
    const saved = await community.request('auth/saved-locations');
    const remoteIds = new Set(saved.locations.map((location) => location.id));
    for (const id of savedLocationIds) {
      if (!remoteIds.has(id)) {
        await community
          .request('auth/saved-locations', {
            method: 'POST',
            body: JSON.stringify({ locationId: id }),
          })
          .catch(() => {});
      }
    }
    for (const id of remoteIds) savedLocationIds.add(id);
    localStorage.setItem('stillwater-saved-locations', JSON.stringify([...savedLocationIds]));
    document
      .querySelector('.save-button')
      .classList.toggle('saved', savedLocationIds.has(locationId));
  } catch {
    // Keep local saved locations available when account sync is temporarily unavailable.
  }
}

function formatReportDate(date) {
  return new Intl.DateTimeFormat('en-ZA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: WEATHER_TIME_ZONE,
  }).format(new Date(`${date}T12:00:00+02:00`));
}

function renderCitedFact(element, fact, fallback) {
  const value = fact
    ? typeof fact.value === 'string'
      ? fact.value
      : JSON.stringify(fact.value)
    : fallback;
  element.replaceChildren(document.createTextNode(value));
  if (!fact) return;
  const source = catalogSources.get(fact.sourceId);
  const notes = [];
  if (fact.sourceDate) notes.push(`source dated ${formatReportDate(fact.sourceDate)}`);
  if (fact.checkedAt) notes.push(`checked ${formatReportDate(fact.checkedAt.slice(0, 10))}`);
  if (fact.status) notes.push(fact.status.replaceAll('-', ' '));
  if (notes.length || source) element.append(document.createTextNode(` · ${notes.join(' · ')}`));
  if (source) {
    const link = document.createElement('a');
    link.href = source.url;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.textContent = source.title;
    element.append(document.createTextNode(' · '), link);
  }
}

function renderCatalog(location) {
  activeLocation = location;
  for (const source of location.sources) catalogSources.set(source.id, source);
  const speciesSource = location.species[0]?.sourceId;
  document.querySelector('#speciesSourceLink').href = catalogSources.get(speciesSource)?.url ?? '#';
  document.querySelector('#weatherSourceLink').href =
    catalogSources.get('open-meteo-weather')?.url ?? '#';

  document.querySelector('#featureTitle').textContent = location.name;
  const description = `${location.name} fishing guide: location facts, sourced species records, weather forecasts and local angler discussions in ${location.province}, South Africa.`;
  document.querySelector('#pageTitle').textContent = `${location.name} fishing guide · Stillwater`;
  document.querySelector('#pageDescription').content = description;
  document.querySelector('#pageCanonical').href =
    `${window.location.origin}/explore/locations/${encodeURIComponent(location.id)}/`;
  document.querySelector('#openGraphTitle').content = `${location.name} fishing guide · Stillwater`;
  document.querySelector('#openGraphDescription').content = description;
  document.querySelector('#openGraphUrl').content = document.querySelector('#pageCanonical').href;
  const photo = locationPhotos[location.id];
  document.querySelector('#openGraphImage').content = photo
    ? `${window.location.origin}${photo.src}`
    : '';
  const photoElement = document.querySelector('#locationPhoto');
  const photoCredit = document.querySelector('#locationPhotoCredit');
  const photoPlaceholder = document.querySelector('#locationPhotoPlaceholder');
  photoElement.hidden = !photo;
  photoCredit.hidden = !photo;
  photoPlaceholder.hidden = Boolean(photo);
  if (photo) {
    photoElement.src = photo.src;
    photoElement.alt = photo.alt;
    photoCredit.href = photo.sourceUrl;
    photoCredit.textContent = `Photo: ${photo.credit} · ${photo.license}`;
    photoCredit.title = `Image source and license: ${photo.license}`;
  } else {
    photoElement.removeAttribute('src');
    photoElement.alt = '';
    photoCredit.removeAttribute('href');
    photoCredit.textContent = '';
  }
  document.title = `${location.name} — Stillwater`;
  document.querySelector('.feature-summary p').textContent =
    `${location.name} is a ${location.type} in ${location.province}, South Africa${location.river ? ` on the ${location.river}` : ''}. Access conditions and fishing rules are shown only when verified for this location.`;
  const waterType = document.querySelector('.feature-meta > span');
  const typeLabel = location.type.replaceAll('_', ' ');
  waterType.replaceChildren(
    waterType.querySelector('svg'),
    document.createTextNode(` Freshwater ${typeLabel}`),
  );
  const locationLine = document.querySelector('.image-caption .image-location');
  const pinIcon = locationLine.querySelector('svg');
  document.querySelector('#locationPlaceLine').textContent = [
    location.province,
    location.country,
    location.river,
  ]
    .filter(Boolean)
    .join(' · ');
  locationLine.replaceChildren(pinIcon, document.querySelector('#locationPlaceLine'));
  document.querySelector('#factProvince').textContent = location.province;
  document.querySelector('#factRiver').textContent = location.river;
  document.querySelector('#factWaterType').textContent = `Freshwater ${typeLabel}`;
  const access = location.facts.find((fact) => fact.key === 'access_information');
  const facilities = location.facts.find((fact) => fact.key === 'facilities');
  const rules = location.facts.find((fact) => fact.key === 'fishing_rules');
  renderCitedFact(document.querySelector('#factAccess'), access, 'Not verified');
  renderCitedFact(document.querySelector('#factFacilities'), facilities, 'Not recorded');
  renderCitedFact(document.querySelector('#factRules'), rules, 'Not verified');
  document.querySelector('#communityLocationLabel').textContent =
    `${location.name.toLocaleUpperCase()} COMMUNITY`;
  document.querySelector('#postLocationLabel').textContent =
    `${location.name.toLocaleUpperCase()} COMMUNITY`;
  const sourceNote = document.querySelector('#locationSourceNote');
  const coordinateSource = catalogSources.get(location.coordinates.sourceId);
  sourceNote.replaceChildren(document.createTextNode('Location and approximate coordinates from '));
  const coordinateLink = document.createElement('a');
  coordinateLink.href = coordinateSource?.url ?? '#';
  coordinateLink.target = '_blank';
  coordinateLink.rel = 'noreferrer';
  coordinateLink.textContent = coordinateSource?.title ?? 'unavailable source record';
  sourceNote.append(
    coordinateLink,
    document.createTextNode(
      `; ${location.coordinates.precision} precision${location.coordinates.sourceDate ? `, source dated ${formatReportDate(location.coordinates.sourceDate)}` : ''}.`,
    ),
  );
  document.querySelector('#factCoordinates').textContent =
    `${Math.abs(location.coordinates.latitude).toFixed(2)}\u00b0 S, ${location.coordinates.longitude.toFixed(2)}\u00b0 E (approx.)`;
  document.querySelector('#coordinatesFact').textContent =
    `Approx. ${Math.abs(location.coordinates.latitude).toFixed(2)}\u00b0 S, ${location.coordinates.longitude.toFixed(2)}\u00b0 E`;

  const capacity = location.facts.find((fact) => fact.key === 'full_supply_capacity');
  const capacityMeta = document.querySelector('#capacityFact');
  const capacityFact = document.querySelector('#factCapacity');
  if (capacity) {
    capacityMeta.replaceChildren(
      capacityMeta.querySelector('svg'),
      document.createTextNode(` ${capacity.value} ${capacity.unit} full supply capacity`),
    );
    renderCitedFact(
      capacityFact,
      { ...capacity, value: `${capacity.value} ${capacity.unit}` },
      'Not recorded',
    );
  } else {
    capacityMeta.replaceChildren(
      capacityMeta.querySelector('svg'),
      document.createTextNode(' Capacity not recorded'),
    );
    capacityFact.textContent = 'Not recorded';
  }

  const storage = location.observations.find(
    (item) => item.metric === 'storage_percent_full_supply',
  );
  if (storage) {
    const readableDate = formatReportDate(storage.sourceDate);
    const reportAgeDays = Math.max(
      0,
      Math.floor(
        (Date.now() - new Date(`${storage.sourceDate}T00:00:00+02:00`).getTime()) / 86_400_000,
      ),
    );
    const freshnessLabel =
      reportAgeDays <= 10
        ? 'recent weekly report'
        : reportAgeDays <= 17
          ? 'delayed weekly report'
          : 'stale weekly report';
    document.querySelector('#factCheckedAt').textContent = formatReportDate(
      storage.capturedAt.slice(0, 10),
    );
    const freshness = storage.latestAvailable ? ' (latest available in report)' : '';
    document.querySelector('#factLevel').textContent =
      `${storage.value}${storage.unit} \u00b7 ${readableDate} · ${reportAgeDays} days old · ${freshnessLabel}${freshness}`;

    const note = document.querySelector('#storageSourceNote');
    const sourceLink = (source, label) => {
      const link = document.createElement('a');
      link.href = source?.url ?? '#';
      link.target = '_blank';
      link.rel = 'noreferrer';
      link.textContent = label;
      return link;
    };
    const dwsSource = catalogSources.get(storage.sourceId);
    const secondarySource = storage.capturedFromSourceId
      ? catalogSources.get(storage.capturedFromSourceId)
      : null;
    note.replaceChildren(
      document.createTextNode('This weekly value comes from the '),
      sourceLink(dwsSource, 'DWS report'),
      ...(secondarySource
        ? [
            document.createTextNode(' and was transcribed from a '),
            sourceLink(secondarySource, 'secondary summary'),
          ]
        : []),
      document.createTextNode(
        `. It is not a live sensor reading${storage.latestAvailable ? '; DWS marks it as the latest available data' : ''}. Percentages may exceed 100% of full supply.`,
      ),
    );
  } else {
    document.querySelector('#factLevel').textContent = 'No storage report recorded';
    document.querySelector('#factCheckedAt').textContent = 'Not recorded';
    document.querySelector('#storageSourceNote').textContent =
      'No storage reading is currently recorded for this location.';
  }

  const speciesList = document.querySelector('#speciesList');
  speciesList.replaceChildren();
  document.querySelector('#speciesSourceLink').hidden = location.species.length === 0;
  if (location.species.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'source-footnote';
    empty.textContent = 'No sourced species records are available for this location yet.';
    speciesList.append(empty);
  }
  for (const item of location.species) {
    const card = document.createElement('article');
    card.className = 'species-card verified-species';
    const marker = document.createElement('span');
    marker.className = 'species-marker';
    marker.setAttribute('aria-hidden', 'true');
    marker.textContent = '\u2022';
    const info = document.createElement('div');
    info.className = 'species-info';
    const label = document.createElement('span');
    label.className = 'species-type green';
    label.textContent = `${item.status.replaceAll('-', ' ').toLocaleUpperCase()} · ${item.sourceDate ? `SOURCE ${formatReportDate(item.sourceDate)}` : `CHECKED ${formatReportDate(item.checkedAt.slice(0, 10))}`}`;
    const name = document.createElement('h3');
    name.textContent = item.name;
    info.append(label, name);
    card.append(marker, info);
    speciesList.append(card);
  }
}

function renderLocationCards(query = '', fitMap = false) {
  const grid = document.querySelector('#locationCards');
  const normalized = query.trim().toLocaleLowerCase();
  const province = provinceFilter.value;
  const species = speciesFilter.value;
  const matches = locationIndex.filter(
    (location) =>
      (!province || location.province === province) &&
      (!species || location.species.includes(species)) &&
      [location.name, location.province, location.river, location.type, ...location.species]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase()
        .includes(normalized),
  );
  locationMap.showLocations(
    matches.map((location) => location.id),
    fitMap && matches.length > 0,
  );
  document.querySelector('#directoryCount').textContent =
    `${matches.length} ${matches.length === 1 ? 'location' : 'locations'}`;
  grid.replaceChildren();
  if (matches.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'forum-loading';
    empty.textContent = 'No locations match these filters.';
    grid.append(empty);
    return;
  }
  for (const location of matches) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `location-card${location.id === activeLocationId ? ' selected' : ''}`;
    card.setAttribute('aria-pressed', String(location.id === activeLocationId));
    const tag = document.createElement('span');
    tag.className = 'location-card-type';
    tag.textContent = location.type.replaceAll('_', ' ');
    const name = document.createElement('strong');
    name.textContent = location.name;
    const detail = document.createElement('span');
    detail.className = 'location-card-detail';
    detail.textContent = [location.province, location.river].filter(Boolean).join(' · ');
    const photo = locationPhotos[location.id];
    const art = document.createElement('span');
    art.className = 'location-card-art';
    let thumbnail;
    const credit = document.createElement('small');
    credit.className = 'location-card-photo-credit';
    if (photo) {
      thumbnail = document.createElement('img');
      thumbnail.className = 'location-card-photo';
      thumbnail.src = photo.src;
      thumbnail.alt = photo.alt;
      thumbnail.loading = 'lazy';
      credit.textContent = `Photo: ${photo.credit} · ${photo.license}`;
      art.append(thumbnail, credit);
    } else {
      art.classList.add('location-card-art-placeholder');
      const placeholderLabel = document.createElement('span');
      placeholderLabel.className = 'location-card-placeholder-label';
      placeholderLabel.textContent = 'Verified photo coming soon';
      art.append(placeholderLabel);
    }
    const body = document.createElement('span');
    body.className = 'location-card-body';
    const coverage = document.createElement('span');
    coverage.className = 'location-card-coverage';
    coverage.textContent = `${location.factCount} sourced ${location.factCount === 1 ? 'specification' : 'specifications'} · ${location.lastCheckedAt ? `checked ${formatReportDate(location.lastCheckedAt.slice(0, 10))}` : 'details not checked'}`;
    body.append(tag, name, detail, coverage);
    card.append(art, body);
    card.addEventListener('click', () => selectLocation(location.id));
    grid.append(card);
  }
}

async function initialise() {
  try {
    const response = await fetch('/api/locations');
    if (!response.ok) throw new Error(`Location directory returned ${response.status}`);
    const result = await response.json();
    locationIndex = (result.locations ?? []).map((location) => ({
      ...location,
      species: Array.isArray(location.species) ? location.species : [],
    }));
    const provinces = [
      ...new Set(locationIndex.map((item) => item.province).filter(Boolean)),
    ].sort();
    for (const province of provinces) {
      const option = document.createElement('option');
      option.value = province;
      option.textContent = province;
      provinceFilter.append(option);
    }
    const speciesNames = [...new Set(locationIndex.flatMap((location) => location.species))].sort(
      (left, right) => left.localeCompare(right, 'en-ZA'),
    );
    for (const speciesName of speciesNames) {
      const option = document.createElement('option');
      option.value = speciesName;
      option.textContent = speciesName;
      speciesFilter.append(option);
    }
    locationMap.setLocations(locationIndex);
    renderLocationCards(search.value);
    if (locationIndex.length === 0) throw new Error('No published fishing locations are available');
    const params = new URLSearchParams(location.search);
    const query = params.get('q');
    if (query) {
      search.value = query;
      renderLocationCards(query);
    }
    const requestedId = params.get('location') || document.body.dataset.locationId;
    const selected =
      locationIndex.find((item) => item.id === requestedId) ??
      locationIndex.find((item) => item.id === 'hartbeespoort-dam') ??
      locationIndex[0];
    await selectLocation(selected.id, false);
  } catch (error) {
    console.error('Could not load location directory:', error);
    document.querySelector('#directoryCount').textContent = 'Locations unavailable';
    document.querySelector('#locationCards').textContent =
      'Location data is temporarily unavailable.';
    document.querySelector('#weatherUpdated').textContent = 'Location data unavailable';
    document.querySelector('#currentWeather').textContent = 'Location data unavailable';
    return;
  }
}

async function selectLocation(locationId, updateUrl = true) {
  try {
    const response = await fetch(`/api/locations/${encodeURIComponent(locationId)}`);
    if (!response.ok) throw new Error(`Location API returned ${response.status}`);
    const result = await response.json();
    if (!result.location) throw new Error('Location is not available in the catalogue');
    activeLocationId = locationId;
    renderLocationCards(search.value);
    renderCatalog(result.location);
    locationMap.select(locationId, updateUrl);
    const saveButton = document.querySelector('.save-button');
    saveButton.classList.toggle('saved', savedLocationIds.has(locationId));
    saveButton.setAttribute(
      'aria-label',
      savedLocationIds.has(locationId)
        ? `Remove ${result.location.name} from saved locations`
        : `Save ${result.location.name}`,
    );
    if (updateUrl) {
      const url = new URL(window.location.href);
      url.pathname = `/explore/locations/${encodeURIComponent(locationId)}/`;
      url.searchParams.delete('location');
      url.searchParams.delete('q');
      url.hash = '';
      window.history.replaceState({}, '', url);
      document
        .querySelector('#featureTitle')
        .scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    const user = await community.load();
    if (user?.emailVerified) await syncSavedLocations(locationId);
    try {
      await loadWeather(result.location.coordinates);
    } catch (error) {
      console.error('Could not load weather forecast:', error);
      document.querySelector('#currentWeather').textContent = 'Forecast unavailable';
      document.querySelector('#weatherUpdated').textContent = 'Weather data unavailable';
      document.querySelector('#fishingWindows').textContent =
        'Sunrise and sunset times unavailable.';
      document.querySelector('#hourlyForecast').textContent =
        'Forecast unavailable. Try again later.';
    }
  } catch (error) {
    console.error('Could not load selected location:', error);
    showToast('That location could not be loaded');
  }
}

window.setInterval(
  () => {
    if (!document.hidden && activeLocation?.coordinates) {
      loadWeather(activeLocation.coordinates).catch((error) =>
        console.error('Weather refresh failed:', error),
      );
    }
  },
  15 * 60 * 1000,
);

document.querySelector('.save-button').addEventListener('click', (event) => {
  const button = event.currentTarget;
  const name = activeLocation?.name ?? 'Location';
  if (!activeLocationId) return;
  const saved = savedLocationIds.has(activeLocationId);
  if (saved) savedLocationIds.delete(activeLocationId);
  else savedLocationIds.add(activeLocationId);
  try {
    localStorage.setItem('stillwater-saved-locations', JSON.stringify([...savedLocationIds]));
  } catch {
    /* Session state still updates. */
  }
  if (community.user?.emailVerified) {
    community
      .request('auth/saved-locations', {
        method: saved ? 'DELETE' : 'POST',
        body: JSON.stringify({ locationId: activeLocationId }),
      })
      .catch((error) => showToast(error.message));
  }
  button.classList.toggle('saved', !saved);
  button.setAttribute(
    'aria-label',
    !saved ? `Remove ${name} from saved locations` : `Save ${name}`,
  );
  showToast(!saved ? `${name} saved to your waters` : `Removed ${name} from your saved waters`);
});

document.querySelector('#locationButton').addEventListener('click', () => {
  document.querySelector('#directory').scrollIntoView({ behavior: 'smooth' });
  search.focus();
});
search.addEventListener('input', () => renderLocationCards(search.value));
provinceFilter.addEventListener('change', () => renderLocationCards(search.value, true));
speciesFilter.addEventListener('change', () => renderLocationCards(search.value, true));
search.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    const normalized = search.value.trim().toLocaleLowerCase();
    const match = locationIndex.find((item) =>
      [item.name, item.province, item.river, item.type]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase()
        .includes(normalized),
    );
    if (match) selectLocation(match.id);
  }
});
document.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    search.focus();
  }
});
document.querySelectorAll('.main-nav a, .mobile-nav a').forEach((link) =>
  link.addEventListener('click', () => {
    document
      .querySelectorAll('.main-nav a')
      .forEach((item) =>
        item.classList.toggle('active', item.getAttribute('href') === link.getAttribute('href')),
      );
    document
      .querySelectorAll('.mobile-nav a')
      .forEach((item) =>
        item.classList.toggle(
          'mobile-active',
          item.getAttribute('href') === link.getAttribute('href'),
        ),
      );
  }),
);

initialise();
