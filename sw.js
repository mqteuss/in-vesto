const CACHE_NAME = 'vesto-cache-v9'; // Atualizei para v9 para forçar a renovação

// Arquivos vitais que tentam a REDE primeiro (para garantir atualização)
// IMPORTANTE: Todos devem começar com '/' para bater com url.pathname
const APP_SHELL_FILES_NETWORK_FIRST = [
  '/',
  '/index.html',
  '/app.js',
  '/supabase.js',
  '/style.css'
];

// Arquivos estáticos ou externos que preferem o CACHE (carregamento rápido)
const APP_SHELL_FILES_CACHE_FIRST = [
  '/manifest.json',
  '/logo-vesto.png',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  'https://cdn.tailwindcss.com',
  'https://cdn.jsdelivr.net/npm/chart.js@3.9.1/dist/chart.min.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // Tenta cachear arquivos da CDN (modo no-cors para evitar erros opacos)
      const cdnPromise = Promise.all(
        APP_SHELL_FILES_CACHE_FIRST.filter(url => url.startsWith('http')).map(url => {
            const request = new Request(url, { mode: 'no-cors' });
            return fetch(request).then(response => cache.put(request, response)).catch(() => {});
        })
      );

      // Cacheia arquivos locais estáticos
      const localPromise = cache.addAll(
        APP_SHELL_FILES_CACHE_FIRST.filter(url => !url.startsWith('http'))
      );

      return Promise.all([cdnPromise, localPromise]);
    }).then(() => caches.open(CACHE_NAME)).then(cache => {
        // Cacheia os arquivos vitais inicialmente
        return cache.addAll(APP_SHELL_FILES_NETWORK_FIRST);
    })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => Promise.all(
      cacheNames.filter(name => name !== CACHE_NAME).map(name => caches.delete(name))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Ignora requests que não sejam HTTP/HTTPS (ex: chrome-extension://)
  if (!url.protocol.startsWith('http')) return;

  // Ignora chamadas de API e Supabase (sempre online)
  if (url.pathname.startsWith('/api/') || url.hostname.includes('supabase.co')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Apenas GET é cacheado
  if (event.request.method !== 'GET') {
    event.respondWith(fetch(event.request));
    return;
  }

  // Estratégia Network First para arquivos vitais
  // A comparação agora funcionará corretamente por causa das barras '/'
  if (APP_SHELL_FILES_NETWORK_FIRST.includes(url.pathname)) {
    event.respondWith(
      fetch(event.request)
        .then(networkResponse => {
          if (networkResponse.ok) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseClone));
          }
          return networkResponse;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Estratégia Cache First para estáticos
  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      if (cachedResponse) return cachedResponse;
      return fetch(event.request).then(networkResponse => {
        if (networkResponse.ok) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseClone));
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
