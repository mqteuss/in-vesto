// ---------------------------------------------------------
// CONFIGURAÇÃO
// Incremente CACHE_VERSION a cada deploy para forçar atualização.
// ---------------------------------------------------------
const CACHE_VERSION = 'v21'; // Updated for Push Notifications changes
const CACHE_NAME = `vesto-cache-${CACHE_VERSION}`;
const DEFAULT_URL = '/?tab=tab-carteira';

// ---------------------------------------------------------
// LOGGER — identifica logs do SW em produção
// ---------------------------------------------------------
const log = {
    info: (...a) => console.log(`[SW ${CACHE_VERSION}]`, ...a),
    warn: (...a) => console.warn(`[SW ${CACHE_VERSION}]`, ...a),
    error: (...a) => console.error(`[SW ${CACHE_VERSION}]`, ...a),
};

// ---------------------------------------------------------
// ARQUIVOS LOCAIS — cacheados na instalação
// Separados dos externos para tratamento individual de falhas.
// ---------------------------------------------------------
const LOCAL_FILES = [
    '/',
    '/index.html',
    '/app.js',
    '/supabase.js',
    '/style.css',
    '/style-tailwind.css',
    '/manifest.json',
    '/logo-vesto.png',
    '/public/sininhov2.png',
    '/icons/carteira.png',
    '/icons/noticias.png',
    '/icons/historico.png',
    '/icons/icon-192x192.png',
    '/icons/icon-512x512.png',
];

// URLs idênticas às usadas no HTML — obrigatório para que o cache seja aproveitado.
// Versões com hash fixo (chart.js) evitam invalidações silenciosas do CDN.
const EXTERNAL_FILES = [
    'https://cdn.jsdelivr.net/npm/chart.js@3.9.1/dist/chart.min.js',
    'https://cdn.jsdelivr.net/npm/marked/marked.min.js',
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
    // Google Fonts: cacheado como CSS opaque. As fontes em si são
    // buscadas separadamente pelo browser — sem garantia de offline.
    'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap',
];

// ---------------------------------------------------------
// HELPER: cacheia um arquivo individualmente, sem quebrar
// a instalação se falhar (ao contrário de cache.addAll que
// é atômico e derruba tudo se 1 arquivo der 404).
// ---------------------------------------------------------
async function cacheFile(cache, url, options = {}) {
    try {
        const request = new Request(url, options);
        const response = await fetch(request);
        await cache.put(request, response);
    } catch (err) {
        log.warn(`Falha ao cachear ${url}:`, err.message);
        // Não relança — instalação continua mesmo se um arquivo falhar
    }
}

// ---------------------------------------------------------
// 1. INSTALAÇÃO
// ---------------------------------------------------------
self.addEventListener('install', event => {
    log.info('Instalando...');

    event.waitUntil(
        caches.open(CACHE_NAME).then(async cache => {
            // Busca local e externos em paralelo — reduz tempo de instalação
            await Promise.all([
                ...LOCAL_FILES.map(url => cacheFile(cache, url)),
                ...EXTERNAL_FILES.map(url => cacheFile(cache, url, { mode: 'no-cors' })),
            ]);

            log.info('Cache populado.');

            // skipWaiting DENTRO do waitUntil garante que o SW só
            // avança para activate após o cache estar completamente pronto.
            return self.skipWaiting();
        }).catch(err => {
            log.error('Falha na instalação:', err);
        })
    );
});

// ---------------------------------------------------------
// 2. ATIVAÇÃO
// ---------------------------------------------------------
self.addEventListener('activate', event => {
    log.info('Ativando...');

    event.waitUntil(
        Promise.all([
            // Remove todos os caches antigos
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
            // Assume controle de todas as abas abertas imediatamente
            self.clients.claim(),
        ]).then(() => log.info('Ativo e no controle.'))
    );
});

