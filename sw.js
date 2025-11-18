// sw.js (v4 - Cache Otimizado + Correção de Clone)

const CACHE_NAME = 'vesto-cache-v4'; // Versão atualizada

// Arquivos que são o "shell" do app e mudam com frequência (Network-First)
const APP_SHELL_FILES_NETWORK_FIRST = [
  '/',
  'logo-vesto.png', 
  'index.html',
  'app.js',
  'supabase.js',
  'style.css'
];

// Arquivos que raramente mudam (Cache-First)
const APP_SHELL_FILES_CACHE_FIRST = [
  'manifest.json',
  'icons/icon-192x192.png',
  'icons/icon-512x512.png',
  'https://cdn.tailwindcss.com',
  'https://cdn.jsdelivr.net/npm/chart.js@3.9.1/dist/chart.min.js'
];

self.addEventListener('install', event => {
  console.log('[SW] Instalando v4...');

  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Armazenando App Shell (Cache-First) no cache');

        // Cache dos arquivos de CDN (no-cors)
        const cdnCachePromise = APP_SHELL_FILES_CACHE_FIRST.filter(url => url.startsWith('http'))
          .map(url => {
            const request = new Request(url, { mode: 'no-cors' });
            return fetch(request)
              .then(response => cache.put(request, response))
              .catch(err => console.warn(`[SW] Falha ao armazenar CDN: ${url}`, err));
          });

        // Cache dos arquivos locais (ícones, manifest)
        const localCachePromise = cache.addAll(
          APP_SHELL_FILES_CACHE_FIRST.filter(url => !url.startsWith('http'))
        );

        return Promise.all([...cdnCachePromise, localCachePromise]);
      })
      .then(() => caches.open(CACHE_NAME))
      .then(cache => cache.addAll(APP_SHELL_FILES_NETWORK_FIRST))
      .catch(err => console.error("[SW] Falha ao armazenar App Shell (Network-First)", err))
  );
});

self.addEventListener('activate', event => {
  console.log('[SW] Ativando v4...');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME) // Deleta caches antigos
          .map(name => {
            console.log('[SW] Deletando cache antigo:', name);
            return caches.delete(name);
          })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 1. Ignora API (sempre rede)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // 2. Ignora requisições não-GET
  if (event.request.method !== 'GET') {
    event.respondWith(fetch(event.request));
    return;
  }

  // 3. Estratégia "Network-First" para o App Shell principal
  if (APP_SHELL_FILES_NETWORK_FIRST.includes(url.pathname)) {
    event.respondWith(
      fetch(event.request)
        .then(networkResponse => {
          if (networkResponse.ok) {
            const responseClone = networkResponse.clone(); // Correção aplicada
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(err => {
          console.log(`[SW] Rede falhou para ${url.pathname}, tentando cache...`);
          return caches.match(event.request)
            .then(cachedResponse => {
              if (cachedResponse) return cachedResponse;
              console.error(`[SW] Falha crítica: Sem rede e sem cache para ${url.pathname}`);
              return new Response('Offline.', { status: 503 });
            });
        })
    );
    return;
  }

  // 4. Estratégia "Cache-First" para o resto
  event.respondWith(
    caches.match(event.request)
      .then(cachedResponse => {
        if (cachedResponse) return cachedResponse;
        return fetch(event.request).then(networkResponse => {
          if (networkResponse.ok) {
            const responseClone = networkResponse.clone(); // Correção aplicada
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
