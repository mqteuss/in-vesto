// sw.js (Atualizado para v6 - Força atualização de CSS da Navbar)

const CACHE_NAME = 'vesto-cache-v6'; // MUDANÇA: v5 -> v6

// Arquivos que são o "shell" do app e mudam com frequência
const APP_SHELL_FILES_NETWORK_FIRST = [
  '/',
  'logo-vesto.png', 
  'index.html',
  'app.js',
  'supabase.js',
  'style.css'
];

// Arquivos que raramente mudam (ícones, CDNs, etc)
const APP_SHELL_FILES_CACHE_FIRST = [
  'manifest.json',
  'icons/icon-192x192.png',
  'icons/icon-512x512.png',
  'https://cdn.tailwindcss.com',
'https://cdn.jsdelivr.net/npm/chart.js@3.9.1/dist/chart.min.js',
'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
];

self.addEventListener('install', event => {
  console.log('[SW] Instalando v6...'); 
  self.skipWaiting(); // Força a ativação imediata do novo SW

  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        // Cache dos arquivos de CDN (no-cors)
        const cdnCachePromise = APP_SHELL_FILES_CACHE_FIRST.filter(url => url.startsWith('http'))
          .map(url => {
            const request = new Request(url, { mode: 'no-cors' });
            return fetch(request)
              .then(response => cache.put(request, response))
              .catch(err => console.warn(`[SW] Falha ao armazenar CDN: ${url}`, err));
          });

        // Cache dos arquivos locais
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
  console.log('[SW] Ativando v6...');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME) // Limpa caches antigos
          .map(name => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 1. IGNORAR API E SUPABASE (Sempre Rede)
  if (url.pathname.startsWith('/api/') || url.hostname.includes('supabase.co')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // 2. Ignora requisições não-GET
  if (event.request.method !== 'GET') {
    event.respondWith(fetch(event.request));
    return;
  }

  // 3. Estratégia "Network-First" para o App Shell
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

  // 4. Estratégia "Cache-First" para estáticos
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
