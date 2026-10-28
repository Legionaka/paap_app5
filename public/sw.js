const STATIC_CACHE = 'stillwater-static-v3';
const DATA_CACHE = 'stillwater-public-data-v1';
const CORE_ASSETS = [
  '/',
  '/explore/',
  '/offline.html',
  '/site.webmanifest',
  '/icons/icon.svg',
  '/css/tokens.css',
  '/css/site.css',
  '/css/styles.css',
  '/js/pwa.js',
  '/js/landing.js',
  '/js/app.js',
  '/js/community.js',
  '/js/location-map.js',
  '/js/location-photos.js',
  '/js/weather.js',
  '/vendor/leaflet/leaflet.css',
  '/vendor/leaflet/leaflet.js',
  '/images/locations/hartbeespoort-dam.webp',
  '/images/locations/roodekopjes-dam.webp',
  '/images/locations/greater-brandvlei-dam.webp',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) => key.startsWith('stillwater-') && ![STATIC_CACHE, DATA_CACHE].includes(key),
            )
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function isPublicGuidePage(url) {
  return (
    url.pathname === '/' ||
    url.pathname === '/explore/' ||
    /^\/explore\/locations\/[a-z0-9-]+\/$/.test(url.pathname)
  );
}

function isPublicLocationApi(url) {
  return /^\/api\/locations(?:\/[a-z0-9-]+)?$/.test(url.pathname);
}

function isStaticAsset(url) {
  return (
    ['/css/', '/js/', '/images/', '/icons/', '/vendor/'].some((prefix) =>
      url.pathname.startsWith(prefix),
    ) || url.pathname === '/site.webmanifest'
  );
}

async function updateCachedResponse(cache, request) {
  const response = await fetch(request);
  if (response.ok && response.type === 'basic') await cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate' && isPublicGuidePage(url)) {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          if (response.ok) {
            const cache = await caches.open(STATIC_CACHE);
            await cache.put(request, response.clone());
          }
          return response;
        })
        .catch(
          async () =>
            (await caches.match(request)) ||
            (await caches.match('/explore/')) ||
            (await caches.match('/offline.html')),
        ),
    );
    return;
  }

  if (isPublicLocationApi(url)) {
    const update = caches
      .open(DATA_CACHE)
      .then((cache) => updateCachedResponse(cache, request))
      .catch(() => null);
    event.waitUntil(update);
    event.respondWith(
      caches.open(DATA_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        return (
          (await update) ||
          new Response('{"error":"Offline and no saved location data is available"}', {
            status: 503,
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
          })
        );
      }),
    );
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then(async (response) => {
          if (response.ok && response.type === 'basic') {
            const cache = await caches.open(STATIC_CACHE);
            await cache.put(request, response.clone());
          }
          return response;
        });
      }),
    );
  }
});
