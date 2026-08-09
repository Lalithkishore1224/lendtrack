const CACHE_NAME = 'lendtrack-v9';
const ASSETS = [
  './index.html',
  './manifest.json',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css',
  'https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700;800&display=swap'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    // Cache each asset individually: one failing CDN request must not
    // abort the whole install (addAll rejects wholesale on any failure).
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(ASSETS.map((asset) => cache.add(asset)))
    )
  );
});

self.addEventListener('activate', (e) => {
  // Delete old caches
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
    ))
  ).then(() => self.clients.claim());
});

self.addEventListener('fetch', (e) => {
  // Bypasses static caching for any Google Sheets Apps Script API requests
  if (e.request.method !== 'GET' || e.request.url.includes('script.google.com')) {
    return;
  }

  // Network-first for the HTML shell: always serve the latest deployed
  // app when online, so this doesn't go stale until CACHE_NAME is bumped
  // by hand. Falls back to the last cached copy only when offline.
  const isHTML = e.request.mode === 'navigate' ||
    (e.request.headers.get('accept') || '').includes('text/html');

  if (isHTML) {
    e.respondWith(
      // no-store: bypass the browser's own HTTP cache too, not just this
      // service worker's Cache Storage, so a stale HTTP-cached response
      // can't masquerade as "fresh".
      fetch(e.request, { cache: 'no-store' }).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
        }
        return networkResponse;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  // Cache-first for static assets (fonts/CSS/manifest) — safe to cache
  // since they're versioned by URL and rarely change.
  e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      return cachedResponse || fetch(e.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && e.request.url.startsWith(self.location.origin)) {
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, networkResponse.clone()));
        }
        return networkResponse;
      }).catch(() => {
        // Offline and not in cache — resolve with a real error response;
        // resolving with undefined would make respondWith() throw.
        return Response.error();
      });
    })
  );
});
