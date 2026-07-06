const CACHE_NAME = 'lendtrack-v1';
const ASSETS = [
  './index.html',
  './manifest.json',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (e) => {
  // Bypasses static caching for any Google Sheets Apps Script API requests
  if (e.request.method !== 'GET' || e.request.url.includes('script.google.com')) {
    return;
  }
  e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      return cachedResponse || fetch(e.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && e.request.url.startsWith(self.location.origin)) {
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, networkResponse.clone()));
        }
        return networkResponse;
      }).catch(() => {
        // Ignore fetch errors during offline periods
      });
    })
  );
});
