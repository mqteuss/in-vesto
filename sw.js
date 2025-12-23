const CACHE_NAME = 'vesto-cache-v16'; // Incrementei a versão para limpar o antigo
const CRITICAL_FILES = [
  '/',
  '/manifest.json',
  '/index.html',
  '/app.js',
  '/supabase.js',
  '/style.css',
  '/style-tailwind.css'
];

const ASSETS_FILES = [
  '/icons/carteira.png',
  '/icons/noticias.png',
  '/icons/historico.png',
  '/logo-vesto.png',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  'https://cdn.jsdelivr.net/npm/chart.js@3.9.1/dist/chart.min.js',
  'https://cdn.jsdelivr.net/npm/marked/marked.min.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
];

const ALL_FILES = [...CRITICAL_FILES, ...ASSETS_FILES];

// 1. INSTALAÇÃO
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // Tenta cachear tudo na instalação para garantir funcionamento offline inicial
      const externalFiles = ALL_FILES.filter(url => url.startsWith('http'));
      const localFiles = ALL_FILES.filter(url => !url.startsWith('http'));

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

// 2. ATIVAÇÃO
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => Promise.all(
      cacheNames.filter(name => name !== CACHE_NAME).map(name => caches.delete(name))
    )).then(() => self.clients.claim())
  );
});

// 3. INTERCEPTAÇÃO DE REDE (ESTRATÉGIAS MISTAS)
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // A. Ignora requests não HTTP
  if (!url.protocol.startsWith('http')) return;

  // B. API e Supabase: NETWORK ONLY (Nunca Cachear)
  if (url.pathname.startsWith('/api/') || url.hostname.includes('supabase.co')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // C. HTML, JS e CSS do App: NETWORK FIRST (Rede Primeiro, Cache se Offline)
  // Isso garante que você sempre pegue a versão mais recente se tiver internet.
  if (
      url.pathname === '/' || 
      url.pathname.endsWith('.html') || 
      url.pathname.endsWith('.js') || 
      url.pathname.endsWith('.css')
  ) {
    event.respondWith(
      fetch(event.request)
        .then(networkResponse => {
          // Se a rede respondeu, atualiza o cache e retorna a versão nova
          if (networkResponse && networkResponse.status === 200) {
             const responseToCache = networkResponse.clone();
             caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseToCache));
          }
          return networkResponse;
        })
        .catch(() => {
          // Se deu erro (Offline), pega do cache
          return caches.match(event.request);
        })
    );
    return;
  }

  // D. Imagens, Fontes e Libs Externas: STALE-WHILE-REVALIDATE (Cache Rápido)
  // Esses arquivos mudam pouco, então mostramos o cache rápido e atualizamos em background.
  event.respondWith(
    caches.open(CACHE_NAME).then(cache => {
      return cache.match(event.request).then(cachedResponse => {
        const fetchPromise = fetch(event.request).then(networkResponse => {
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            cache.put(event.request, networkResponse.clone());
          }
          return networkResponse;
        }).catch(() => {});

        return cachedResponse || fetchPromise;
      });
    })
  );
});

// Listener para forçar atualização via botão
self.addEventListener('message', (event) => {
  if (event.data && event.data.action === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// --- NOTIFICAÇÕES PUSH ---
self.addEventListener('push', function(event) {
  if (event.data) {
    const data = event.data.json();
    const options = {
      body: data.body,
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-192x192.png',
      vibrate: [100, 50, 100],
      data: {
        dateOfArrival: Date.now(),
        url: data.url || '/?tab=tab-carteira'
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

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({type: 'window', includeUncontrolled: true}).then(function(clientList) {
      for (var i = 0; i < clientList.length; i++) {
        var client = clientList[i];
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(event.notification.data.url);
      }
    })
  );
});
