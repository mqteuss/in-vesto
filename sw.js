/* Salve este arquivo como: sw.js */

const CACHE_NAME = 'vesto-cache-v1';

// Todos os arquivos que compõem o "esqueleto" do seu app
const APP_SHELL_FILES = [
  '/',
  'index.html', 
  'manifest.json', 
  'https://cdn.tailwindcss.com',
  'https://cdn.jsdelivr.net/npm/chart.js@3.9.1/dist/chart.min.js',
  'icons/icon-192x192.png', 
  'icons/icon-512x512.png'  
];

// Evento de Instalação: Armazena o App Shell no cache
self.addEventListener('install', event => {
  console.log('[SW] Instalando...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Armazenando App Shell no cache');
        return cache.addAll(APP_SHELL_FILES);
      })
      .then(() => self.skipWaiting())
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

  // ===================================================================
  // ALTERAÇÃO CRÍTICA
  // 1. Ignorar chamadas de API para o nosso BFF (deixar ir direto para a rede)
  // Nós checamos se o *caminho* da URL começa com /api/
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(event.request));
    return;
  }
  // ===================================================================

  // 2. Estratégia Stale-While-Revalidate para o App Shell
  // (Responde rápido com o cache, mas busca atualização em segundo plano)
  event.respondWith(
    caches.open(CACHE_NAME).then(cache => {
      return cache.match(event.request).then(cachedResponse => {
        
        // Busca a versão mais nova da rede em segundo plano
        const fetchPromise = fetch(event.request).then(networkResponse => {
          // Se a busca for bem-sucedida, atualiza o cache
          cache.put(event.request, networkResponse.clone());
          return networkResponse;
        });

        // Retorna o cache primeiro (se existir) ou espera a rede
        return cachedResponse || fetchPromise;
      });
    })
  );
});