/* Salve este arquivo como: sw.js */

const CACHE_NAME = 'vesto-cache-v1';

// Todos os arquivos que compõem o "esqueleto" do seu app
// SEPARAMOS OS ARQUIVOS LOCAIS DOS CDNS
const APP_SHELL_FILES_LOCAL = [
  '/',
  'index.html', 
  'manifest.json', 
  'icons/icon-192x192.png', 
  'icons/icon-512x512.png'  
];

const APP_SHELL_FILES_CDN = [
  'https://cdn.tailwindcss.com',
  'https://cdn.jsdelivr.net/npm/chart.js@3.9.1/dist/chart.min.js'
];


// Evento de Instalação: Armazena o App Shell no cache
self.addEventListener('install', event => {
  console.log('[SW] Instalando...');
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Armazenando App Shell no cache');

        // 1. Armazena os arquivos de CDN com 'no-cors'
        const cdnCachePromise = Promise.all(
          APP_SHELL_FILES_CDN.map(url => {
            // Cria uma Request com 'no-cors'
            const request = new Request(url, { mode: 'no-cors' });
            
            // Busca e armazena a resposta opaca
            return fetch(request)
              .then(response => cache.put(request, response))
              .catch(err => {
                console.warn(`[SW] Falha ao armazenar CDN: ${url}`, err);
              });
          })
        );

        // 2. Armazena os arquivos locais
        const localCachePromise = cache.addAll(APP_SHELL_FILES_LOCAL);

        // 3. Espera ambas as promessas terminarem
        return Promise.all([cdnCachePromise, localCachePromise]);
      })
      // REMOVEMOS O self.skipWaiting() DAQUI!
      // Agora ele vai "esperar" (waiting) após instalar.
  );
});

// Evento de Ativação: Limpa caches antigos
self.addEventListener('activate', event => {
  console.log('[SW] Ativando...');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME) // Limpa caches que NÃO são o atual
          .map(name => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

// Evento de Fetch: Intercepta as requisições
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 1. Ignorar chamadas de API para o nosso BFF
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // 2. Estratégia Stale-While-Revalidate para o App Shell
  event.respondWith(
    caches.open(CACHE_NAME).then(cache => {
      return cache.match(event.request).then(cachedResponse => {
        const fetchPromise = fetch(event.request).then(networkResponse => {
          cache.put(event.request, networkResponse.clone());
          return networkResponse;
        });
        return cachedResponse || fetchPromise;
      });
    })
  );
});

// ==========================================================
// ADIÇÃO CRÍTICA: Ouvinte de Mensagem
// ==========================================================
// Ouve a mensagem do 'index.html' para pular a espera
self.addEventListener('message', (event) => {
  if (event.data && event.data.action === 'SKIP_WAITING') {
    console.log('[SW] Recebeu ordem para SKIP_WAITING');
    self.skipWaiting();
  }
});
