// NOVO: Versão do cache atualizada para forçar a atualização
const CACHE_NAME = 'vesto-cache-v5';

// Todos os arquivos que compõem o "esqueleto" do seu app
const APP_SHELL_FILES = [
  '/',
  'index.html',
  'manifest.json',
  // REMOVIDO: 'https://cdn.tailwindcss.com',
  // REMOVIDO: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap',
  'https://cdn.jsdelivr.net/npm/chart.js@3.9.1/dist/chart.min.js',
  'icons/icon-192x192.png', 
  'icons/icon-512x512.png'  
  // O ícone da 5ª aba (Histórico) é um SVG inline, não precisa cachear
];

// Evento de Instalação: Armazena o App Shell no cache
self.addEventListener('install', event => {
  console.log('[SW] Evento de Instalação');
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
        console.log('[SW] Armazenando App Shell no cache');
        // Usamos addAll com 'no-cache' para recursos de CDN que podem não suportar CORS no SW
        // Mas para Chart.js, que é mais estável, podemos tentar.
        // Se Chart.js também falhar, teremos que tratá-lo de forma diferente.
        return cache.addAll(APP_SHELL_FILES);
      })
      // REMOVEMOS O self.skipWaiting() DAQUI!
      // Agora ele vai "esperar" (waiting) após instalar.
  );
});

// Evento de Ativação: Limpa caches antigos
self.addEventListener('activate', event => {
  console.log('[SW] Evento de Ativação');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('[SW] Limpando cache antigo:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
        console.log('[SW] Clientes controlados.');
        return self.clients.claim(); // Torna-se o SW ativo imediatamente
    })
  );
});

// Evento de Fetch: Responde com cache ou rede (estratégia Stale-While-Revalidate para o App Shell)
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // --- CORREÇÃO ADICIONADA AQUI ---
  // 1. Ignorar esquemas não-HTTP(S) (ex: chrome-extension://)
  if (!url.protocol.startsWith('http')) {
    // Deixa o pedido passar sem intercetar
    return; 
  }
  // --- FIM DA CORREÇÃO ---

  // 2. Ignorar chamadas de API para o nosso BFF
  if (url.pathname.startsWith('/api/')) {
    // Apenas busca na rede (não faz cache de API)
    event.respondWith(fetch(event.request));
    return;
  }
  
  // 3. Tratar pedidos de CDN (como Chart.js) - Network first, fallback to cache
  if (url.origin === 'https://cdn.jsdelivr.net') {
      event.respondWith(
          fetch(event.request).then(networkResponse => {
              // Se a rede funcionar, atualiza o cache
              caches.open(CACHE_NAME).then(cache => {
                  cache.put(event.request, networkResponse.clone());
              });
              return networkResponse;
          }).catch(() => {
              // Se a rede falhar, tenta pegar do cache
              return caches.match(event.request);
          })
      );
      return;
  }

  // 4. Estratégia Stale-While-Revalidate para o App Shell local
  event.respondWith(
    caches.open(CACHE_NAME).then(cache => {
      return cache.match(event.request).then(cachedResponse => {
        // Busca na rede em paralelo
        const fetchPromise = fetch(event.request).then(networkResponse => {
          // Se for bem-sucedido, atualiza o cache
          cache.put(event.request, networkResponse.clone());
          return networkResponse;
        });
        // Retorna o cache primeiro (se existir), senão espera a rede
        return cachedResponse || fetchPromise;
      });
    })
  );
});

// ==========================================================
// ADIÇÃO CRÍTICA: Ouvinte de Mensagem
// ==========================================================
// Ouve a mensagem do 'index.html' para pular a espera
// Ouvinte de Mensagem para o SKIP_WAITING
self.addEventListener('message', (event) => {
  if (event.data && event.data.action === 'SKIP_WAITING') {
    console.log('[SW] Recebeu ordem para SKIP_WAITING');
    self.skipWaiting();
  }
});


// ==========================================================
// NOVO: LÓGICA DE PUSH NOTIFICATION
// ==========================================================

// Evento 'push': Chamado quando o servidor envia uma notificação
self.addEventListener('push', event => {
  console.log('[SW] Notificação Push recebida.');
  
  // Tenta ler dados da notificação (ex: { title: "...", body: "..." })
  let data = {};
  try {
    data = event.data.json();
  } catch (e) {
    data = {
      title: 'Vesto',
      body: event.data.text(),
    };
  }

  const title = data.title || 'Vesto';
  const options = {
    body: data.body || 'Você tem uma nova atualização.',
    icon: 'icons/icon-192x192.png',
    badge: 'icons/icon-192x192.png',
    vibrate: [100, 50, 100],
    data: {
      url: data.url || '/', // URL para abrir ao clicar
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Evento 'notificationclick': Chamado quando o usuário clica na notificação
self.addEventListener('notificationclick', event => {
  console.log('[SW] Notificação clicada.');
  
  event.notification.close(); // Fecha a notificação

  // Tenta focar em uma aba já aberta do app, senão abre uma nova
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      const urlToOpen = event.notification.data.url || '/';
      
      for (const client of clientList) {
        if (client.url === urlToOpen && 'focus' in client) {
          return client.focus();
        }
      }
      
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});
