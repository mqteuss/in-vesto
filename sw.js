/* Salve este arquivo como: sw.js */

const CACHE_NAME = 'vesto-cache-v1';

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

// ==========================================================
// INÍCIO: OUVINTE DE FETCH (CORRIGIDO)
// ==========================================================
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 1. Ignorar chamadas de API (que nunca devem ser cacheadas pelo SW)
  // Elas sempre devem ir direto para a rede.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // 2. Ignorar todas as requisições que NÃO SEJAM 'GET'
  // Isso previne o erro de 'POST' no cache.put()
  if (event.request.method !== 'GET') {
    // Apenas busca na rede e não tenta armazenar em cache
    event.respondWith(fetch(event.request));
    return;
  }

  // 3. Se for GET e não for /api/, usa Stale-While-Revalidate
  // (Busca no cache; se não achar, busca na rede e atualiza o cache)
  event.respondWith(
    caches.open(CACHE_NAME).then(cache => {
      return cache.match(event.request).then(cachedResponse => {
        
        const fetchPromise = fetch(event.request).then(networkResponse => {
          // Garante que só armazene respostas válidas
          if (networkResponse && networkResponse.status === 200) {
            cache.put(event.request, networkResponse.clone());
          }
          return networkResponse;
        });

        // Retorna o cache se existir, senão, espera a rede
        return cachedResponse || fetchPromise;
      });
    })
  );
});
// ==========================================================
// FIM: OUVINTE DE FETCH (CORRIGIDO)
// ==========================================================


// ==========================================================
// OUVINTE DE MENSAGEM (para o botão "Atualizar")
// ==========================================================
self.addEventListener('message', (event) => {
  if (event.data && event.data.action === 'SKIP_WAITING') {
    console.log('[SW] Recebeu ordem para SKIP_WAITING');
    self.skipWaiting();
  }
});
