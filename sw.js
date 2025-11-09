/* ==========================================================
 * VESTO SERVICE WORKER (sw.js)
 * ========================================================== */

const CACHE_NAME = 'vesto-cache-v1';

const APP_SHELL_FILES_LOCAL = [
  '/', 
  'index.html', 
  'style.css',
  'app.js',
  'manifest.json', 
  'icons/icon-192x192.png', 
  'icons/icon-512x512.png'  
];

const APP_SHELL_FILES_CDN = [
  'https://cdn.tailwindcss.com',
  'https://cdn.jsdelivr.net/npm/chart.js@3.9.1/dist/chart.min.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap'
];

self.addEventListener('install', event => {
  console.log('[SW] Instalando...');
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Armazenando App Shell no cache');

        const cdnCachePromise = Promise.all(
          APP_SHELL_FILES_CDN.map(url => {
            const request = new Request(url, { mode: 'no-cors' });
            return fetch(request)
              .then(response => cache.put(request, response))
              .catch(err => {
                console.warn(`[SW] Falha ao armazenar CDN: ${url}`, err);
              });
          })
        );

        const localCachePromise = cache.addAll(APP_SHELL_FILES_LOCAL);

        return Promise.all([cdnCachePromise, localCachePromise]);
      })
  );
});

self.addEventListener('activate', event => {
  console.log('[SW] Ativando...');
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

  // 1. API calls go directly to network
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // 2. Non-GET requests go directly to network
  if (event.request.method !== 'GET') {
    event.respondWith(fetch(event.request));
    return;
  }

  // 3. Check if it's a main app file
  const appShellPaths = [
    '/',
    '/index.html',
    '/style.css',
    '/app.js',
    '/manifest.json'
  ];

  const isAppShellRequest = appShellPaths.includes(url.pathname) && url.origin === self.location.origin;

  if (isAppShellRequest) {
    // *** Otimização 3: Network-First for App Shell ***
    event.respondWith(
        fetch(event.request)
            .then(networkResponse => {
                // OK, update cache
                if (networkResponse && networkResponse.status === 200) {
                    caches.open(CACHE_NAME).then(cache => {
                        cache.put(event.request, networkResponse.clone());
                    });
                }
                return networkResponse;
            })
            .catch(err => {
                // Network failed, get from cache (Offline mode)
                console.log(`[SW] Network failed for ${url.pathname}, serving from cache.`);
                return caches.match(event.request);
            })
    );
  } else {
    // Cache-First (Stale-While-Revalidate) for all other assets (CDNs, fonts, icons)
    event.respondWith(
        caches.open(CACHE_NAME).then(cache => {
            return cache.match(event.request).then(cachedResponse => {
                
                const fetchPromise = fetch(event.request).then(networkResponse => {
                    if (networkResponse && networkResponse.status === 200) {
                        cache.put(event.request, networkResponse.clone());
                    }
                    return networkResponse;
                });

                // Return cache if it exists, otherwise wait for network
                return cachedResponse || fetchPromise;
            });
        })
    );
  }
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.action === 'SKIP_WAITING') {
    console.log('[SW] Recebeu ordem para SKIP_WAITING');
    self.skipWaiting(); 
  }
});
