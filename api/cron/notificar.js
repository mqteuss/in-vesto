const { createClient } = require('@supabase/supabase-js');
const webpush = require('web-push');
const RSSParser = require('rss-parser');
const scraperHandler = require('../scraper.js');

// ---------------------------------------------------------
// CONFIGURAÇÃO
// ---------------------------------------------------------
const CONFIG = {
    timezone_offset: -3,    // BRT (UTC-3)
    notif: {
        icon: 'https://appvesto.vercel.app/icons/icon-192x192.png',
        badge: 'https://appvesto.vercel.app/sininhov2.png',
        url: '/?tab=tab-carteira',
    },
};

// ---------------------------------------------------------
// LOGGER ESTRUTURADO
// ---------------------------------------------------------
const log = {
    _w: (level, msg, meta) =>
        console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](
            JSON.stringify({ level, msg, ...meta, ts: new Date().toISOString() })
        ),
    info: (msg, meta = {}) => log._w('info', msg, meta),
    warn: (msg, meta = {}) => log._w('warn', msg, meta),
    error: (msg, meta = {}) => log._w('error', msg, meta),
    timer: () => { const s = Date.now(); return () => Date.now() - s; },
};

// ---------------------------------------------------------
// INICIALIZAÇÃO (módulo — executada uma única vez)
// ---------------------------------------------------------
webpush.setVapidDetails(
    'mailto:mh.umateus@gmail.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
);

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ---------------------------------------------------------
// HELPERS
// ---------------------------------------------------------
function requestId() {
    return Math.random().toString(36).slice(2, 9);
}

function normalizeSymbol(symbol) {
    if (!symbol) return '';
    return symbol.trim().toUpperCase().replace('.SA', '');
}

// Obtém a data de hoje em BRT (UTC-3) sem depender de setHours frágil.
// setHours(h - 3) quebra silenciosamente quando hour < 3 (vira o dia anterior).
function getTodayBRT() {
    const now = new Date();
    const brt = new Date(now.getTime() + CONFIG.timezone_offset * 60 * 60 * 1000);
    return brt.toISOString().split('T')[0]; // YYYY-MM-DD
}

