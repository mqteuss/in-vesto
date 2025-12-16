const CACHE_NAME = 'vesto-cache-v12'; // Atualizado para v12 (Força limpeza do cache antigo)

// Lista unificada de todos os arquivos que o App precisa para funcionar offline
const APP_FILES = [
  '/',
  '/index.html',
  '/app.js',
  '/supabase.js',
  '/style.css',
  '/style-tailwind.css',
  '/manifest.json',
  '/icons/carteira.png',
  '/icons/noticias.png',
  '/icons/historico.png',
  '/logo-vesto.png',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  // REMOVIDO: 'https://cdn.tailwindcss.com', (Não precisamos mais baixar 3MB!)
  'https://cdn.jsdelivr.net/npm/chart.js@3.9.1/dist/chart.min.js',
  'https://cdn.jsdelivr.net/npm/marked/marked.min.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
];

// 1. INSTALAÇÃO: Baixa e salva tudo no cache inicial
self.addEventListener('install', event => {
  self.skipWaiting(); // Força o SW a ativar imediatamente

  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // Separa arquivos externos (CDN) para tratar com no-cors
      const externalFiles = APP_FILES.filter(url => url.startsWith('http'));
      const localFiles = APP_FILES.filter(url => !url.startsWith('http'));

      const externalPromise = Promise.all(
        externalFiles.map(url => {
            const request = new Request(url, { mode: 'no-cors' });
            return fetch(request)
              .then(response => cache.put(request, response))
              .catch(console.warn);
        })
      );

      return Promise.all([
        cache.addAll(localFiles),
        externalPromise
      ]);
    })
  );
});

// 2. ATIVAÇÃO: Limpa caches antigos para economizar espaço
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => Promise.all(
      cacheNames.filter(name => name !== CACHE_NAME).map(name => caches.delete(name))
    )).then(() => self.clients.claim()) // Assume controle das páginas abertas
  );
});

// 3. INTERCEPTAÇÃO DE REDE (A Mágica da Performance)
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // A. Ignora requests que não sejam HTTP/HTTPS (ex: chrome-extension://)
  if (!url.protocol.startsWith('http')) return;

  // B. Ignora API, Supabase e rotas de Cron (Sempre Network Only - dados frescos)
  if (url.pathname.startsWith('/api/') || url.hostname.includes('supabase.co')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // C. Apenas métodos GET são cacheados
  if (event.request.method !== 'GET') {
    event.respondWith(fetch(event.request));
    return;
  }

  // D. Estratégia: Stale-While-Revalidate (Cache Imediato + Atualização em Background)
  event.respondWith(
    caches.open(CACHE_NAME).then(cache => {
      return cache.match(event.request).then(cachedResponse => {

        // Dispara a atualização na rede em paralelo (Background)
        const fetchPromise = fetch(event.request).then(networkResponse => {
          // Se a resposta for válida, atualiza o cache
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            cache.put(event.request, networkResponse.clone());
          }
          return networkResponse;
        }).catch(() => {
           // Se estiver offline, não faz nada (já retornou o cache se existir)
        });

        // Retorna o cache IMEDIATAMENTE se existir. 
        // Se não existir (primeiro acesso), espera a rede.
        return cachedResponse || fetchPromise;
      });
    })
  );
});

// Listener para forçar atualização caso o usuário clique no botão "Atualizar"
self.addEventListener('message', (event) => {
  if (event.data && event.data.action === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// --- NOTIFICAÇÕES PUSH ---

// 1. Receber a notificação do servidor (Vercel Cron)
self.addEventListener('push', function(event) {
  if (event.data) {
    const data = event.data.json();

    const options = {
      body: data.body,
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-192x192.png', // Ícone monocromático para Android
      vibrate: [100, 50, 100], // Vibra: Vrumm-pa-Vrumm
      data: {
        dateOfArrival: Date.now(),
        url: data.url || '/?tab=tab-carteira' // URL para abrir ao clicar
      },
      actions: [
        { action: 'explore', title: 'Ver Carteira' }
      ]
    };

    event.waitUntil(
      self.registration.showNotification(data.title, options)
    );
  }
});

// 2. Clicar na notificação
self.addEventListener('notificationclick', function(event) {
  event.notification.close(); // Fecha a notificação da barra

  event.waitUntil(
    clients.matchAll({type: 'window', includeUncontrolled: true}).then(function(clientList) {
      // Se o app já estiver aberto em alguma aba, foca nela
      for (var i = 0; i < clientList.length; i++) {
        var client = clientList[i];
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      // Se não estiver aberto, abre uma nova janela/aba
      if (clients.openWindow) {
        return clients.openWindow(event.notification.data.url);
      }
    })
  );
});
