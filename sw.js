const CACHE_NAME = 'vesto-cache-v6';

const APP_SHELL_FILES_NETWORK_FIRST = [
  '/',
  'logo-vesto.png', 
  'index.html',
  'app.js',
  'supabase.js',
  'style.css'
];

const APP_SHELL_FILES_CACHE_FIRST = [
  'manifest.json',
  'icons/icon-192x192.png',
  'icons/icon-512x512.png',
  'https://cdn.tailwindcss.com',
'https://cdn.jsdelivr.net/npm/chart.js@3.9.1/dist/chart.min.js',
'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
];

self.addEventListener('install', event => {
  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        const cdnCachePromise = APP_SHELL_FILES_CACHE_FIRST.filter(url => url.startsWith('http'))
          .map(url => {
            const request = new Request(url, { mode: 'no-cors' });
            return fetch(request)
              .then(response => cache.put(request, response))
              .catch(err => console.warn(`[SW] Falha ao armazenar CDN: ${url}`, err));
          });

        const localCachePromise = cache.addAll(
          APP_SHELL_FILES_CACHE_FIRST.filter(url => !url.startsWith('http'))
        );

        return Promise.all([...cdnCachePromise, localCachePromise]);
      })
      .then(() => caches.open(CACHE_NAME))
      .then(cache => cache.addAll(APP_SHELL_FILES_NETWORK_FIRST))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME)
          .map(name => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  if (url.pathname.startsWith('/api/') || url.hostname.includes('supabase.co')) {
    event.respondWith(fetch(event.request));
    return;
  }

  if (event.request.method !== 'GET') {
    event.respondWith(fetch(event.request));
    return;
  }

  if (APP_SHELL_FILES_NETWORK_FIRST.includes(url.pathname)) {
    event.respondWith(
      fetch(event.request)
        .then(networkResponse => {
          if (networkResponse.ok) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then(cachedResponse => {
        if (cachedResponse) return cachedResponse;
        return fetch(event.request).then(networkResponse => {
          if (networkResponse.ok) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, responseClone);
            });
          }
          return networkResponse;
        });
      })
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.action === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});