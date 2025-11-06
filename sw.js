/ NOVO: Versão do cache atualizada para forçar a atualização
const CACHE_NAME = 'vesto-cache-v2';

// Todos os arquivos que compõem o "esqueleto" do seu app
const APP_SHELL_FILES = [
@@ -11,6 +12,7 @@ const APP_SHELL_FILES = [
  'https://cdn.jsdelivr.net/npm/chart.js@3.9.1/dist/chart.min.js',
  'icons/icon-192x192.png', 
  'icons/icon-512x512.png'  
  // O ícone da 5ª aba (Histórico) é um SVG inline, não precisa cachear
];

// Evento de Instalação: Armazena o App Shell no cache
@@ -22,8 +24,6 @@ self.addEventListener('install', event => {
        console.log('[SW] Armazenando App Shell no cache');
        return cache.addAll(APP_SHELL_FILES);
      })
	  );
});

@@ -47,6 +47,7 @@ self.addEventListener('fetch', event => {

  // 1. Ignorar chamadas de API para o nosso BFF
  if (url.pathname.startsWith('/api/')) {
    // Apenas busca na rede (não faz cache de API)
    event.respondWith(fetch(event.request));
    return;
  }
@@ -55,23 +56,81 @@ self.addEventListener('fetch', event => {
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
