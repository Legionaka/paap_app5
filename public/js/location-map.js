function mapPin(selected = false) {
  return window.L.divIcon({
    className: 'map-pin-wrapper',
    html: `<span class="map-pin${selected ? ' is-selected' : ''}" aria-hidden="true"></span>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

export function createLocationMap(onSelect) {
  const element = document.querySelector('#locationMap');
  const panel = element.closest('.map-panel');
  if (!window.L) {
    element.textContent = 'The map could not load. Use the location list to explore waters.';
    return { setLocations() {}, showLocations() {}, select() {} };
  }

  const map = window.L.map(element, {
    maxBounds: window.L.latLngBounds([-35.5, 15.5], [-21, 33.5]),
    maxBoundsViscosity: 0.7,
    scrollWheelZoom: false,
    zoomControl: false,
  });
  window.L.control.zoom({ position: 'bottomright' }).addTo(map);
  window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
  }).addTo(map);
  const markers = new Map();
  let selectedId = null;

  function createMarker(location) {
    const latitude = Number(location.latitude);
    const longitude = Number(location.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
    const marker = window.L.marker([latitude, longitude], {
      alt: `${location.name}, approximate location`,
      icon: mapPin(location.id === selectedId),
      title: `${location.name} · approximate coordinates`,
      riseOnHover: true,
    }).addTo(map);
    const button = document.createElement('button');
    button.className = 'map-popup-button';
    button.type = 'button';
    button.textContent = `View ${location.name}`;
    button.addEventListener('click', () => onSelect(location.id));
    const popup = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = location.name;
    const region = document.createElement('span');
    region.textContent = `${location.province} · approximate position`;
    popup.append(title, region, button);
    marker.bindPopup(popup);
    marker.on('click', () => onSelect(location.id));
    markers.set(location.id, marker);
  }

  function setLocations(locations) {
    for (const location of locations) {
      if (!markers.has(location.id)) createMarker(location);
    }
    const valid = locations
      .filter((location) => markers.has(location.id))
      .map((location) => markers.get(location.id));
    if (valid.length > 1) {
      map.fitBounds(window.L.featureGroup(valid).getBounds().pad(0.1), { maxZoom: 8 });
    } else if (valid.length === 1) {
      map.setView(valid[0].getLatLng(), 8);
    } else {
      map.setView([-29, 25], 5);
    }
    requestAnimationFrame(() => map.invalidateSize());
  }

  function showLocations(locationIds, fit = false) {
    const visible = new Set(locationIds);
    for (const [id, marker] of markers) {
      if (visible.has(id)) marker.addTo(map);
      else map.removeLayer(marker);
    }
    if (fit && visible.size > 0) {
      const visibleMarkers = [...visible].map((id) => markers.get(id)).filter(Boolean);
      if (visibleMarkers.length > 1) {
        map.fitBounds(window.L.featureGroup(visibleMarkers).getBounds().pad(0.1), { maxZoom: 8 });
      } else if (visibleMarkers.length === 1) {
        map.setView(visibleMarkers[0].getLatLng(), 8);
      }
    }
  }

  function select(locationId, focus = false) {
    const location = markers.get(locationId);
    if (!location) return;
    if (selectedId && markers.has(selectedId)) markers.get(selectedId).setIcon(mapPin(false));
    selectedId = locationId;
    location.setIcon(mapPin(true));
    if (focus) {
      map.setView(location.getLatLng(), Math.max(map.getZoom(), 8));
      location.openPopup();
    }
  }

  map.setView([-29, 25], 5);
  panel.dataset.mapReady = 'true';
  return { setLocations, showLocations, select };
}
