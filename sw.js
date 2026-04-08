



const CACHE_VERSION = 'v35'; 
const CACHE_NAME = `vesto-cache-${CACHE_VERSION}`;
const DEFAULT_URL = '/?tab=tab-carteira';

const log = {
    info: (...a) => console.log(`[SW ${CACHE_VERSION}]`, ...a),
    warn: (...a) => console.warn(`[SW ${CACHE_VERSION}]`, ...a),
    error: (...a) => console.error(`[SW ${CACHE_VERSION}]`, ...a),
};

const LOCAL_FILES = [
    '/',
    '/index.html',
    '/app.js',
    '/supabase.js',
    '/style.css',
    '/style-tailwind.css',
    '/manifest.json',
    '/logo-vesto.png',
    '/sininhov2.png',
    '/icons/carteira.png',
    '/icons/noticias.png',
    '/icons/historico.png',
    '/icons/icon-192x192.png',
    '/icons/icon-512x512.png',
];

const EXTERNAL_FILES = [
    'https://cdn.jsdelivr.net/npm/chart.js@3.9.1/dist/chart.min.js',
    'https://cdn.jsdelivr.net/npm/marked/marked.min.js',
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
    'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap',
];

async function cacheFile(cache, url, options = {}) {
    try {
        const request = new Request(url, options);
        const response = await fetch(request);
        const cacheable =
            response &&
            (response.status === 200 || response.type === 'opaque');

        if (!cacheable) {
            throw new Error(`Resposta nao cacheavel (status ${response?.status ?? 'n/a'})`);
        }

        await cache.put(request, response.clone());
    } catch (err) {
        log.warn(`Falha ao cachear ${url}:`, err.message);
    }
}

self.addEventListener('install', event => {
    log.info('Instalando...');

    event.waitUntil(
        caches.open(CACHE_NAME).then(async cache => {
            await Promise.all([
                ...LOCAL_FILES.map(url => cacheFile(cache, url)),
                ...EXTERNAL_FILES.map(url => cacheFile(cache, url, { mode: 'no-cors' })),
            ]);

            log.info('Cache populado.');

            return self.skipWaiting();
        }).catch(err => {
            log.error('Falha na instalaÃ§Ã£o:', err);
        })
    );
});

self.addEventListener('activate', event => {
    log.info('Ativando...');

    event.waitUntil(
        Promise.all([
            caches.keys().then(names =>
                Promise.all(
                    names
                        .filter(name => name !== CACHE_NAME)
                        .map(name => {
                            log.info(`Removendo cache antigo: ${name}`);
                            return caches.delete(name);
                        })
                )
            ),
            self.clients.claim(),
        ]).then(() => log.info('Ativo e no controle.'))
    );
});

self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    if (!url.protocol.startsWith('http')) return;

    if (
        url.pathname.startsWith('/api/') ||
        url.hostname.includes('supabase.co')
    ) {
        event.respondWith(
            fetch(event.request).catch(() => {
                return new Response(
                    JSON.stringify({ error: 'Sem conexÃ£o. Tente novamente.' }),
                    { status: 503, headers: { 'Content-Type': 'application/json' } }
                );
            })
        );
        return;
    }

    if (event.request.method !== 'GET') {
        event.respondWith(fetch(event.request));
        return;
    }

    event.respondWith(
        caches.open(CACHE_NAME).then(async cache => {
            const cachedResponse = await cache.match(event.request);

            const revalidate = fetch(event.request)
                .then(networkResponse => {
                    const cacheable =
                        networkResponse.status === 200 &&
                        (networkResponse.type === 'basic' || networkResponse.type === 'opaque');

                    if (cacheable) {
                        cache.put(event.request, networkResponse.clone());
                    }
                    return networkResponse;
                })
                .catch(err => {
                    return null;
                });

            if (cachedResponse) {
                event.waitUntil(revalidate);

                return cachedResponse;
            }

            const networkResponse = await revalidate;

            if (networkResponse) return networkResponse;

            if (url.pathname !== '/') {
                const fallback = await cache.match('/');
                if (fallback) {
                    return fallback;
                }
            }

            return new Response('Sem conexÃ£o e sem cache disponÃ­vel.', {
                status: 503,
                headers: { 'Content-Type': 'text/plain; charset=utf-8' },
            });
        })
    );
});

self.addEventListener('message', event => {
    if (event.data?.type === 'SKIP_WAITING') {
        log.info('SKIP_WAITING solicitado pelo app.');
        self.skipWaiting();
    }
});

self.addEventListener('push', event => {
    if (!event.data) return;

    let data;
    try {
        data = event.data.json();
    } catch {
        log.error('Push payload invÃ¡lido â€” nÃ£o Ã© JSON:', event.data.text());
        return;
    }

    const options = {
        body: data.body || '',
        icon: data.icon || '/icons/icon-192x192.png',
        badge: data.badge || '/sininhov2.png',
        vibrate: [100, 50, 100],
        data: {
            url: data.url || DEFAULT_URL,
            dateOfArrival: Date.now(),
        },
        actions: [
            { action: 'open', title: 'Abrir' },
            { action: 'dismiss', title: 'Dispensar' },
        ],
    };

    event.waitUntil(
        self.registration.showNotification(data.title || 'In-Vesto', options)
    );
});

self.addEventListener('notificationclick', event => {
    event.notification.close();

    if (event.action === 'dismiss') return;

    const targetUrl = event.notification.data?.url || DEFAULT_URL;

    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
            if (targetUrl.startsWith('http') && !targetUrl.startsWith(self.location.origin)) {
                return self.clients.openWindow(targetUrl);
            }

            for (const client of clientList) {
                if (client.url.startsWith(self.location.origin) && 'focus' in client) {
                    client.focus();
                    if (client.url !== targetUrl) {
                        return client.navigate(targetUrl);
                    }
                    return;
                }
            }
            return self.clients.openWindow(targetUrl);
        })
    );
});