// ---------------------------------------------------------
// 3. FETCH — ESTRATÉGIA STALE-WHILE-REVALIDATE
// ---------------------------------------------------------
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // Ignora protocolos não-HTTP (chrome-extension://, etc.)
    if (!url.protocol.startsWith('http')) return;

    // Network-only: API, Supabase e cron — dados sempre frescos
    if (
        url.pathname.startsWith('/api/') ||
        url.hostname.includes('supabase.co')
    ) {
        event.respondWith(
            fetch(event.request).catch(() => {
                // Se offline e é uma chamada de API, retorna 503 legível
                return new Response(
                    JSON.stringify({ error: 'Sem conexão. Tente novamente.' }),
                    { status: 503, headers: { 'Content-Type': 'application/json' } }
                );
            })
        );
        return;
    }

    // Apenas GET é cacheável
    if (event.request.method !== 'GET') {
        event.respondWith(fetch(event.request));
        return;
    }

    // Stale-While-Revalidate para todo o resto
    event.respondWith(
        caches.open(CACHE_NAME).then(async cache => {
            const cachedResponse = await cache.match(event.request);

            // Atualização em background — não bloqueia a resposta
            const revalidate = fetch(event.request)
                .then(networkResponse => {
                    // Cacheia respostas válidas: basic (mesmo origem) ou opaque (no-cors CDN)
                    const cacheable =
                        networkResponse.status === 200 &&
                        (networkResponse.type === 'basic' || networkResponse.type === 'opaque');

                    if (cacheable) {
                        cache.put(event.request, networkResponse.clone());
                    }
                    return networkResponse;
                })
                .catch(err => {
                    // Retorna null silenciosamente — tratado abaixo no fallback
                    return null;
                });

            if (cachedResponse) {
                // Garante que o SW não seja encerrado antes da revalidação terminar
                event.waitUntil(revalidate);

                // Tem cache: retorna imediatamente, revalida em background
                return cachedResponse;
            }

            // Sem cache: aguarda a rede
            const networkResponse = await revalidate;

            if (networkResponse) return networkResponse;

            // Offline e sem cache: fallback para página principal
            // (permite que o app mostre uma UI offline em vez de tela em branco)
            if (url.pathname !== '/') {
                const fallback = await cache.match('/');
                if (fallback) {
                    return fallback;
                }
            }

            // Último recurso: resposta de erro legível
            return new Response('Sem conexão e sem cache disponível.', {
                status: 503,
                headers: { 'Content-Type': 'text/plain; charset=utf-8' },
            });
        })
    );
});

// ---------------------------------------------------------
// 4. MENSAGENS DO APP → SW
// Permite que o app solicite atualizações sem forçar reload.
// Uso no app: navigator.serviceWorker.controller.postMessage({ type: 'SKIP_WAITING' })
// ---------------------------------------------------------
self.addEventListener('message', event => {
    if (event.data?.type === 'SKIP_WAITING') {
        log.info('SKIP_WAITING solicitado pelo app.');
        self.skipWaiting();
    }
});

// ---------------------------------------------------------
// 5. NOTIFICAÇÕES PUSH
// ---------------------------------------------------------
self.addEventListener('push', event => {
    if (!event.data) return;

    // try/catch: payload malformado não derruba o evento push
    let data;
    try {
        data = event.data.json();
    } catch {
        log.error('Push payload inválido — não é JSON:', event.data.text());
        return;
    }

    const options = {
        body: data.body || '',
        icon: data.icon || '/icons/icon-192x192.png',
        badge: data.badge || '/public/sininhov2.png',
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

// ---------------------------------------------------------
// 6. CLIQUE NA NOTIFICAÇÃO
// ---------------------------------------------------------
self.addEventListener('notificationclick', event => {
    event.notification.close();

    // Trata a action "dismiss" explicitamente — apenas fecha
    if (event.action === 'dismiss') return;

    // Obtem a URL salva no payload da notificação (ou a padrão)
    const targetUrl = event.notification.data?.url || DEFAULT_URL;

    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
            // Se a URL for externa (notícia de FII), abre uma nova aba diretamente
            if (targetUrl.startsWith('http') && !targetUrl.startsWith(self.location.origin)) {
                return self.clients.openWindow(targetUrl);
            }

            // Se for interna, tenta focar a aba existente e navegar
            for (const client of clientList) {
                if (client.url.startsWith(self.location.origin) && 'focus' in client) {
                    client.focus();
                    if (client.url !== targetUrl) {
                        return client.navigate(targetUrl);
                    }
                    return;
                }
            }
            // Nenhuma aba aberta com o origin: abre nova janela
            return self.clients.openWindow(targetUrl);
        })
    );
});