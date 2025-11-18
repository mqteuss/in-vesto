// sw.js (Corrigido)

const CACHE_NAME = 'vesto-cache-v3'; // Atualizei para v3 para garantir a troca

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
  'https://cdn.jsdelivr.net/npm/chart.js@3.9.1/dist/chart.min.js'
];

self.addEventListener('install', event => {
  console.log('[SW] Instalando v3...');
  self.skipWaiting(); // Força a ativação imediata para testes

  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        // Cache CDN (no-cors)
        const cdnCachePromise = APP_SHELL_FILES_CACHE_FIRST.filter(url => url.startsWith('http'))
          .map(url => {
            const request = new Request(url, { mode: 'no-cors' });
            return fetch(request)
              .then(response => cache.put(request, response))
              .catch(err => console.warn(`[SW] Falha CDN: ${url}`, err));
          });

        // Cache Local
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
  console.log('[SW] Ativando v3...');
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

  if (url.pathname.startsWith('/api/') || event.request.method !== 'GET') {
    event.respondWith(fetch(event.request));
    return;
  }

  // === CORREÇÃO AQUI (Estratégia Network-First) ===
  if (APP_SHELL_FILES_NETWORK_FIRST.includes(url.pathname)) {
    event.respondWith(
      fetch(event.request)
        .then(networkResponse => {
          if (networkResponse.ok) {
            // 1. Clona IMEDIATAMENTE, antes de qualquer promessa
            const responseToCache = networkResponse.clone();
            
            caches.open(CACHE_NAME).then(cache => {
              // 2. Usa o clone aqui dentro
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          return caches.match(event.request);
        })
    );
    return;
  }

  // === CORREÇÃO AQUI (Estratégia Cache-First) ===
  event.respondWith(
    caches.match(event.request)
      .then(cachedResponse => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(event.request).then(networkResponse => {
          if (networkResponse.ok) {
            // 1. Clona IMEDIATAMENTE
            const responseToCache = networkResponse.clone();

            caches.open(CACHE_NAME).then(cache => {
              // 2. Usa o clone aqui dentro
              cache.put(event.request, responseToCache);
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