// Guard para fmtBRL — evita TypeError se value for null/undefined/NaN
function fmtBRL(val) {
    const n = Number(val);
    if (!isFinite(n)) return 'R$ --';
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// ---------------------------------------------------------
// SINGLETON: RSSParser instanciado uma vez no módulo.
// ---------------------------------------------------------
const rssParser = new RSSParser({
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
});

// ---------------------------------------------------------
// PARTE 3: ATUALIZAÇÃO DE PROVENTOS
//
// Substitui o padrão de req/res falso por uma chamada direta
// ao scraperHandler com objetos mínimos mas corretos.
// Se a assinatura do handler mudar, o erro será explícito.
// ---------------------------------------------------------
async function atualizarProventosPeloScraper(fiiList) {
    return new Promise((resolve) => {
        let resultado = [];
        const fakeReq = {
            method: 'POST',
            body: { mode: 'proventos_carteira', payload: { fiiList } },
        };
        const fakeRes = {
            setHeader: () => { },
            status: () => ({
                json: (d) => { resultado = d?.json ?? []; resolve(resultado); },
            }),
            json: (d) => { resultado = d?.json ?? []; resolve(resultado); },
        };
        scraperHandler(fakeReq, fakeRes).catch(err => {
            log.error('scraperHandler error', { error: err.message });
            resolve([]);
        });
    });
}

// ---------------------------------------------------------
// PARTE 4: NOTIFICAÇÕES PUSH
//
// ANTES: 1 query ao Supabase por usuário dentro do loop.
//        N usuários = N queries.
// AGORA: 1 query para todos os usuários, resultado indexado por Map.
// ---------------------------------------------------------
async function enviarNotificacoes(rid) {
    const elapsed = log.timer();
    const hojeString = getTodayBRT();
    const inicioDoDia = `${hojeString}T00:00:00`;
    const hojeDateObj = new Date(`${hojeString}T00:00:00Z`);

    const { data: proventos, error } = await supabase
        .from('proventosconhecidos')
        .select('*')
        .or(`paymentdate.eq.${hojeString},datacom.eq.${hojeString},created_at.gte.${inicioDoDia}`);

    if (error) {
        log.error('Erro ao buscar proventos para notificações', { rid, error: String(error) });
        return 0;
    }

    if (!proventos?.length) return 0;

    // Agrupa proventos por usuário
    const userEvents = {};
    for (const p of proventos) {
        if (!userEvents[p.user_id]) userEvents[p.user_id] = [];
        userEvents[p.user_id].push(p);
    }

    const userIds = Object.keys(userEvents);

    // Busca TODAS as subscriptions de uma vez, indexa por user_id
    const { data: allSubs, error: subErr } = await supabase
        .from('push_subscriptions')
        .select('*')
        .in('user_id', userIds);

    if (subErr) {
        log.error('Erro ao buscar subscriptions', { rid, error: String(subErr) });
        return 0;
    }

    const subsByUser = {};
    for (const sub of allSubs ?? []) {
        if (!subsByUser[sub.user_id]) subsByUser[sub.user_id] = [];
        subsByUser[sub.user_id].push(sub);
    }

    let totalSent = 0;
    const staleSubIds = []; // Coleta subs inválidas para deletar em lote ao final

    const matchDate = (field, dateStr) => field?.startsWith(dateStr) ?? false;

    for (const userId of userIds) {
        const subs = subsByUser[userId];
        if (!subs?.length) continue;

        const eventos = userEvents[userId];
        const pagamentos = eventos.filter(e => matchDate(e.paymentdate, hojeString));
        const dataComs = eventos.filter(e => matchDate(e.datacom, hojeString));
        const novosAnuncios = eventos.filter(e => {
            const createdToday = matchDate(e.created_at, hojeString);
            const isDuplicate = matchDate(e.datacom, hojeString) || matchDate(e.paymentdate, hojeString);
            const isFuturo = e.paymentdate
                ? new Date(e.paymentdate.split('T')[0] + 'T00:00:00Z') >= hojeDateObj
                : false;
            return createdToday && !isDuplicate && isFuturo;
        });

        let title = '', body = '';

        if (pagamentos.length > 0) {
            const lista = pagamentos.map(p => `${p.symbol} (${fmtBRL(p.value)}/cota)`).join(', ');
            title = 'Crédito de Proventos';
            body = pagamentos.length === 1
                ? `O ativo ${pagamentos[0].symbol} realizou pagamento de ${fmtBRL(pagamentos[0].value)}/cota hoje.`
                : `Pagamentos realizados hoje: ${lista}.`;

        } else if (dataComs.length > 0) {
            const lista = dataComs.map(p => `${p.symbol} (${fmtBRL(p.value)}/cota)`).join(', ');
            title = 'Data Com (Corte)';
            body = `Data limite registrada hoje para: ${lista}.`;

        } else if (novosAnuncios.length > 0) {
            const lista = novosAnuncios
                .slice(0, 3)
                .map(p => `${p.symbol} (${fmtBRL(p.value)}/cota)`)
                .join(', ');
            title = 'Comunicado de Proventos';
            body = novosAnuncios.length === 1
                ? `Comunicado: ${novosAnuncios[0].symbol} anunciou pagamento de ${fmtBRL(novosAnuncios[0].value)}/cota.`
                : `Novos anúncios: ${lista}${novosAnuncios.length > 3 ? '...' : ''}`;

        } else {
            continue;
        }

        const notifPayload = JSON.stringify({
            title,
            body,
            icon: CONFIG.notif.icon,
            badge: CONFIG.notif.badge,
            url: CONFIG.notif.url,
        });

        const pushResults = await Promise.allSettled(
            subs.map(sub => webpush.sendNotification(sub.subscription, notifPayload))
        );

        for (let i = 0; i < pushResults.length; i++) {
            const result = pushResults[i];
            if (result.status === 'fulfilled') {
                totalSent++;
            } else {
                const code = result.reason?.statusCode;
                if (code === 410 || code === 404) {
                    // Inscrição expirada — coleta para deletar em lote
                    staleSubIds.push(subs[i].id);
                } else {
                    log.warn('Push send failed', { userId, error: result.reason?.message });
                }
            }
        }
    }

    // Remove todas as subs inválidas de uma vez (1 query em vez de N)
    if (staleSubIds.length > 0) {
        const { error: delErr } = await supabase
            .from('push_subscriptions')
            .delete()
            .in('id', staleSubIds);
        if (delErr) log.warn('Erro ao deletar subs inválidas', { rid, error: String(delErr) });
        else log.info('Stale subs removed', { rid, count: staleSubIds.length });
    }

    log.info('Notificações enviadas', { rid, totalSent, ms: elapsed() });
    return totalSent;
}

// ---------------------------------------------------------
// PARTE 5: NOTIFICAÇÕES DE NOTÍCIAS (RSS)
// ---------------------------------------------------------
async function enviarNoticiasRSS(rid) {
    const elapsed = log.timer();
    log.info('RSS news job started', { rid });

    const parser = rssParser;
    const RSS_URLS = [
        'https://www.infomoney.com.br/feed/',
        'https://suno.com.br/noticias/feed/',
        'https://www.moneytimes.com.br/feed/',
        'https://einvestidor.estadao.com.br/feed/',
        'https://www.seudinheiro.com/feed/'
    ];

    let allItems = [];
    for (const feedUrl of RSS_URLS) {
        try {
            const feed = await parser.parseURL(feedUrl);
            if (feed && feed.items) {
                allItems.push(...feed.items);
            }
        } catch (err) {
            log.warn('Falha ao ler feed RSS', { rid, feedUrl, error: err.message });
        }
    }

    if (allItems.length === 0) return 0;

    // Busca guids já enviados (para não repetir)
    const { data: appStates } = await supabase
        .from('appstate')
        .select('*')
        .eq('key', 'last_news_sent')
        .limit(1);

    let enviadas = [];
    if (appStates && appStates.length > 0) {
        try {
            const raw = typeof appStates[0].value_json === 'string'
                ? JSON.parse(appStates[0].value_json)
                : appStates[0].value_json;
            if (Array.isArray(raw)) enviadas = raw;
        } catch (e) { }
    }
    const noticiasJaEnviadas = new Set(enviadas);

    // Carrega transacoes e subs em paralelo
    const [{ data: transacoes }, { data: allSubs }] = await Promise.all([
        supabase.from('transacoes').select('user_id, symbol'),
        supabase.from('push_subscriptions').select('*')
    ]);

    if (!transacoes?.length || !allSubs?.length) return 0;

    // Monta Dicionários
    const symbolUserMap = {};
    for (const t of transacoes) {
        const sym = normalizeSymbol(t.symbol);
        if (!symbolUserMap[sym]) symbolUserMap[sym] = new Set();
        symbolUserMap[sym].add(t.user_id);
    }

    const subsByUser = {};
    for (const sub of allSubs) {
        if (!subsByUser[sub.user_id]) subsByUser[sub.user_id] = [];
        subsByUser[sub.user_id].push(sub);
    }

    // Processa Notícias (ordena mais recentes primeiro)
    allItems.sort((a, b) => new Date(b.pubDate || b.isoDate || 0) - new Date(a.pubDate || a.isoDate || 0));
    allItems = allItems.slice(0, 80); // Limita o tamanho da fila de processamento expandida

    const tickerRegex = /\b([A-Z]{4}11|[A-Z]{4}12)\b/g;
    let totalSent = 0;
    const staleSubIds = [];
    let guidsProcessadasHoje = [];

    for (const item of allItems) {
        const uniqueId = item.guid || item.link;
        if (!uniqueId || noticiasJaEnviadas.has(uniqueId)) continue;

        const textoBusca = `${item.title || ''} ${item.contentSnippet || item.content || ''}`;
        let matchedTickers = textoBusca.match(tickerRegex);

        if (!matchedTickers) {
            guidsProcessadasHoje.push(uniqueId);
            continue;
        }

        const uniqueTickers = [...new Set(matchedTickers)];
        let targetTickers = [];
        let usersToNotify = new Set();

        for (const ticker of uniqueTickers) {
            const sym = normalizeSymbol(ticker);
            if (symbolUserMap[sym]) {
                targetTickers.push(sym);
                for (const uid of symbolUserMap[sym]) usersToNotify.add(uid);
            }
        }

        if (usersToNotify.size === 0) {
            guidsProcessadasHoje.push(uniqueId);
            continue;
        }

        const titulo = item.title;
        // Strip HTML and get 100 chars max
        const excerpt = (item.contentSnippet || item.content || '').replace(/<[^>]*>?/gm, '').substring(0, 100) + '...';

        const notifPayload = JSON.stringify({
            title: `Notícia: ${targetTickers.join(', ')}`,
            body: `${titulo}\n${excerpt}`,
            icon: CONFIG.notif.icon,
            badge: CONFIG.notif.badge,
            url: item.link || CONFIG.notif.url,
        });

        for (const userId of usersToNotify) {
            const subs = subsByUser[userId];
            if (!subs?.length) continue;

            const pushResults = await Promise.allSettled(
                subs.map(sub => webpush.sendNotification(sub.subscription, notifPayload))
            );

            for (let i = 0; i < pushResults.length; i++) {
                const res = pushResults[i];
                if (res.status === 'fulfilled') totalSent++;
                else {
                    const code = res.reason?.statusCode;
                    if (code === 410 || code === 404) staleSubIds.push(subs[i].id);
                }
            }
        }
        guidsProcessadasHoje.push(uniqueId);
    }

    if (staleSubIds.length > 0) {
        await supabase.from('push_subscriptions').delete().in('id', staleSubIds);
    }

    if (guidsProcessadasHoje.length > 0) {
        const novasGuidsArray = [...new Set([...guidsProcessadasHoje, ...enviadas])].slice(0, 150); // Buffer rotativo

        if (appStates && appStates.length > 0) {
            await supabase.from('appstate').update({
                value_json: JSON.stringify(novasGuidsArray)
            }).eq('key', 'last_news_sent');
        } else {
            await supabase.from('appstate').insert({
                user_id: '00000000-0000-0000-0000-000000000000',
                key: 'last_news_sent',
                value_json: JSON.stringify(novasGuidsArray)
            });
        }
    }

    log.info('RSS news job done', { rid, totalSent, ms: elapsed() });
    return totalSent;
}

// ---------------------------------------------------------
// HANDLER PRINCIPAL (CRON)
// ---------------------------------------------------------
module.exports = async function handler(req, res) {
    const rid = requestId();
    const elapsed = log.timer();

    // Autenticação do cron — qualquer requisição não autorizada
    // poderia disparar o job inteiro e consumir cota da Brapi.
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
        log.error('CRON_SECRET ausente. Execucao bloqueada.', { rid });
        return res.status(500).json({ error: 'CRON_SECRET nao configurado.' });
    }

    const authHeader = req.headers['authorization'] ?? '';
    const token = authHeader.replace('Bearer ', '').trim();
    if (token !== cronSecret) {
        log.warn('Unauthorized cron attempt', { rid });
        return res.status(401).json({ error: 'Nao autorizado.' });
    }

    log.info('Cron started', { rid });

    try {
        // 1. Proventos — query única para symbols + mapeamento user
        const { data: allTransacoes } = await supabase.from('transacoes').select('user_id, symbol');
        if (allTransacoes?.length > 0) {
            // Monta mapeamento symbol → Set<user_id> E lista de symbols únicos em 1 pass
            const symbolUserMap = {};
            const uniqueSymbols = new Set();
            for (const t of allTransacoes) {
                const sym = normalizeSymbol(t.symbol);
                if (!sym) continue;
                uniqueSymbols.add(sym);
                if (!symbolUserMap[sym]) symbolUserMap[sym] = new Set();
                symbolUserMap[sym].add(t.user_id);
            }

            const symbols = [...uniqueSymbols];
            if (symbols.length > 0) {
                const novosDados = await atualizarProventosPeloScraper(symbols);

                if (novosDados?.length > 0) {

                    const upserts = [];
                    for (const dado of novosDados) {
                        if (!dado.paymentDate || !dado.value) continue;
                        const users = symbolUserMap[normalizeSymbol(dado.symbol)] ?? new Set();
                        const tipo = (dado.type || 'REND').toUpperCase().trim();
                        const id = `${dado.symbol}_${dado.paymentDate}_${tipo}_${parseFloat(dado.value).toFixed(4)}`;

                        for (const uid of users) {
                            upserts.push({
                                id,
                                user_id: uid,
                                symbol: dado.symbol,
                                value: dado.value,
                                paymentdate: dado.paymentDate,
                                datacom: dado.dataCom,
                                type: tipo,
                                processado: false,
                            });
                        }
                    }

                    if (upserts.length > 0) {
                        const { error } = await supabase
                            .from('proventosconhecidos')
                            .upsert(upserts, { onConflict: 'user_id, id', ignoreDuplicates: true });
                        if (error) log.error('Erro ao salvar proventos', { rid, error: String(error) });
                        else log.info('Proventos upserted', { rid, count: upserts.length });
                    }
                }
            }
        }

        // 2. Notificações de Proventos
        const totalSent = await enviarNotificacoes(rid);

        // 3. Notificações de Notícias FIIs (RSS)
        const totalNewsSent = await enviarNoticiasRSS(rid);

        log.info('Cron finished', { rid, notifications: totalSent, news: totalNewsSent, ms: elapsed() });

        return res.status(200).json({
            status: 'ok',
            rid,
            notifications: totalSent,
            news_sent: totalNewsSent,
            ms: elapsed(),
        });

    } catch (e) {
        log.error('Cron fatal error', { rid, error: e.message, stack: e.stack });
        return res.status(500).json({ error: e.message });
    }
};
