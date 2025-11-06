/* ==========================================================
 * VESTO SERVICE WORKER (sw.js)
 * ========================================================== */

// Versão do Cache. Altere este nome para 'vesto-cache-v2', 'v3', etc.
// sempre que você fizer alterações nos arquivos do APP_SHELL.
const CACHE_NAME = 'vesto-cache-v1';

// 1. Arquivos locais do "App Shell" - O esqueleto do app
const APP_SHELL_FILES_LOCAL = [
  '/', // Acessa a raiz
  'index.html', // O arquivo HTML principal
  'manifest.json', // O manifesto do PWA
  'icons/icon-192x192.png', // Ícones do PWA
  'icons/icon-512x512.png'  // Ícones do PWA
];

// 2. Arquivos de CDN - Precisam de tratamento especial "no-cors"
const APP_SHELL_FILES_CDN = [
  'https://cdn.tailwindcss.com', //
  'https://cdn.jsdelivr.net/npm/chart.js@3.9.1/dist/chart.min.js', //
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap' //
];

// ==========================================================
// EVENTO: install
// Armazena o App Shell no cache.
// ==========================================================
self.addEventListener('install', event => {
  console.log('[SW] Instalando...');
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Armazenando App Shell no cache');

        // 1. Armazena os arquivos de CDN (requer 'no-cors' para evitar erro)
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

        // 2. Armazena os arquivos locais
        const localCachePromise = cache.addAll(APP_SHELL_FILES_LOCAL);

        // Espera ambas as promessas terminarem
        return Promise.all([cdnCachePromise, localCachePromise]);
      })
      // IMPORTANTE: Não chamamos self.skipWaiting() aqui.
      // Deixamos o SW "esperando" (waiting) para que o index.html
      // possa mostrar o botão "Atualizar"
  );
});

// ==========================================================
// EVENTO: activate
// Limpa caches antigos e toma controle da página.
// ==========================================================
self.addEventListener('activate', event => {
  console.log('[SW] Ativando...');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME) // Filtra caches que NÃO são o atual
          .map(name => caches.delete(name)) // Deleta os antigos
      );
    }).then(() => self.clients.claim()) // Toma controle das páginas abertas
  );
});

// ==========================================================
// EVENTO: fetch
// Intercepta requisições de rede.
// ==========================================================
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // --- Regra 1: Ignorar chamadas de API (sempre ir para a rede) ---
  // As chamadas para /api/brapi e /api/gemini
  // nunca devem ser cacheadas pelo Service Worker.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // --- Regra 2: Ignorar requisições que NÃO SEJAM 'GET' ---
  // Isso previne o erro "Request method 'POST' is unsupported"
  // que acontece nas chamadas para o Gemini
  if (event.request.method !== 'GET') {
    event.respondWith(fetch(event.request));
    return;
  }

  // --- Regra 3: Para todas as outras requisições GET ---
  // Usar a estratégia "Stale-While-Revalidate"
  // 1. Responde com o cache (rápido)
  // 2. Em paralelo, busca na rede e atualiza o cache (fresco)
  event.respondWith(
    caches.open(CACHE_NAME).then(cache => {
      return cache.match(event.request).then(cachedResponse => {
        
        // Busca na rede em paralelo
        const fetchPromise = fetch(event.request).then(networkResponse => {
          // Se a resposta da rede for válida, atualiza o cache
          if (networkResponse && networkResponse.status === 200) {
            cache.put(event.request, networkResponse.clone());
          }
          return networkResponse;
        });

        // Retorna o cache imediatamente (se existir),
        // senão, espera a rede.
        return cachedResponse || fetchPromise;
      });
    })
  );
});

// ==========================================================
// EVENTO: message
// Ouve a mensagem do 'index.html' para pular a espera.
// ==========================================================
self.addEventListener('message', (event) => {
  // Verifica a mensagem enviada pelo botão "Atualizar" no index.html
  if (event.data && event.data.action === 'SKIP_WAITING') {
    console.log('[SW] Recebeu ordem para SKIP_WAITING');
    self.skipWaiting(); // Ativa o novo SW
  }
});
